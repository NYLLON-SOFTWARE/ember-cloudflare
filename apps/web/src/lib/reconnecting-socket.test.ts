import { feature } from "@ember/parity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_AFTER_MS, reconnectingSocket, type ReconnectingSocket, type ReconnectingSocketOptions, type SocketStatus } from "./reconnecting-socket";

/** Stands in for the browser's WebSocket; tests play the server and the network. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static all: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  closedWith: number | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number) {
    this.closedWith = code ?? 1005;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code: this.closedWith });
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  receive(data: string) {
    this.onmessage?.({ data });
  }

  /** Closes as the network or the server does: 1006 when the connection drops. */
  drop(code = 1006) {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }

  pings() {
    return this.sent.filter((data) => data === '{"type":"ping"}').length;
  }
}

const socket = () => FakeSocket.all.at(-1)!;
const wait = (ms: number) => vi.advanceTimersByTime(ms);
const visibility = (state: DocumentVisibilityState) => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  document.dispatchEvent(new Event("visibilitychange"));
};

// Each test's sockets, closed after it so they stop listening to the tab and the network.
const opened: ReconnectingSocket[] = [];

/** A socket whose owner records what it hears, and connects again after every close unless told otherwise. */
function connect(options: Partial<ReconnectingSocketOptions> = {}) {
  const heard = { messages: [] as string[], statuses: [] as SocketStatus[], offline: [] as boolean[] };
  const live = reconnectingSocket({
    url: () => "ws://localhost/socket",
    onMessage: (data) => heard.messages.push(data),
    onConnecting: (status) => heard.statuses.push(status),
    onOffline: (offline) => heard.offline.push(offline),
    onClose: () => true,
    ...options,
  });
  opened.push(live);
  return { live, heard };
}

/** A socket the server has let in, as a room's welcome does. */
function connected(options: Partial<ReconnectingSocketOptions> = {}) {
  const connection = connect(options);
  socket().open();
  connection.live.connected();
  return connection;
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5); // no jitter: delays come out exact
});

