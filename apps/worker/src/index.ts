import { isRoomSlug } from "@ember/protocol";
import { authenticate, clientOf, expiredSessionCookie, isCrossSite, isSameOriginUpgrade, newSessionToken, sessionCookie, signOut, tokenDigest } from "./auth";
import { ROOM_HEADER, USER_HEADER } from "./chat-room";
import type { Env } from "./env";
import { workspace } from "./workspace";

export { ChatRoom } from "./chat-room";
export { Workspace } from "./workspace";

const MAX_NAME_LENGTH = 48;
/** The room object /api/health reads from. No room can have this name, since slugs can't hold "_". */
const HEALTH_ROOM = "_health";

const json = (data: unknown, init?: ResponseInit) => Response.json(data, init);
const problem = (status: number, message: string) => json({ error: message }, { status });

/**
 * Answers 200 once the Worker can sign people in and the Workspace and a room's object both read
 * their storage, so a deploy can be checked without signing in.
 */
async function health(env: Env): Promise<Response> {
  const storage = env.STORAGE_BACKEND;
  if (!env.SESSION_SECRET) return json({ ok: false, storage, error: "SESSION_SECRET isn't set" }, { status: 503 });
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
  if (env.EMBER_GUEST_SIGN_IN !== "true") return problem(403, "Signing in with just a name is turned off");
  // Any JSON value parses, null included, so don't assume an object.
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) return problem(422, `Name must be 1 to ${MAX_NAME_LENGTH} characters`);

  const token = newSessionToken();
  const user = await workspace(env).signInGuest(name, await tokenDigest(token, env.SESSION_SECRET), clientOf(request));
  return json({ user }, { status: 201, headers: { "Set-Cookie": sessionCookie(request, token) } });
}

async function me(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return problem(401, "Not signed in");
  // Sending the cookie again whenever the session refreshes keeps it from expiring while it's in use.
  const headers: HeadersInit = session.refreshed ? { "Set-Cookie": sessionCookie(request, session.token) } : {};
  return json({ user: session.user }, { headers });
}

async function endSession(request: Request, env: Env): Promise<Response> {
  await signOut(request, env);
  return new Response(null, { status: 204, headers: { "Set-Cookie": expiredSessionCookie(request) } });
}

function listRooms(env: Env): Response {
  const rooms = env.DEFAULT_ROOMS.split(",")
    .map((slug) => slug.trim())
    .filter(isRoomSlug)
    .map((slug) => ({ id: slug, name: slug, kind: "open" as const }));
  return json({ rooms });
}

async function connectToRoom(request: Request, env: Env, slug: string): Promise<Response> {
  // As with Action Cable, the address is only there for upgrades from the app's own pages.
  if (request.headers.get("Upgrade") !== "websocket" || !isSameOriginUpgrade(request)) return problem(404, "Not found");
  const session = await authenticate(request, env);
  if (!session) return problem(401, "Sign in first");

  const headers = new Headers(request.headers);
  headers.set(USER_HEADER, JSON.stringify(session.user));
  headers.set(ROOM_HEADER, slug);
  return env.CHAT_ROOM.getByName(slug).fetch(new Request(request, { headers }));
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health") return health(env);
    const write = request.method !== "GET" && request.method !== "HEAD";
    if (write && pathname.startsWith("/api/") && isCrossSite(request)) return problem(422, "Requests from other sites are refused");

    if (pathname === "/api/session" && request.method === "POST") return signInGuest(request, env);
    if (pathname === "/api/session" && request.method === "DELETE") return endSession(request, env);
    if (pathname === "/api/me") return me(request, env);
    if (pathname === "/api/rooms" && request.method === "GET") {
      if (!(await authenticate(request, env))) return problem(401, "Not signed in");
      return listRooms(env);
    }

    const socket = pathname.match(/^\/api\/rooms\/([^/]+)\/socket$/);
    if (socket) {
      // Slugs never need percent-encoding, so an encoded segment can only be an unknown room.
      const slug = socket[1]!;
      return isRoomSlug(slug) ? connectToRoom(request, env, slug) : problem(404, "No such room");
    }

    if (pathname.startsWith("/api/")) return problem(404, "Not found");
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
