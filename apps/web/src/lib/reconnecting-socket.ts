import type { ClientFrame } from "@ember/protocol";

/**
 * How long the page goes without a connection before it counts as offline, which stops sending, as
 * Campfire's refresh_room_controller.js waits (`OFFLINE_AFTER_DISCONNECTED_TIMEOUT`).
 */
export const OFFLINE_AFTER_MS = 5_000;
/** How often an open socket checks it's still connected. The runtime answers without waking the room. */
const HEARTBEAT_MS = 25_000;
const MAX_BACKOFF_MS = 15_000;
/** How long a socket has to open before it's tried again: a network that hangs can leave it connecting for minutes. */
const CONNECT_TIMEOUT_MS = 10_000;
/** How long after the tab is shown, or the network comes back, the socket is checked, as ActionCable waits. */
const PROBE_DELAY_MS = 200;
/** How long a socket that's checked has to hear something from the server before it counts as dead. */
const PROBE_TIMEOUT_MS = 3_000;
/**
 * A socket open longer than this that the network or the server closes most likely went in a deploy,
 * which closes every socket at once, so the first try to connect again is spread wider.
 */
const LONG_LIVED_MS = 60_000;

/** Whether the socket is connecting for the first time, or again after one that closed. */
export type SocketStatus = "connecting" | "reconnecting";

export interface ReconnectingSocketOptions {
  /** Where to connect, asked again for each attempt. */
  url: () => string;
  /** Each frame from the server, as its text. */
  onMessage: (data: string) => void;
  /** As each attempt to connect begins, or once one is waited on. */
  onConnecting: (status: SocketStatus) => void;
  /** Once the page has been without a connection the server let in for `OFFLINE_AFTER_MS`, and once it has one again. */
  onOffline: (offline: boolean) => void;
  /**
   * A close this side didn't ask for, with its code and whether the socket had opened: true connects
   * again after the usual wait, and false leaves the owner to `retry()` or `close()`.
   */
  onClose: (code: number, opened: boolean) => boolean;
}

export interface ReconnectingSocket {
  /**
   * Sends `frame` once the server has let the socket in, saying whether it did. Until then a frame could
   * overtake those the owner is keeping to send once it's in, or go to a server about to refuse it.
   */
  send(frame: ClientFrame): boolean;
  /**
   * Says the server has let the connection in, as a room's welcome does: the page is online again, the
   * socket sends, and the next close starts the back-off over. A server that closes a socket as soon as
   * it opens doesn't say so, and keeps being backed off from.
   */
  connected(): void;
  /** Connects again after the usual wait, after a close the owner held on to. */
  retry(): void;
  /** Closes the socket for good. */
  close(): void;
}

/**
 * A WebSocket that connects again whenever it closes, waiting half a second, doubling to fifteen, give
 * or take a quarter. ember-rust's ActionCable waits longer, 6 seconds growing 15% a try. An open socket
 * pings every 25 seconds and reconnects when a ping goes unanswered, and it's checked again when the
 * tab is shown or the network comes back, as ActionCable's ConnectionMonitor checks for a stale one.
 */