afterEach(() => {
  opened.splice(0).forEach((live) => live.close());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(feature("realtime.keepalive"), () => {
  it("connects to the address it's given, saying it's connecting, then reconnecting after a close", () => {
    const { heard } = connect();
    expect(socket().url).toBe("ws://localhost/socket");
    expect(heard.statuses).toEqual(["connecting"]);
    socket().drop();
    wait(500);
    expect(heard.statuses).toEqual(["connecting", "reconnecting", "reconnecting"]);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("sends only while the socket is open", () => {
    const { live } = connect();
    expect(live.send({ type: "typing.stop" })).toBe(false);
    socket().open();
    expect(live.send({ type: "typing.stop" })).toBe(true);
    expect(socket().sent).toEqual(['{"type":"typing.stop"}']);
  });

  it("hands on what the server sends", () => {
    const { heard } = connected();
    socket().receive('{"type":"pong"}');
    expect(heard.messages).toEqual(['{"type":"pong"}']);
  });

  it("checks the connection when the tab is shown, reopening it unless the server answers within 3 seconds", () => {
    connected();
    const silent = socket();
    visibility("hidden");
    wait(1_000);
    visibility("visible");
    wait(199);
    expect(silent.pings()).toBe(0);
    wait(1);
    expect(silent.pings()).toBe(1);
    wait(2_999);
    expect(silent.readyState).toBe(FakeSocket.OPEN);
    wait(1);
    expect(silent.readyState).toBe(FakeSocket.CLOSED);
    // Straight away: fake timers count a timer set during a tick as a millisecond.
    wait(1);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("keeps a connection that answers when the tab is shown", () => {
    connected();
    visibility("visible");
    wait(200);
    socket().receive('{"type":"pong"}');
    wait(10_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(socket().readyState).toBe(FakeSocket.OPEN);
  });

  it.each([
    ["the network comes back", () => window.dispatchEvent(new Event("online"))],
    ["the tab is shown", () => visibility("visible")],
    ["the page comes back from the back-forward cache", () => window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }))],
  ])("connects at once when %s while waiting to retry, starting the back-off over", (_case, comeBack) => {
    connected();
    socket().drop();
    wait(500);
    socket().drop();
    wait(1_000);
    socket().drop();
    // It would wait 2 seconds now.
    comeBack();
    wait(200);
    expect(FakeSocket.all).toHaveLength(4);
    socket().drop();
    wait(500);
    expect(FakeSocket.all).toHaveLength(5);
  });

  it("checks nothing for a hidden tab, or a page shown for the first time", () => {
    connected();
    socket().drop();
    visibility("hidden");
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
    wait(499);
    expect(FakeSocket.all).toHaveLength(1);
    wait(1);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("tries again when a socket doesn't open within 10 seconds", () => {
    connect();
    const hung = socket();
    wait(9_999);
    expect(hung.readyState).toBe(FakeSocket.CONNECTING);
    wait(1);
    expect(hung.readyState).toBe(FakeSocket.CLOSED);
    wait(500);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("spreads its first try after a deploy, which closes every long-lived socket at once", () => {
    connected();
    for (let i = 0; i < 2; i++) {
      wait(25_000);
      socket().receive('{"type":"pong"}');
    }
    wait(10_001);
    socket().drop(1001);
    // 250ms to 2 seconds, rather than half a second.
    wait(1_124);
    expect(FakeSocket.all).toHaveLength(1);
    wait(1);
    expect(FakeSocket.all).toHaveLength(2);
    socket().drop();
    wait(1_000);
    expect(FakeSocket.all).toHaveLength(3);
  });

  it("doesn't spread a try after a young socket closes, or after the app's own close", () => {
    const { live } = connected();
    socket().drop(1001);
    wait(500);
    expect(FakeSocket.all).toHaveLength(2);

    socket().open();
    live.connected();
    for (let i = 0; i < 3; i++) {
      wait(20_001);
      socket().receive('{"type":"pong"}');
    }
    socket().drop(4001);
    wait(500);
    expect(FakeSocket.all).toHaveLength(3);
  });

  it("leaves a close to its owner when the owner says so, until it asks to retry", () => {
    const { live, heard } = connected({ onClose: (code) => code !== 4003 });
    socket().drop(4003);
    wait(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(heard.statuses).toEqual(["connecting"]);
    live.retry();
    expect(heard.statuses).toEqual(["connecting", "reconnecting"]);
    wait(500);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("stops for good when closed, whatever the tab or the network does", () => {
    const { live, heard } = connected();
    live.close();
    expect(socket().closedWith).toBe(1000);
    visibility("visible");
    window.dispatchEvent(new Event("online"));
    live.retry();
    wait(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(socket().pings()).toBe(0);
    expect(heard.offline).toEqual([]);
  });
});

describe(feature("realtime.reconnect"), () => {
  it(`counts as offline ${OFFLINE_AFTER_MS / 1000} seconds after the connection drops, until the server lets one in again`, () => {
    const { live, heard } = connected();
    socket().drop();
    wait(OFFLINE_AFTER_MS - 1);
    expect(heard.offline).toEqual([]);
    wait(1);
    expect(heard.offline).toEqual([true]);
    // It opens, but the server hasn't let it in yet.
    socket().open();
    expect(heard.offline).toEqual([true]);
    live.connected();
    expect(heard.offline).toEqual([true, false]);
  });

  it("doesn't count a short drop", () => {
    const { live, heard } = connected();
    socket().drop();
    wait(500);
    socket().open();
    live.connected();
    wait(10_000);
    expect(heard.offline).toEqual([]);
  });

  it("counts a first connection that takes too long", () => {
    const { heard } = connect();
    wait(OFFLINE_AFTER_MS);
    expect(heard.offline).toEqual([true]);
  });

  it("counts from when a silent connection is found dead", () => {
    const { heard } = connected();
    const silent = socket();
    wait(50_000);
    expect(silent.readyState).toBe(FakeSocket.CLOSED);
    wait(OFFLINE_AFTER_MS - 1);
    expect(heard.offline).toEqual([]);
    wait(1);
    expect(heard.offline).toEqual([true]);
  });
});
