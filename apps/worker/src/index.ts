import {
  CloseCode,
  isPasswordTooLong,
  isRoomId,
  parseAccountChanges,
  parseCustomStyles,
  parseNewRoom,
  parseRoleChange,
  parseRoomChanges,
  SIGN_IN_REFUSED,
  type Bootstrap,
  type ChangedPerson,
  type CustomStyles,
  type Directory,
  type Favorites,
  type NewJoinCode,
  type NewRoomForm,
  type RoomId,
  type RoomSettings,
  type Sidebar,
  type UserId,
  type WorkspaceSettings,
} from "@ember/protocol";
import {
  clientOf,
  credentialsFor,
  credentialsOf,
  expiredSessionCookie,
  guestSignIn,
  isCrossSite,
  isHttps,
  isSameOriginUpgrade,
  newSessionToken,
  sessionCookie,
  sessionToken,
  signOut,
  tokenDigest,
} from "./auth";
import { directoryOf } from "./avatar-tokens";
import { avatarTokenOf, showAvatar } from "./avatars";
import { AUTHORIZED_AT_HEADER, ROOM_HEADER, SESSION_HEADER, USER_HEADER } from "./chat-room";
import type { Env } from "./env";
import { failed } from "./error-pages";
import { jsonWithETag } from "./etag";
import { redirectToHttps, requiresHttps, withHeaders } from "./headers";
import { health, isUpPath, up } from "./health";
import { join, joinCodeOf, joinPage } from "./join";
import { manifest, manifestFormatOf } from "./manifest";
import { anyOtherPage } from "./pages";
import { DUMMY_DIGEST, passwordHasher } from "./passwords";
import { showQrCode } from "./qr-code";
import { RECOVERY_PATH, resetPassword } from "./recovery";
import { firstRun, isSetupPath, isSetupProtected, keepSetupPrivate, setupPage } from "./setup";
import { closedAtOnce } from "./sockets";
import { unfurlLink } from "./unfurl";
import { isFromUnsupportedBrowser, unsupportedBrowserPage } from "./unsupported-browser";
import { versionOf } from "./version";
import { ACCOUNT_BEFORE_SETUP, CREDENTIALS_HEADER, workspace } from "./workspace";

export { ChatRoom } from "./chat-room";
export { PasswordHasher } from "./passwords";
export { Unfurler } from "./unfurl";
export { Workspace } from "./workspace";

const MAX_NAME_LENGTH = 48;
/** ember-rust's alert for a room someone can't open, whether it's missing or they aren't in it. */
const ROOM_NOT_FOUND = "Room not found or inaccessible";

const json = (data: unknown, init?: ResponseInit) => Response.json(data, init);
const problem = (status: number, message: string) => json({ error: message }, { status });

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
  const user =
    found && matches ? await workspace(env).startSession(found.userId, found.passwordDigest, await tokenDigest(token, env.SESSION_SECRET), clientOf(request)) : null;
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
    account: account ?? ACCOUNT_BEFORE_SETUP,
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
  const token = sessionToken(request);
  const user = token ? await workspace(env).me(await credentialsFor(token, request, env)) : null;
  if (!token || !user) return problem(401, "Not signed in");
  // The app asks every time it loads, so sending the cookie again keeps it from expiring while it's in use.
  return json({ user }, { headers: { "Set-Cookie": sessionCookie(request, token) } });
}

/**
 * Workspace settings, which anyone signed in may see, read-only unless they're an administrator. They
 * hold the join code, which no cache should keep, as the sidebar's invitation does.
 */
async function workspaceSettings(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const settings = credentials && (await workspace(env).workspaceSettings(credentials));
  if (!settings) return problem(401, "Not signed in");
  if (settings === "not set up") return problem(404, "Ember isn't set up yet");
  return json(settings satisfies WorkspaceSettings, { headers: { "Cache-Control": "no-store" } });
}