export function reconnectingSocket(options: ReconnectingSocketOptions): ReconnectingSocket {
  let stopped = false;
  let ws: WebSocket | null = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let probeDelay: ReturnType<typeof setTimeout> | undefined;
  let offlineTimer: ReturnType<typeof setTimeout> | undefined;
  let offline = false;
  // Whether the server has let in the socket now open.
  let admitted = false;
  // Whether anything has come from the server since the last ping.
  let heard = true;

  const backoff = () => Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt++) * (0.75 + Math.random() / 2);
  // The first try after a deploy is spread over a quarter of a second to two, so that the sockets it
  // closed don't all come back at once.
  const afterDeploy = () => {
    if (attempt > 0) return backoff();
    attempt++;
    return 250 + Math.random() * 1_750;
  };

  const startOfflineClock = () => {
    if (offline || offlineTimer !== undefined) return;
    offlineTimer = setTimeout(() => {
      offlineTimer = undefined;
      offline = true;
      options.onOffline(true);
    }, OFFLINE_AFTER_MS);
  };

  const stopChecking = () => {
    clearTimeout(connectTimer);
    clearInterval(heartbeat);
    clearTimeout(probeTimer);
    probeTimer = undefined;
  };

  const reconnect = (delay: number) => {
    stopChecking();
    startOfflineClock();
    options.onConnecting("reconnecting");
    retryTimer = setTimeout(open, delay);
  };

  // The network dropped without closing the socket, which never opened or stopped answering.
  const dropped = (socket: WebSocket, delay: number) => {
    socket.onclose = null;
    socket.close();
    reconnect(delay);
  };

  const open = () => {
    retryTimer = undefined;
    admitted = false;
    options.onConnecting(ws === null ? "connecting" : "reconnecting");
    const socket = new WebSocket(options.url());
    ws = socket;
    let openedAt: number | undefined;
    connectTimer = setTimeout(() => dropped(socket, backoff()), CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      clearTimeout(connectTimer);
      openedAt = Date.now();
      heard = true;
      heartbeat = setInterval(() => {
        if (!heard) return dropped(socket, backoff());
        heard = false;
        socket.send('{"type":"ping"}');
      }, HEARTBEAT_MS);
    };
    socket.onmessage = (event) => {
      heard = true;
      clearTimeout(probeTimer);
      probeTimer = undefined;
      options.onMessage(String(event.data));
    };
    socket.onclose = (event) => {
      stopChecking();
      startOfflineClock();
      // A deploy's close carries none of the app's codes, which start at 4000.
      const deployed = openedAt !== undefined && Date.now() - openedAt > LONG_LIVED_MS && event.code < 4000;
      if (!options.onClose(event.code, openedAt !== undefined)) return;
      reconnect(deployed ? afterDeploy() : backoff());
    };
  };

  // Checks the socket once the tab has been shown a moment: an open one is pinged and reopened unless the
  // server answers within 3 seconds, and one waiting to connect again does so now, starting the back-off over.
  const probe = () => {
    if (stopped || document.visibilityState !== "visible") return;
    if (ws?.readyState === WebSocket.OPEN) {
      if (probeTimer !== undefined) return;
      const socket = ws;
      socket.send('{"type":"ping"}');
      probeTimer = setTimeout(() => {
        probeTimer = undefined;
        attempt = 0;
        dropped(socket, 0);
      }, PROBE_TIMEOUT_MS);
    } else if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      attempt = 0;
      open();
    }
  };
  const probeSoon = () => {
    clearTimeout(probeDelay);
    probeDelay = setTimeout(probe, PROBE_DELAY_MS);
  };
  const shown = () => document.visibilityState === "visible" && probeSoon();
  const restored = (event: PageTransitionEvent) => event.persisted && probeSoon();
  document.addEventListener("visibilitychange", shown);
  window.addEventListener("online", probeSoon);
  window.addEventListener("pageshow", restored);

  startOfflineClock();
  open();

  return {
    send(frame) {
      if (!admitted || ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(frame));
      return true;
    },
    connected() {
      admitted = true;
      attempt = 0;
      clearTimeout(offlineTimer);
      offlineTimer = undefined;
      if (!offline) return;
      offline = false;
      options.onOffline(false);
    },
    retry() {
      if (!stopped) reconnect(backoff());
    },
    close() {
      if (stopped) return;
      stopped = true;
      stopChecking();
      clearTimeout(retryTimer);
      clearTimeout(offlineTimer);
      clearTimeout(probeDelay);
      document.removeEventListener("visibilitychange", shown);
      window.removeEventListener("online", probeSoon);
      window.removeEventListener("pageshow", restored);
      if (!ws) return;
      ws.onclose = null;
      ws.close(1000);
    },
  };
}
