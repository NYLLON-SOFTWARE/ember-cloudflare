import type { ClientFrame, ServerFrame, User } from "@ember/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { expect } from "vitest";

export const origin = "https://ember.test";

export function api(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(`${origin}${path}`, init);
}

export async function signIn(name: string): Promise<{ user: User; token: string }> {
  const response = await api("/api/session", { method: "POST", body: JSON.stringify({ name }) });
  expect(response.status).toBe(201);
  return response.json();
}

/** The room's Durable Object. */
export const roomStub = (room: string) => (env as unknown as { CHAT_ROOM: DurableObjectNamespace }).CHAT_ROOM.getByName(room);

/** Runs SQL against a room's storage, whichever backend this suite is using. */
export async function roomSql(room: string, query: string, ...params: Array<string | number>): Promise<unknown[]> {
  const db = (env as { DB?: D1Database }).DB;
  if (db) return (await db.prepare(query).bind(...params).all()).results;
  return runInDurableObject(roomStub(room), (_room, state: DurableObjectState) => state.storage.sql.exec(query, ...params).toArray());
}

/** A unique room name, so tests never share a ChatRoom. */
export const freshRoom = (label: string) => `${label}-${crypto.randomUUID().slice(0, 8)}`;

export type Client = Awaited<ReturnType<typeof connect>>;

/** Opens a room socket as `name` (or with an existing token) and queues every frame it receives. */
export async function connect(room: string, as: string | { token: string }) {
  const { token } = typeof as === "string" ? await signIn(as) : as;
  const response = await api(`/api/rooms/${room}/socket?token=${token}`, { headers: { Upgrade: "websocket" } });
  const ws = response.webSocket;
  if (!ws) throw new Error(`No socket: ${response.status} ${await response.text()}`);
  ws.accept();

  const frames: ServerFrame[] = [];
  /** Every frame received, in order, whether or not it has been read. */
  const log: ServerFrame[] = [];
  const waiters: Array<() => void> = [];
  ws.addEventListener("message", (event) => {
    const frame = JSON.parse(event.data as string) as ServerFrame;
    frames.push(frame);
    log.push(frame);
    waiters.splice(0).forEach((wake) => wake());
  });

  /** The next unread frame of `type`, waiting for it if need be. */
  async function next<T extends ServerFrame["type"]>(type: T): Promise<Extract<ServerFrame, { type: T }>> {
    for (;;) {
      const index = frames.findIndex((f) => f.type === type);
      if (index >= 0) return frames.splice(index, 1)[0] as Extract<ServerFrame, { type: T }>;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  }

  /** Unread frames of `type` that have already arrived. */
  const pending = (type: ServerFrame["type"]) => frames.filter((f) => f.type === type);

  const welcome = await next("welcome");
  return {
    ws,
    token,
    welcome,
    me: welcome.you,
    next,
    pending,
    log,
    send: (frame: ClientFrame | Record<string, unknown>) => ws.send(JSON.stringify(frame)),
    sendRaw: (data: string | ArrayBuffer) => ws.send(data),
    close: () => ws.close(1000),
  };
}

/** Posts a message and waits for the room to confirm it. */
export async function post(client: Client, body: string, clientMessageId = crypto.randomUUID()) {
  client.send({ type: "message.create", clientMessageId, body });
  for (;;) {
    const { message } = await client.next("message.created");
    if (message.clientMessageId === clientMessageId) return message;
  }
}

/**
 * Lets frames already on their way arrive. A room handles frames one at a time, so once each
 * client in turn has a reply to a ping, everything sent before has been handled and delivered.
 * (A ping with extra fields reaches the room; the bare `{"type":"ping"}` is answered by the runtime.)
 */
export async function settle(...clients: Client[]): Promise<void> {
  for (const client of clients) {
    client.send({ type: "ping", nonce: crypto.randomUUID() });
    await client.next("pong");
  }
}
