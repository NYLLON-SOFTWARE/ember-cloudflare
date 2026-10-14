import { isRoomId, parseNewRoom, type Bootstrap, type RoomId } from "@ember/protocol";
import {
  authenticate,
  clientOf,
  credentialsFor,
  credentialsOf,
  expiredSessionCookie,
  guestSignIn,
  isCrossSite,
  isSameOriginUpgrade,
  newSessionToken,
  sessionCookie,
  sessionToken,
  signOut,
  tokenDigest,
} from "./auth";
import { ROOM_HEADER, USER_HEADER } from "./chat-room";
import type { Env } from "./env";
import { firstRun, isSetupPath, isSetupProtected, setupPage, setupTokenProblem } from "./setup";
import { ACCOUNT_NAME, workspace } from "./workspace";

export { ChatRoom } from "./chat-room";
export { PasswordHasher } from "./passwords";
export { Workspace } from "./workspace";

const MAX_NAME_LENGTH = 48;
/** The room object /api/health reads from. No room can have this name, since room ids can't hold "_". */
const HEALTH_ROOM = "_health";
/** ember-rust's alert for a room someone can't open, whether it's missing or they aren't in it. */
const ROOM_NOT_FOUND = "Room not found or inaccessible";

const json = (data: unknown, init?: ResponseInit) => Response.json(data, init);
const problem = (status: number, message: string) => json({ error: message }, { status });

/**
 * Answers 200 once the Worker can sign people in and the Workspace and a room's object both read
 * their storage, so a deploy can be checked without signing in.
 */
async function health(env: Env): Promise<Response> {
  const storage = env.STORAGE_BACKEND;
  if (!env.SESSION_SECRET) return json({ ok: false, storage, error: "SESSION_SECRET isn't set" }, { status: 503 });
  const setupToken = setupTokenProblem(env);
  if (setupToken) return json({ ok: false, storage, error: setupToken }, { status: 503 });
  try {
    await Promise.all([workspace(env).health(), env.CHAT_ROOM.getByName(HEALTH_ROOM).health(HEALTH_ROOM)]);
  } catch (error) {
    console.error("Health check failed", error);
    return json({ ok: false, storage, error: "Storage isn't answering" }, { status: 503 });
  }
  return json({ ok: true, storage });
}

/** Signs someone in with just a name, as someone new every time, when EMBER_GUEST_SIGN_IN allows it. */
async function signInGuest(request: Request, env: Env): Promise<Response> {
  if (!guestSignIn(env)) return problem(403, "Signing in with just a name is turned off");
  // Any JSON value parses, null included, so don't assume an object.
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) return problem(422, `Name must be 1 to ${MAX_NAME_LENGTH} characters`);

  const token = newSessionToken();
  const user = await workspace(env).signInGuest(name, await tokenDigest(token, env.SESSION_SECRET), clientOf(request));
  return json({ user }, { status: 201, headers: { "Set-Cookie": sessionCookie(request, token) } });
}

/** What the app asks first: whether Ember is set up yet, and who this browser is signed in as. */
async function bootstrap(request: Request, env: Env): Promise<Response> {
  const token = sessionToken(request);
  const { account, user } = await workspace(env).bootstrap(token ? await credentialsFor(token, request, env) : null);
  const body: Bootstrap = {
    setup: account ? "complete" : "pending",
    setupProtected: isSetupProtected(env),
    guestSignIn: guestSignIn(env),
    account: account ?? { name: ACCOUNT_NAME },
    user,
  };
  const headers = new Headers({ "Cache-Control": "no-store" });
  // The app asks every time it loads, so sending the cookie again keeps it from expiring while it's in use.
  if (user && token) headers.set("Set-Cookie", sessionCookie(request, token));
  return json(body, { headers });
}

async function me(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return problem(401, "Not signed in");
  // The app asks every time it loads, so sending the cookie again keeps it from expiring while it's in use.
  return json({ user: session.user }, { headers: { "Set-Cookie": sessionCookie(request, session.token) } });
}

async function endSession(request: Request, env: Env): Promise<Response> {
  await signOut(request, env);
  return new Response(null, { status: 204, headers: { "Set-Cookie": expiredSessionCookie(request) } });
}

/** The rooms the signed-in person is in. */
async function listRooms(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const rooms = credentials && (await workspace(env).rooms(credentials));
  return rooms ? json({ rooms }) : problem(401, "Not signed in");
}

/** Creates an open room, or a closed one for the people it names. Only the tests and load tests ask yet. */
async function createRoom(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "Not signed in");
  const room = parseNewRoom(await request.json().catch(() => null));
  if (typeof room === "string") return problem(422, room);
  const created = await workspace(env).createRoom(credentials, room);
  return created ? json({ room: created }, { status: 201 }) : problem(401, "Not signed in");
}

async function connectToRoom(request: Request, env: Env, roomId: RoomId): Promise<Response> {
  // As with Action Cable, the address is only there for upgrades from the app's own pages.
  if (request.headers.get("Upgrade") !== "websocket" || !isSameOriginUpgrade(request)) return problem(404, "Not found");
  const credentials = await credentialsOf(request, env);
  const access = credentials && (await workspace(env).roomAccess(credentials, roomId));
  if (!access) return problem(401, "Sign in first");
  // Without waking the room's object, so a room nobody may open is never created.
  if (!access.member) return problem(404, ROOM_NOT_FOUND);

  const headers = new Headers(request.headers);
  headers.set(USER_HEADER, JSON.stringify(access.user));
  headers.set(ROOM_HEADER, roomId);
  return env.CHAT_ROOM.getByName(roomId).fetch(new Request(request, { headers }));
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health") return health(env);
    const write = request.method !== "GET" && request.method !== "HEAD";
    if (write && pathname.startsWith("/api/") && isCrossSite(request)) return problem(422, "Requests from other sites are refused");

    if (pathname === "/api/bootstrap" && request.method === "GET") return bootstrap(request, env);
    if (pathname === "/api/first_run" && request.method === "POST") return firstRun(request, env);
    if (pathname === "/api/session" && request.method === "POST") return signInGuest(request, env);
    if (pathname === "/api/session" && request.method === "DELETE") return endSession(request, env);
    if (pathname === "/api/me") return me(request, env);
    if (pathname === "/api/rooms" && request.method === "GET") return listRooms(request, env);
    if (pathname === "/api/rooms" && request.method === "POST") return createRoom(request, env);

    const socket = pathname.match(/^\/api\/rooms\/([^/]+)\/socket$/);
    if (socket) {
      // Room ids never need percent-encoding, so an encoded segment can only be an unknown room.
      const roomId = socket[1]!;
      return isRoomId(roomId) ? connectToRoom(request, env, roomId) : problem(404, ROOM_NOT_FOUND);
    }

    if (pathname.startsWith("/api/")) return problem(404, "Not found");
    if (isSetupPath(pathname)) return setupPage(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