/** Gives the join link a new code, as an administrator's Regenerate join link does, answering it. */
async function regenerateJoinCode(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const regenerated = credentials && (await workspace(env).regenerateJoinCode(credentials));
  if (!regenerated) return problem(401, "Not signed in");
  if (regenerated === "forbidden") return problem(403, "Only administrators can change the workspace");
  return json(regenerated satisfies NewJoinCode, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Changes the workspace, as its settings save it. As in ember-rust, someone who isn't an administrator
 * hears so before anything they sent is checked (accounts.rs).
 */
async function changeAccount(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "Not signed in");
  const changes = parseAccountChanges(await request.json().catch(() => null));
  // Changes that don't parse change nothing, but who's asking is still checked first.
  const account = await workspace(env).changeAccount(credentials, typeof changes === "string" ? {} : changes);
  if (!account) return problem(401, "Not signed in");
  if (account === "forbidden") return problem(403, "Only administrators can change the workspace");
  return typeof changes === "string" ? problem(422, changes) : json({ account });
}

/** The workspace's custom CSS, for the Custom CSS page, which only administrators can open (custom_styles.rs). */
async function customStyles(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const styles = credentials && (await workspace(env).customStyles(credentials));
  if (!styles) return problem(401, "Not signed in");
  if (styles === "forbidden") return problem(403, "Only administrators can change the workspace");
  return json(styles satisfies CustomStyles);
}

/**
 * Saves the workspace's custom CSS, as the Custom CSS page does, answering the workspace as it is then.
 * As in ember-rust, someone who isn't an administrator hears so before anything they sent is checked
 * (custom_styles.rs).
 */
async function changeCustomStyles(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "Not signed in");
  const change = parseCustomStyles(await request.json().catch(() => null));
  // A change that doesn't parse changes nothing, but who's asking is still checked first.
  const account = await workspace(env).changeCustomStyles(credentials, typeof change === "string" ? undefined : change.customStyles);
  if (!account) return problem(401, "Not signed in");
  if (account === "forbidden") return problem(403, "Only administrators can change the workspace");
  return typeof change === "string" ? problem(422, change) : json({ account });
}

/**
 * Makes someone an administrator or a member, as the crown on workspace settings does, answering them
 * as the people directory then lists them. As in ember-rust, someone who isn't an administrator hears
 * so first, then anyone who isn't active isn't found, before what was sent is checked
 * (accounts/users.rs). Unlike there, nobody can change their own role or a bot's.
 */
async function changeRole(request: Request, env: Env, userId: UserId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "Not signed in");
  const change = parseRoleChange(await request.json().catch(() => null));
  // A change that doesn't parse changes nothing, but who's asking and whom it's for are still checked first.
  const person = await workspace(env).changeRole(credentials, userId, change?.role ?? null);
  if (!person) return problem(401, "Not signed in");
  if (person === "forbidden") return problem(403, "Only administrators can change people's roles");
  if (person === "not found") return problem(404, "Not found");
  if (!change) return problem(400, "Expected a role");
  if (person === "own role") return problem(403, "Administrators can't change their own role");
  if (person === "bot") return problem(403, "Bots' roles can't be changed");
  return json({ user: person } satisfies ChangedPerson);
}

/**
 * Signs this browser out. Its session's sockets close in every room its person is in, so its other
 * tabs go to sign in at once; ember-rust tells all the person's connections to reconnect instead,
 * which their other devices survive (concerns.rs). The rooms close them once this has answered, so
 * as there, a room that can't be reached doesn't keep anyone signed in.
 */
async function endSession(request: Request, env: Env): Promise<Response> {
  await signOut(request, env);
  return new Response(null, { status: 204, headers: { "Set-Cookie": expiredSessionCookie(request) } });
}

/**
 * The signed-in person's sidebar: the rooms they're in, and the welcome card's invitation if they're in
 * its room. It can hold the join code, which no cache should keep, not even the browser's, where it
 * would outlast signing out. So the app keeps its own copy, and sends its ETag to ask whether it's current.
 */
