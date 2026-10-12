import type { ClientFrame, Message, ServerFrame, User } from "@ember/protocol";

// A lightweight room participant for load tests: one WebSocket to a ChatRoom, the same frames the
// web app sends, and just enough bookkeeping to measure latency without becoming the bottleneck.

export interface Session {
  user: User;
  token: string;
}

const CONNECT_TIMEOUT_MS = 30_000;
const HISTORY_TIMEOUT_MS = 30_000;

type HistoryFrame = Extract<ServerFrame, { type: "history" }>;

export async function signIn(baseUrl: string, name: string): Promise<Session> {
  const response = await fetch(new URL("/api/session", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (response.status !== 201) throw new Error(`Sign-in failed (${response.status}): ${await response.text()}`);
  return (await response.json()) as Session;
}

export function socketUrl(baseUrl: string, room: string, token: string): string {
  const url = new URL(`/api/rooms/${encodeURIComponent(room)}/socket`, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}

export class RoomClient {
  /** Called with each message.created frame and the time it arrived. */
  onMessage: ((message: Message, at: number) => void) | null = null;
  /** Bytes of presence frames received. They grow with the room, so they're counted, not parsed. */
  presenceBytes = 0;
  /** Messages that arrived with an id lower than one already seen. */
  outOfOrder = 0;
  boostsCreated = 0;
  errors: string[] = [];
  lastFrameAt = 0;

  readonly session: Session;
  private readonly ws: WebSocket;
  private lastMessageId = "";
  /** Settles the history request in flight, with its page or why it failed. */
  private pendingHistory: ((answer: HistoryFrame | Error) => void) | null = null;

  private constructor(session: Session, ws: WebSocket) {
    this.session = session;
    this.ws = ws;
  }

  /** Opens a socket and resolves once the room's welcome frame arrives. */
  static connect(baseUrl: string, room: string, session: Session): Promise<{ client: RoomClient; welcome: Extract<ServerFrame, { type: "welcome" }>; ms: number }> {
    const started = performance.now();
    const ws = new WebSocket(socketUrl(baseUrl, room, session.token));
    const client = new RoomClient(session, ws);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error(`No welcome from ${room} after ${CONNECT_TIMEOUT_MS}ms`)), CONNECT_TIMEOUT_MS);
      const fail = (error: Error) => {
        clearTimeout(timer);
        ws.close();
        reject(error);
      };
      ws.onerror = () => fail(new Error(`Socket to ${room} failed`));
      ws.onclose = (event) => fail(new Error(`Socket to ${room} closed (${event.code}) before its welcome`));
      ws.onmessage = (event) => {
        const frame = JSON.parse(event.data as string) as ServerFrame;
        if (frame.type !== "welcome") return;
        clearTimeout(timer);
        const ms = performance.now() - started;
        ws.onerror = null;
        ws.onclose = (event) => client.pendingHistory?.(new Error(`Socket to ${room} closed (${event.code}) during a history request`));
        ws.onmessage = (next) => client.receive(next.data as string);
        client.lastMessageId = frame.messages.at(-1)?.id ?? "";
        resolve({ client, welcome: frame, ms });
      };
    });
  }

  send(frame: ClientFrame): void {
    this.ws.send(JSON.stringify(frame));
  }

  /** Asks for the page of history before `before` and resolves with it and how long it took. */
  history(before: string, limit: number): Promise<{ messages: Message[]; hasMore: boolean; ms: number }> {
    if (this.pendingHistory) throw new Error("One history request at a time");
    const started = performance.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.pendingHistory?.(new Error(`No history page after ${HISTORY_TIMEOUT_MS}ms`)), HISTORY_TIMEOUT_MS);
      this.pendingHistory = (answer) => {
        clearTimeout(timer);
        this.pendingHistory = null;
        if (answer instanceof Error) reject(answer);
        else resolve({ messages: answer.messages, hasMore: answer.hasMore, ms: performance.now() - started });
      };
      this.send({ type: "history.before", before, limit });
    });
  }

  /** Starts closing without waiting for the handshake; nothing here needs to see it finish. */
  close(): void {
    this.ws.close(1000);
  }

  private receive(data: string): void {
    const at = performance.now();
    this.lastFrameAt = at;
    if (data.startsWith('{"type":"presence"')) {
      this.presenceBytes += data.length;
      return;
    }

    const frame = JSON.parse(data) as ServerFrame;
    switch (frame.type) {
      case "message.created":
        if (frame.message.id < this.lastMessageId) this.outOfOrder++;
        else this.lastMessageId = frame.message.id;
        this.onMessage?.(frame.message, at);
        return;
      case "boost.created":
        this.boostsCreated++;
        return;
      case "history":
        this.pendingHistory?.(frame);
        return;
      case "error":
        this.errors.push(frame.message);
        // Only message.create errors name their frame, so one without an id answers a pending history request.
        if (!frame.clientMessageId) this.pendingHistory?.(new Error(`History request failed: ${frame.message}`));
        return;
    }
  }
}
