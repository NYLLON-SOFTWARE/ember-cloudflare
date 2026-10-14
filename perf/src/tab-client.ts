import { setTimeout as sleep } from "node:timers/promises";
import type { WorkspaceServerFrame } from "@ember/protocol";
import { RoomClient, type Session } from "./room-client.ts";

// A browser tab for load tests, opened as the web app opens one: a room's socket, the tab's
// workspace socket and the sidebar, which it loads again on each of the workspace's welcomes, naming
// the copy it has.

/** Node's WebSocket, which, unlike a browser's, can send a handshake's headers. */
const NodeWebSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;

const CONNECT_TIMEOUT_MS = 30_000;

export function workspaceSocketUrl(baseUrl: string): string {
  const url = new URL("/api/socket", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** Opens `session`'s workspace socket, as a tab does, and resolves with it once its welcome comes, and how long that took in milliseconds. */
export function connectWorkspace(baseUrl: string, session: Session): Promise<{ ws: WebSocket; ms: number }> {
  const started = performance.now();
  const ws = new NodeWebSocket(workspaceSocketUrl(baseUrl), { headers: { Cookie: session.cookie, Origin: new URL(baseUrl).origin } });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error(`No welcome from the Workspace after ${CONNECT_TIMEOUT_MS}ms`)), CONNECT_TIMEOUT_MS);
    const fail = (error: Error) => {
      clearTimeout(timer);
      ws.onerror = ws.onclose = ws.onmessage = null;
      ws.close();
      reject(error);
    };
    ws.onerror = () => fail(new Error("Workspace socket failed"));
    ws.onclose = (event) => fail(new Error(`Workspace socket closed (${event.code}) before its welcome`));
    ws.onmessage = (event) => {
      if ((JSON.parse(event.data as string) as WorkspaceServerFrame).type !== "welcome") return;
      clearTimeout(timer);
      ws.onerror = ws.onclose = ws.onmessage = null;
      resolve({ ws, ms: performance.now() - started });
    };
  });
}

/** How long each socket waits before connecting again, in milliseconds. */
export interface Delays {
  room: number;
  workspace: number;
}

/** How long each part of opening a tab took, in milliseconds. */
export interface TabTimings {
  /** Opening the workspace socket to its welcome. */
  welcome: number;
  /** Opening the room's socket to its welcome. */
  roomWelcome: number;
  /** Each load of the sidebar, asking to answer, whether a new copy or 304. */
  sidebar: number[];
}

export class TabClient {
  readonly session: Session;
  private readonly baseUrl: string;
  private readonly roomId: string;
  private workspace: WebSocket | null = null;
  private room: RoomClient | null = null;
  /** The ETag of the sidebar this tab has. */
  private etag: string | null = null;

  constructor(baseUrl: string, session: Session, roomId: string) {
    this.baseUrl = baseUrl;
    this.session = session;
    this.roomId = roomId;
  }

  /** Opens the tab as loading the page does: the sidebar and both sockets at once. */
  open(): Promise<TabTimings> {
    return this.connect(this.loadSidebar(), { room: 0, workspace: 0 });
  }

  /** Connects both sockets again once each has waited as long as `delays` says, as the app does once they close. */
  reopen(delays: Delays): Promise<TabTimings> {
    return this.connect(null, delays);
  }

  /** Starts closing both sockets without waiting for the handshakes. */
  close(): void {
    this.workspace?.close(1000);
    this.room?.close();
  }

  /**
   * Opens both sockets, and loads the sidebar again on the workspace's welcome once `loading`, the
   * load already on its way, if any, has come, as the app has one on its way at a time. If anything
   * fails, it closes whatever opened.
   */
  private async connect(loading: Promise<number> | null, delays: Delays): Promise<TabTimings> {
    // Awaited only after the welcome, so a failure before then mustn't count as unhandled.
    loading?.catch(() => {});
    const [workspace, room] = await Promise.allSettled([
      sleep(delays.workspace)
        .then(() => this.connectWorkspace())
        .then(async (welcome) => {
          const sidebar = loading ? [await loading] : [];
          sidebar.push(await this.loadSidebar());
          return { welcome, sidebar };
        }),
      sleep(delays.room).then(() => RoomClient.connect(this.baseUrl, this.roomId, this.session)),
    ]);
    if (room.status === "fulfilled") this.room = room.value.client;
    if (workspace.status === "rejected" || room.status === "rejected") {
      this.close();
      throw workspace.status === "rejected" ? workspace.reason : (room as PromiseRejectedResult).reason;
    }
    return { welcome: workspace.value.welcome, roomWelcome: room.value.ms, sidebar: workspace.value.sidebar };
  }

  /** Opens the workspace socket and resolves with the milliseconds to its welcome. */
  private async connectWorkspace(): Promise<number> {
    const { ws, ms } = await connectWorkspace(this.baseUrl, this.session);
    this.workspace = ws;
    return ms;
  }

  /** Loads the sidebar, naming the copy this tab has, and resolves with the milliseconds it took. */
  private async loadSidebar(): Promise<number> {
    const started = performance.now();
    const response = await fetch(new URL("/api/sidebar", this.baseUrl), { headers: { Cookie: this.session.cookie, ...(this.etag ? { "If-None-Match": this.etag } : {}) } });
    if (response.status !== 304) {
      if (!response.ok) throw new Error(`Loading the sidebar failed (${response.status}): ${await response.text()}`);
      await response.arrayBuffer();
      this.etag = response.headers.get("ETag");
    }
    return performance.now() - started;
  }
}