async function sidebar(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const sidebar = credentials && (await workspace(env).sidebar(credentials));
  return sidebar ? jsonWithETag(request, sidebar satisfies Sidebar, { "Cache-Control": "no-store" }) : problem(401, "Not signed in");
}

/**
 * Everyone in the workspace, deactivated and banned people too, with their avatars' addresses, for
 * the app to show people by. No cache keeps it, as none keeps the sidebar, so the app keeps its own copy.
 */
async function directory(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const entries = credentials && (await workspace(env).directory(credentials));
  if (!entries) return problem(401, "Not signed in");
  return jsonWithETag(request, { users: await directoryOf(entries, env.SESSION_SECRET) } satisfies Directory, { "Cache-Control": "no-store" });
}

/** Creates an open room, or a closed one for the people it names, as New room's forms do. */
async function createRoom(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "Not signed in");
  const room = parseNewRoom(await request.json().catch(() => null));
  if (typeof room === "string") return problem(422, room);
  const created = await workspace(env).createRoom(credentials, room);
  return created ? json({ room: created }, { status: 201 }) : problem(401, "Not signed in");
}

/** Who New room's forms list: everyone active, by name. */
async function newRoomForm(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const form = credentials && (await workspace(env).newRoomForm(credentials));
  return form ? json(form satisfies NewRoomForm) : problem(401, "Not signed in");
}

/** A room's settings page, for its members, read-only for those who can't change it. */
async function roomSettings(request: Request, env: Env, roomId: RoomId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const settings = credentials && (await workspace(env).roomSettings(credentials, roomId));
  if (!settings) return problem(401, "Not signed in");
  return settings === "not found" ? problem(404, ROOM_NOT_FOUND) : json(settings satisfies RoomSettings);
}

/**
 * Changes a room, as its settings page saves it. As in ember-rust, someone who can't change it hears
 * so before anything they sent is checked (rooms/opens.rs).
 */
async function changeRoom(request: Request, env: Env, roomId: RoomId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "Not signed in");
  const changes = parseRoomChanges(await request.json().catch(() => null));
  // Changes that don't parse change nothing, but the room is still checked first.
  const room = await workspace(env).changeRoom(credentials, roomId, typeof changes === "string" ? {} : changes);
  if (!room) return problem(401, "Not signed in");
  if (room === "not found") return problem(404, ROOM_NOT_FOUND);
  if (room === "forbidden") return problem(403, "Only administrators and the room's creator can change it");
  return typeof changes === "string" ? problem(422, changes) : json({ room });
}

/**
 * Deletes a room, as Delete on its settings page does, answering 204 where ember-rust redirects home
 * (rooms.rs). As with changing a room, someone who can't change it hears so.
 */
async function deleteRoom(request: Request, env: Env, roomId: RoomId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const deleted = credentials && (await workspace(env).deleteRoom(credentials, roomId));
  if (!deleted) return problem(401, "Not signed in");
  if (deleted === "not found") return problem(404, ROOM_NOT_FOUND);
  if (deleted === "forbidden") return problem(403, "Only administrators and the room's creator can delete it");
  return new Response(null, { status: 204 });
}

/**
 * Stars a room for the signed-in person, or unstars it, as its header's star does, answering their
 * stars, as ember-rust's `favorites#update` does for JSON (rooms/favorites.rs): 400 for a room id or a
 * `favorite` it can't read, and 403 for a room they can't star.
 */
async function setFavorite(request: Request, env: Env, roomId: string): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "Not signed in");
  if (!isRoomId(roomId)) return problem(400, "invalid room ID");
  // Any JSON value parses, null and numbers included, so don't assume an object.
  const body: unknown = await request.json().catch(() => null);
  const favorite = typeof body === "object" && body !== null ? (body as Record<string, unknown>).favorite : undefined;
  if (typeof favorite !== "boolean") return problem(400, "favorite must be true or false");
  const favorites = await workspace(env).setFavorite(credentials, roomId, favorite);
  if (!favorites) return problem(401, "Not signed in");
  if (favorites === "forbidden") return problem(403, "You can't star that room");
  return json({ favorites } satisfies { favorites: Favorites });
}

