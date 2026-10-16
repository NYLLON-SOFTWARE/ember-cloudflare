import {
  ROOM_PROTOCOL,
  roomSocketQuery,
  type ClientFrame,
  type DirectRoom,
  type Me,
  type Room,
  type RoomIconChoice,
  type RoomId,
  type RoomSocketParams,
  type ServerFrame,
  type SharedRoom,
  type User,
  type UserId,
  type WorkspaceServerFrame,
} from "@ember/protocol";
import { applyD1Migrations, reset, runInDurableObject, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { expect } from "vitest";
import { ADDRESS_HEADER, AUTHORIZED_AT_HEADER, BANNED_HEADER, ROOM_HEADER, SESSION_HEADER, USER_HEADER } from "../src/chat-room";
import type { Env } from "../src/env";
import worker from "../src/index";
import { searchIndex } from "../src/search-index";
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
  // A reset can leave the storage of a Durable Object that's still busy, as the Workspace is while its
  // alarm delivers what the last test queued, so it's made again until the Workspace has nobody.
  do {
    await reset();
    const { DB, TEST_MIGRATIONS } = env as unknown as { DB?: D1Database; TEST_MIGRATIONS: D1Migration[] };
    if (DB) await applyD1Migrations(DB, TEST_MIGRATIONS);
  } while (await anyoneLeft());
  host = undefined;
}

const anyoneLeft = async () => ((await workspaceSql("SELECT count(*) AS n FROM users")) as Array<{ n: number }>)[0]!.n > 0;

export interface Session {
  user: User;
  /** The `Cookie` header that carries the session, `name=value`. */
  cookie: string;
  /** The IP address its sockets come from, as Cloudflare's `CF-Connecting-IP` says, if any. */
  ip?: string;
}

/** The `name=value` a response's `Set-Cookie` sets. */
export const cookieOf = (response: Response) => response.headers.get("Set-Cookie")!.split(";")[0]!;

/** Someone as rooms and lists show them, without what the app keeps about whoever is signed in. */
export const shown = ({ id, name }: User | Me): User => ({ id, name });

/** Signs in as a guest named `name`. */
export async function signIn(name: string): Promise<Session> {
  const response = await api("/api/session", { method: "POST", body: JSON.stringify({ name }) });
  expect(response.status).toBe(201);
  const { user } = (await response.json()) as { user: Me };
  return { user: shown(user), cookie: cookieOf(response) };
}

/** A room socket's upgrade request from the app's own pages, signed in with `cookie` if given, from the IP address `ip` if given. */
export const upgrade = (cookie?: string, ip?: string) => ({
  headers: { Upgrade: "websocket", Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(ip ? { "CF-Connecting-IP": ip } : {}) },
});

/** The room's Durable Object. */
export const roomStub = (room: string) => (env as unknown as Env).CHAT_ROOM.getByName(room);

/** Who the Workspace let into a room, and when it checked, and the IP address their socket comes from and whether a ban blocks it, if said. */
export interface Access {
  user: User;
  sessionId: string;
  authorizedAt: number;
  address?: string;
  banned?: boolean;
}

/** A room socket's upgrade as the Worker sends it on to the room, once the Workspace has let it through. */
export const forwardUpgrade = (room: RoomId, { user, sessionId, authorizedAt, address, banned = false }: Access) =>
  roomStub(room).fetch(`https://room/${room}?protocol=${ROOM_PROTOCOL}`, {
    headers: {
      Upgrade: "websocket",
      [USER_HEADER]: JSON.stringify(user),
      [ROOM_HEADER]: room,
      [SESSION_HEADER]: sessionId,
      [AUTHORIZED_AT_HEADER]: String(authorizedAt),
      [BANNED_HEADER]: String(banned),
      ...(address ? { [ADDRESS_HEADER]: address } : {}),
    },
  });

/**
 * What a socket the Worker sends on to the room comes to: let in and welcomed, or closed at once,
 * with a code and reason. A socket let in is closed again once it's welcomed.
 */
export async function outcome(room: RoomId, access: Access): Promise<"welcome" | { code: number; reason: string }> {
  const ws = (await forwardUpgrade(room, access)).webSocket!;
  ws.accept();
  let welcomed = false;
  ws.addEventListener("message", (event) => {
    welcomed = (JSON.parse(event.data as string) as { type: string }).type === "welcome";
    ws.close(1000);
  });
  const { code, reason } = await closeOf(ws);
  return welcomed ? "welcome" : { code, reason };
}

/** How `ws` closes, once it does. */
export const closeOf = (ws: WebSocket) => new Promise<CloseEvent>((resolve) => ws.addEventListener("close", resolve));

/** The Workspace's Durable Object. */
export const workspaceStub = () => workspace(env as unknown as Env);

/** The search index's Durable Object. */
export const searchIndexStub = () => searchIndex(env as unknown as Env);

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

/** Runs SQL against the search index's tables, which it keeps in its own storage on either backend. */
export const searchSql = (query: string, ...params: Array<string | number>) => objectSql(searchIndexStub(), query, ...params);

/** Who creates rooms for the tests, signed in once per test file. */
let host: Promise<Session> | undefined;

/**
 * Creates a room through the API as `as`, or as the tests' host: an open room everyone is in, or a
 * closed one for just the people `closedTo` names.
 */
