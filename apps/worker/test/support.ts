import type { ClientFrame, Room, RoomId, ServerFrame, User, UserId } from "@ember/protocol";
import { applyD1Migrations, reset, runInDurableObject, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { expect } from "vitest";
import { AUTHORIZED_AT_HEADER, ROOM_HEADER, SESSION_HEADER, USER_HEADER } from "../src/chat-room";
import type { Env } from "../src/env";
import worker from "../src/index";
import { workspace } from "../src/workspace";

export const origin = "https://ember.test";

/** `init` as the app's own pages send it: writes carry the `Sec-Fetch-Site` browsers add. */
function fromOwnPages<Cf>(init: RequestInit<Cf>): RequestInit<Cf> {
  const headers = new Headers(init.headers);
  const write = init.method !== undefined && init.method !== "GET" && init.method !== "HEAD";
  if (write && !headers.has("Sec-Fetch-Site")) headers.set("Sec-Fetch-Site", "same-origin");
  return { ...init, headers };
}

/** A request from the app's own pages. */
export const api = (path: string, init: RequestInit = {}) => exports.default.fetch(`${origin}${path}`, fromOwnPages(init));

/** The same request, to a Worker whose bindings differ from this suite's by `changes`. `path` may be a whole URL. */
export const apiWith = (changes: Partial<Env>, path: string, init: RequestInit<IncomingRequestCfProperties> = {}) =>
  worker.fetch(new Request(new URL(path, origin), fromOwnPages(init)), { ...(env as unknown as Env), ...changes });

/** Stands in for the built app's pages, which the worker tests run without: each answers with its path. */
export const builtPages = {
  fetch: async (input: Request | string) => new Response(`page ${new URL(input instanceof Request ? input.url : input).pathname}`, { headers: { "Content-Type": "text/html" } }),
} as unknown as Fetcher;

/**
 * Empties every Durable Object and the D1 database, which then gets its tables back, so a test starts
 * as a fresh deploy does: no account, people or rooms.
 */
export async function freshDeploy(): Promise<void> {
  await reset();
  const { DB, TEST_MIGRATIONS } = env as unknown as { DB?: D1Database; TEST_MIGRATIONS: D1Migration[] };
  if (DB) await applyD1Migrations(DB, TEST_MIGRATIONS);
  host = undefined;
}

export interface Session {
  user: User;
  /** The `Cookie` header that carries the session, `name=value`. */
  cookie: string;
}

/** The `name=value` a response's `Set-Cookie` sets. */
export const cookieOf = (response: Response) => response.headers.get("Set-Cookie")!.split(";")[0]!;

/** Signs in as a guest named `name`. */
export async function signIn(name: string): Promise<Session> {
  const response = await api("/api/session", { method: "POST", body: JSON.stringify({ name }) });
  expect(response.status).toBe(201);
  const { user } = (await response.json()) as { user: User };
  return { user, cookie: cookieOf(response) };
}

/** A room socket's upgrade request from the app's own pages, signed in with `cookie` if given. */
export const upgrade = (cookie?: string) => ({ headers: { Upgrade: "websocket", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });

/** The room's Durable Object. */
export const roomStub = (room: string) => (env as unknown as Env).CHAT_ROOM.getByName(room);

/** Who the Workspace let into a room, and when it checked. */
export interface Access {
  user: User;
  sessionId: string;
  authorizedAt: number;
}

/** A room socket's upgrade as the Worker sends it on to the room, once the Workspace has let it through. */
export const forwardUpgrade = (room: RoomId, { user, sessionId, authorizedAt }: Access) =>
  roomStub(room).fetch(`https://room/${room}`, {
    headers: { Upgrade: "websocket", [USER_HEADER]: JSON.stringify(user), [ROOM_HEADER]: room, [SESSION_HEADER]: sessionId, [AUTHORIZED_AT_HEADER]: String(authorizedAt) },
  });

/** How `ws` closes, once it does. */
export const closeOf = (ws: WebSocket) => new Promise<CloseEvent>((resolve) => ws.addEventListener("close", resolve));

/** The Workspace's Durable Object. */
export const workspaceStub = () => workspace(env as unknown as Env);

/** Runs SQL against a Durable Object's own SQLite storage, whichever backend this suite is using. */
export function objectSql(stub: DurableObjectStub, query: string, ...params: Array<string | number>): Promise<unknown[]> {
  return runInDurableObject(stub, (_object, state: DurableObjectState) => state.storage.sql.exec(query, ...params).toArray());
}

/** Runs SQL against the tables `stub` keeps: in D1 when this suite uses it, else in the object's own storage. */
async function tablesSql(stub: DurableObjectStub, query: string, ...params: Array<string | number>): Promise<unknown[]> {
  const db = (env as { DB?: D1Database }).DB;
  if (db) return (await db.prepare(query).bind(...params).all()).results;
  return objectSql(stub, query, ...params);
}

/** Runs SQL against a room's tables, whichever backend this suite is using. */
export const roomSql = (room: string, query: string, ...params: Array<string | number>) => tablesSql(roomStub(room), query, ...params);

/** Runs SQL against the Workspace's tables, whichever backend this suite is using. */
export const workspaceSql = (query: string, ...params: Array<string | number>) => tablesSql(workspaceStub(), query, ...params);

/** Who creates rooms for the tests, signed in once per test file. */
let host: Promise<Session> | undefined;

/**
 * Creates a room through the API as `as`, or as the tests' host: an open room everyone is in, or a
 * closed one for just the people `closedTo` names.
 */
export async function createRoom(name: string, { closedTo, as }: { closedTo?: UserId[]; as?: Session } = {}): Promise<Room> {
  const { cookie } = as ?? (await (host ??= signIn("Host")));
  const room = closedTo ? { kind: "closed", name, memberIds: closedTo } : { kind: "open", name };
  const response = await api("/api/rooms", { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify(room) });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { room: Room }).room;
}

/** A new open room, so tests never share a ChatRoom. Everyone is in it, whenever they sign in. */
export const freshRoom = async (label: string): Promise<RoomId> => (await createRoom(label)).id;

export type Client = Awaited<ReturnType<typeof connect>>;

/** Opens a room socket as `name` (or in an existing session) and queues every frame it receives. */
export async function connect(room: string, as: string | Session) {
  const session = typeof as === "string" ? await signIn(as) : as;
  const response = await api(`/api/rooms/${room}/socket`, upgrade(session.cookie));
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
    session,
    welcome,
    me: welcome.you,
    next,
    pending,
    log,
    // Any frame, the ones the protocol refuses included. Not `Record<string, unknown>`: once ClientFrame
    // has ten members, TypeScript checks an object literal against the member its `type` names alone.
    send: (frame: ClientFrame | { type: string; [field: string]: unknown }) => ws.send(JSON.stringify(frame)),
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