/** A tab's workspace socket, which the Workspace lets in itself, as the session the request's cookie names. */
async function connectToWorkspace(request: Request, env: Env): Promise<Response> {
  // As with a room's, the address is only there for upgrades from the app's own pages.
  if (request.headers.get("Upgrade") !== "websocket" || !isSameOriginUpgrade(request)) return problem(404, "Not found");
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "Sign in first");
  const headers = new Headers(request.headers);
  headers.set(CREDENTIALS_HEADER, JSON.stringify(credentials));
  return workspace(env).fetch(new Request(request, { headers }));
}

async function connectToRoom(request: Request, env: Env, roomId: RoomId): Promise<Response> {
  // As with Action Cable, the address is only there for upgrades from the app's own pages.
  if (request.headers.get("Upgrade") !== "websocket" || !isSameOriginUpgrade(request)) return problem(404, "Not found");
  const credentials = await credentialsOf(request, env);
  const access = credentials && (await workspace(env).roomAccess(credentials, roomId));
  if (!access) return problem(401, "Sign in first");
  // Without waking the room's object, so a room nobody may open is never created. The app hears
  // that the room is gone for this person, deleted or theirs no longer, and stops connecting.
  if (!access.member) return closedAtOnce(CloseCode.NotFound);

  const headers = new Headers(request.headers);
  headers.set(USER_HEADER, JSON.stringify(access.user));
  headers.set(ROOM_HEADER, roomId);
  headers.set(SESSION_HEADER, access.sessionId);
  headers.set(AUTHORIZED_AT_HEADER, String(access.authorizedAt));
  return env.CHAT_ROOM.getByName(roomId).fetch(new Request(request, { headers }));
}