export async function createRoom(name: string, { closedTo, icon, as }: { closedTo?: UserId[]; icon?: RoomIconChoice; as?: Session } = {}): Promise<SharedRoom> {
  const { cookie } = as ?? (await (host ??= signIn("Host")));
  const room = closedTo ? { kind: "closed", name, icon, memberIds: closedTo } : { kind: "open", name, icon };
  const response = await api("/api/rooms", { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify(room) });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { room: SharedRoom }).room;
}

/** Starts a DM through the API as `as`, with the people `userIds` names, answering how the Worker answered. */
export const startDirect = (as: Session, userIds: unknown) =>
  api("/api/directs", { method: "POST", headers: { Cookie: as.cookie }, body: JSON.stringify({ userIds }) });

/** Starts the DM between `as` and `people`, or opens the one they have, answering it. */
export async function direct(as: Session, ...people: Session[]): Promise<DirectRoom> {
  const response = await startDirect(as, people.map((person) => person.user.id));
  expect([200, 201], await response.clone().text()).toContain(response.status);
  return ((await response.json()) as { room: DirectRoom }).room;
}

/** Adds someone who has left the workspace, as deactivating them will, answering their id. */
export async function deactivatedPerson(name: string): Promise<UserId> {
  const id = `former-${crypto.randomUUID()}`;
  await workspaceSql(`INSERT INTO users (id, name, status, created_at, updated_at) VALUES (?, ?, 1, 'now', 'now')`, id, name);
  return id;
}

/** `room` as the sidebar lists it to someone it isn't marked unread for. */
export const listedRoom = <T extends Room>(room: T) => ({ ...room, unread: false });

/** A new open room, so tests never share a ChatRoom. Everyone is in it, whenever they sign in. */
export const freshRoom = async (label: string): Promise<RoomId> => (await createRoom(label)).id;

export type Client = Awaited<ReturnType<typeof connect>>;

/** A room socket opened by `connect` or `reconnect`. */
export type Socket = Awaited<ReturnType<typeof openSocket>>;

/**
 * Opens a room socket as `name` (or in an existing session), queues every frame it receives, and
 * waits for its welcome. Its address names the room protocol's revision, as the app's do, and says
 * whether its tab is shown only when `params` does. An `outdated` tab's names nothing, as the app's
 * did before rich text.
 */
export async function connect(room: string, as: string | Session, params?: RoomSocketParams | "outdated") {
  const socket = await openSocket(room, typeof as === "string" ? await signIn(as) : as, params);
  const welcome = await socket.next("welcome");
  return { ...socket, welcome, me: welcome.you };
}

/**
 * Opens a room socket in `session`, as a tab that has seen the room's change `since` connects again,
 * and waits for what the room opens it with: `resumed`, or a welcome.
 */
export async function reconnect(room: string, session: Session, since: number) {
  const socket = await openSocket(room, session, { visible: true, since });
  return { ...socket, opening: await socket.next("welcome", "resumed") };
}

/** Opens a room socket in `session` and queues every frame it receives. */
async function openSocket(room: string, session: Session, params?: RoomSocketParams | "outdated") {
  const query = params === "outdated" ? "" : params ? roomSocketQuery(params) : `?protocol=${ROOM_PROTOCOL}`;
  const response = await api(`/api/rooms/${room}/socket${query}`, upgrade(session.cookie, session.ip));
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

  /** The next unread frame of one of `types`, waiting for it if need be. */
  async function next<T extends ServerFrame["type"]>(...types: T[]): Promise<Extract<ServerFrame, { type: T }>> {
    for (;;) {
      const index = frames.findIndex((f) => (types as string[]).includes(f.type));
      if (index >= 0) return frames.splice(index, 1)[0] as Extract<ServerFrame, { type: T }>;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  }

  /** Unread frames of `type` that have already arrived. */
  const pending = (type: ServerFrame["type"]) => frames.filter((f) => f.type === type);

  return {
    ws,
    session,
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
export async function post(client: Socket, body: string, clientMessageId = crypto.randomUUID()) {
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
export async function settle(...clients: Socket[]): Promise<void> {
  for (const client of clients) {
    client.send({ type: "ping", nonce: crypto.randomUUID() });
    await client.next("pong");
  }
}

/** Opens a workspace socket in `session`, as a tab does, and queues what the Workspace sends on it after its welcome. */
export async function openWorkspaceSocket(session: Session) {
  const response = await api("/api/socket", upgrade(session.cookie));
  if (!response.webSocket) throw new Error(`No socket: ${response.status} ${await response.text()}`);
  const ws = response.webSocket;
  const frames: WorkspaceServerFrame[] = [];
  const waiters: Array<() => void> = [];
  ws.addEventListener("message", (event) => {
    frames.push(JSON.parse(event.data as string) as WorkspaceServerFrame);
    waiters.splice(0).forEach((wake) => wake());
  });
  const closed = closeOf(ws);
  ws.accept();

  /** The next frame, waiting for it if need be. */
  async function next(): Promise<WorkspaceServerFrame> {
    while (frames.length === 0) await new Promise<void>((resolve) => waiters.push(resolve));
    return frames.shift()!;
  }

  /** Whether the Workspace still answers on it. A ping with more than its type reaches the Workspace itself. */
  async function answers(): Promise<boolean> {
    ws.send(JSON.stringify({ type: "ping", nonce: crypto.randomUUID() }));
    return (await next()).type === "pong";
  }

  const welcome = await next();
  return { ws, welcome, next, answers, closed, send: (data: string) => ws.send(data) };
}

export type WorkspaceSocket = Awaited<ReturnType<typeof openWorkspaceSocket>>;
