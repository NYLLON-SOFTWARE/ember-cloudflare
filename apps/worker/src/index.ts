import { isRoomSlug, type User } from "@ember/protocol";
import { ROOM_HEADER, USER_HEADER } from "./chat-room";
import type { Env } from "./env";
import { sortableId } from "./ids";
import { issueToken, verifyToken } from "./session";

export { ChatRoom } from "./chat-room";

const MAX_NAME_LENGTH = 48;

const json = (data: unknown, init?: ResponseInit) => Response.json(data, init);
const problem = (status: number, message: string) => json({ error: message }, { status });

async function currentUser(request: Request, env: Env): Promise<User | null> {
  const url = new URL(request.url);
  // Browsers can't set headers on a WebSocket handshake, so sockets pass the token as a query param.
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? url.searchParams.get("token");
  return token ? verifyToken(token, env.SESSION_SECRET) : null;
}

async function createSession(request: Request, env: Env): Promise<Response> {
  const { name } = (await request.json().catch(() => ({}))) as { name?: unknown };
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH) return problem(422, `Name must be 1 to ${MAX_NAME_LENGTH} characters`);

  const user: User = { id: sortableId(), name: trimmed };
  return json({ user, token: await issueToken(user, env.SESSION_SECRET) }, { status: 201 });
}

function listRooms(env: Env): Response {
  const rooms = env.DEFAULT_ROOMS.split(",")
    .map((slug) => slug.trim())
    .filter(isRoomSlug)
    .map((slug) => ({ id: slug, name: slug, kind: "open" as const }));
  return json({ rooms });
}

async function connectToRoom(request: Request, env: Env, slug: string): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") return problem(426, "Expected a WebSocket upgrade");
  const user = await currentUser(request, env);
  if (!user) return problem(401, "Sign in first");

  const headers = new Headers(request.headers);
  headers.set(USER_HEADER, JSON.stringify(user));
  headers.set(ROOM_HEADER, slug);
  return env.CHAT_ROOM.getByName(slug).fetch(new Request(request, { headers }));
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health") return json({ ok: true, storage: env.STORAGE_BACKEND });
    if (pathname === "/api/session" && request.method === "POST") return createSession(request, env);

    if (pathname === "/api/me") {
      const user = await currentUser(request, env);
      return user ? json({ user }) : problem(401, "Not signed in");
    }
    if (pathname === "/api/rooms" && request.method === "GET") {
      if (!(await currentUser(request, env))) return problem(401, "Not signed in");
      return listRooms(env);
    }

    const socket = pathname.match(/^\/api\/rooms\/([^/]+)\/socket$/);
    if (socket) {
      const slug = decodeURIComponent(socket[1]!);
      return isRoomSlug(slug) ? connectToRoom(request, env, slug) : problem(404, "No such room");
    }

    if (pathname.startsWith("/api/")) return problem(404, "Not found");
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