/** What the app's routes answer, before the headers every answer gets. */
async function route(request: Request, env: Env, pathname: string): Promise<Response> {
  // The deploy check isn't a browser's, any more than /up is.
  if (pathname === "/api/health") return health(env);
  // Nor is password recovery's script, whose token another site's page can't send, since its header
  // takes a preflight nothing here answers.
  if (pathname === RECOVERY_PATH) return resetPassword(request, env);
  // First, where ember-rust checks after sign-in and the forgery check: a browser too old for the
  // app has nothing to sign in to. In setup's place, the page is kept as private as setup's own.
  if (isFromUnsupportedBrowser(request)) return keepSetupPrivate(unsupportedBrowserPage(request), env, pathname);
  const write = request.method !== "GET" && request.method !== "HEAD";
  if (write && pathname.startsWith("/api/") && isCrossSite(request)) return problem(422, "Requests from other sites are refused");

  if (pathname === "/api/bootstrap" && request.method === "GET") return bootstrap(request, env);
  if (pathname === "/api/first_run" && request.method === "POST") return firstRun(request, env);
  if (pathname === "/api/session" && request.method === "POST") return signIn(request, env);
  if (pathname === "/api/session" && request.method === "DELETE") return endSession(request, env);
  if (pathname === "/api/me") return me(request, env);
  if (pathname === "/api/account" && request.method === "GET") return workspaceSettings(request, env);
  if (pathname === "/api/account" && request.method === "PATCH") return changeAccount(request, env);
  if (pathname === "/api/account/join_code" && request.method === "POST") return regenerateJoinCode(request, env);
  if (pathname === "/api/account/custom_styles" && request.method === "GET") return customStyles(request, env);
  if (pathname === "/api/account/custom_styles" && request.method === "PATCH") return changeCustomStyles(request, env);
  // The ids of people who can be active never need percent-encoding, so an encoded segment can't name one.
  const person = pathname.match(/^\/api\/account\/users\/([^/]+)$/);
  if (person && request.method === "PATCH") return changeRole(request, env, person[1]!);
  if (pathname === "/api/sidebar" && request.method === "GET") return sidebar(request, env);
  if (pathname === "/api/users" && request.method === "GET") return directory(request, env);
  if (pathname === "/api/socket") return connectToWorkspace(request, env);
  if (pathname === "/api/rooms" && request.method === "POST") return createRoom(request, env);
  if (pathname === "/api/rooms/new" && request.method === "GET") return newRoomForm(request, env);
  const joining = pathname.match(/^\/api\/join\/([^/]+)$/);
  if (joining && request.method === "POST") return join(request, env, joining[1]!);
  if (pathname === "/api/unfurl" && request.method === "POST") return unfurlLink(request, env);

  const socket = pathname.match(/^\/api\/rooms\/([^/]+)\/socket$/);
  if (socket) {
    // Room ids never need percent-encoding, so an encoded segment can only be an unknown room.
    const roomId = socket[1]!;
    return isRoomId(roomId) ? connectToRoom(request, env, roomId) : problem(404, ROOM_NOT_FOUND);
  }
  const settings = pathname.match(/^\/api\/rooms\/([^/]+)\/settings$/);
  if (settings && request.method === "GET") return isRoomId(settings[1]!) ? roomSettings(request, env, settings[1]!) : problem(404, ROOM_NOT_FOUND);
  const favorite = pathname.match(/^\/api\/rooms\/([^/]+)\/favorite$/);
  if (favorite && request.method === "PUT") return setFavorite(request, env, favorite[1]!);
  const room = pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (room && request.method === "PATCH") return isRoomId(room[1]!) ? changeRoom(request, env, room[1]!) : problem(404, ROOM_NOT_FOUND);
  if (room && request.method === "DELETE") return isRoomId(room[1]!) ? deleteRoom(request, env, room[1]!) : problem(404, ROOM_NOT_FOUND);

  if (pathname.startsWith("/api/")) return problem(404, "Not found");
  if (isSetupPath(pathname)) return setupPage(request, env);
  const joinCode = joinCodeOf(pathname);
  if (joinCode !== null) return joinPage(request, env, joinCode);
  const manifestFormat = manifestFormatOf(pathname);
  if (manifestFormat !== null && !write) return manifest(env, manifestFormat);
  if (pathname.startsWith("/qr_code/")) return showQrCode(request);
  const avatarToken = avatarTokenOf(pathname);
  if (avatarToken !== null) return showAvatar(request, env, avatarToken);
  return anyOtherPage(request, env, pathname);
}

/**
 * What an exception answers, as ember-rust's does (crates/kit/src/ctx.rs): JSON from the API, and
 * Campfire's 500 page otherwise. Setup's pages and form can hold the setup token or the first
 * administrator's password, and recovery its token and a new password, so there the log says only
 * that the request failed.
 */
function failure(request: Request, env: Env, pathname: string, error: unknown): Response {
  const holdsSecrets = isSetupPath(pathname) || pathname === "/api/first_run" || pathname === RECOVERY_PATH;
  console.error(`${request.method} ${pathname} failed:`, holdsSecrets ? "500 Internal Server Error" : error);
  if (pathname.startsWith("/api/")) return problem(500, "Something went wrong");
  return keepSetupPrivate(failed(request), env, pathname);
}

export default {
  // Everything but the built app's static files comes here first (`run_worker_first`), page loads
  // included, so each answer gets ember-rust's headers.
  async fetch(request, env): Promise<Response> {
    if (!isHttps(request) && requiresHttps(request, env)) return redirectToHttps(request);
    const { pathname } = new URL(request.url);
    // /up skips ember-rust's before-actions, so it's never checked and carries no version.
    const isUp = isUpPath(pathname) && (request.method === "GET" || request.method === "HEAD");
    const response = isUp ? up(request) : await route(request, env, pathname).catch((error: unknown) => failure(request, env, pathname, error));
    return withHeaders(response, request, env, { version: !isUp });
  },
} satisfies ExportedHandler<Env>;
