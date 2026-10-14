import { isPasswordTooLong, isRoomId, parseNewRoom, SIGN_IN_REFUSED, type Bootstrap, type RoomId, type RoomList } from "@ember/protocol";
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
import { ROOM_HEADER, SESSION_HEADER, USER_HEADER } from "./chat-room";
import type { Env } from "./env";
import { join, joinCodeOf, joinPage } from "./join";
import { manifest, manifestFormatOf } from "./manifest";
import { DUMMY_DIGEST, passwordHasher } from "./passwords";
import { showQrCode } from "./qr-code";
import { firstRun, isSetupPath, isSetupProtected, setupPage, setupTokenProblem } from "./setup";
import { unfurlLink } from "./unfurl";
import { versionOf } from "./version";
import { ACCOUNT_NAME, workspace } from "./workspace";

export { ChatRoom } from "./chat-room";
export { PasswordHasher } from "./passwords";
export { Unfurler } from "./unfurl";
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

/** Signs in with an email address and password, or with just a name when the body gives one. */
async function signIn(request: Request, env: Env): Promise<Response> {
  // Any JSON value parses, null and numbers included, so don't assume an object.
  const body: unknown = await request.json().catch(() => null);
  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  return "name" in fields ? signInGuest(fields.name, request, env) : signInWithPassword(fields, request, env);
}

/**
 * ember-rust's sign-in (crates/ember/src/controllers/sessions.rs): every attempt counts against its IP
 * address's limit before anything is checked, and an unknown email address costs a password check
 * too, so the answer's timing doesn't say who has an account.
 */
async function signInWithPassword({ emailAddress, password }: Record<string, unknown>, request: Request, env: Env): Promise<Response> {
  // A blank password is refused before any lookup, as in ember-rust, and so is one longer than the
  // form sends, which nobody can have.
  const given = typeof emailAddress === "string" && typeof password === "string" && password !== "" && !isPasswordTooLong(password);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const found = await workspace(env).beginSignIn(ip, given ? emailAddress : null);
  if (found === "limited") return problem(429, SIGN_IN_REFUSED);
  if (!given) return problem(401, SIGN_IN_REFUSED);

  const matches = await passwordHasher(env).verify(password, found?.passwordDigest ?? DUMMY_DIGEST);
  const token = newSessionToken();
  const user = found && matches ? await workspace(env).startSession(found.userId, await tokenDigest(token, env.SESSION_SECRET), clientOf(request)) : null;
  if (!user) return problem(401, SIGN_IN_REFUSED);
  return json({ user }, { status: 201, headers: { "Set-Cookie": sessionCookie(request, token) } });
}

/** Signs someone in with just a name, as someone new every time, when EMBER_GUEST_SIGN_IN allows it. */
async function signInGuest(given: unknown, request: Request, env: Env): Promise<Response> {
  if (!guestSignIn(env)) return problem(403, "Signing in with just a name is turned off");
  const name = typeof given === "string" ? given.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) return problem(422, `Name must be 1 to ${MAX_NAME_LENGTH} characters`);

  const token = newSessionToken();
  const user = await workspace(env).signInGuest(name, await tokenDigest(token, env.SESSION_SECRET), clientOf(request));
  return json({ user }, { status: 201, headers: { "Set-Cookie": sessionCookie(request, token) } });
}

/** What the app asks first: whether Ember is set up yet, and who this browser is signed in as. */
async function bootstrap(request: Request, env: Env): Promise<Response> {
  const token = sessionToken(request);
  const { account, helpContact, user } = await workspace(env).bootstrap(token ? await credentialsFor(token, request, env) : null);
  const body: Bootstrap = {
    setup: account ? "complete" : "pending",
    setupProtected: isSetupProtected(env),
    guestSignIn: guestSignIn(env),
    account: account ?? { name: ACCOUNT_NAME },
    helpContact,
    version: versionOf(env),
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

/**
 * Signs this browser out, closing its session's sockets in every room its person is in, so its other
 * tabs go to sign in at once. ember-rust tells all the person's connections to reconnect instead,
 * which their other devices survive (concerns.rs). As there, a room that can't be reached doesn't
 * keep anyone signed in.
 */
async function endSession(request: Request, env: Env): Promise<Response> {
  const ended = await signOut(request, env);
  if (ended) {
    const closing = ended.rooms.map((roomId) => env.CHAT_ROOM.getByName(roomId).endSession(ended.sessionId));
    for (const result of await Promise.allSettled(closing)) {
      if (result.status === "rejected") console.error("Could not close a room's sockets on sign out", result.reason);
    }
  }
  return new Response(null, { status: 204, headers: { "Set-Cookie": expiredSessionCookie(request) } });
}

/** The rooms the signed-in person is in, and the welcome card's invitation if they're in its room. */
async function listRooms(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const list = credentials && (await workspace(env).rooms(credentials));
  // It can hold the join code, which no cache should keep.
  return list ? json(list satisfies RoomList, { headers: { "Cache-Control": "no-store" } }) : problem(401, "Not signed in");
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
  headers.set(SESSION_HEADER, access.sessionId);
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
    if (pathname === "/api/session" && request.method === "POST") return signIn(request, env);
    if (pathname === "/api/session" && request.method === "DELETE") return endSession(request, env);
    if (pathname === "/api/me") return me(request, env);
    if (pathname === "/api/rooms" && request.method === "GET") return listRooms(request, env);
    if (pathname === "/api/rooms" && request.method === "POST") return createRoom(request, env);
    const joining = pathname.match(/^\/api\/join\/([^/]+)$/);
    if (joining && request.method === "POST") return join(request, env, joining[1]!);
    if (pathname === "/api/unfurl" && request.method === "POST") return unfurlLink(request, env);

    const socket = pathname.match(/^\/api\/rooms\/([^/]+)\/socket$/);
    if (socket) {
      // Room ids never need percent-encoding, so an encoded segment can only be an unknown room.
      const roomId = socket[1]!;
      return isRoomId(roomId) ? connectToRoom(request, env, roomId) : problem(404, ROOM_NOT_FOUND);
    }

    if (pathname.startsWith("/api/")) return problem(404, "Not found");
    if (isSetupPath(pathname)) return setupPage(request, env);
    const joinCode = joinCodeOf(pathname);
    if (joinCode !== null) return joinPage(request, env, joinCode);
    const manifestFormat = manifestFormatOf(pathname);
    if (manifestFormat !== null && !write) return manifest(env, manifestFormat);
    if (pathname.startsWith("/qr_code/")) return showQrCode(request);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
