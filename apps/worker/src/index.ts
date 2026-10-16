import {
  CloseCode,
  isPasswordTooLong,
  isRoomId,
  parseAccountChanges,
  parseCustomStyles,
  parseFavoriteOrder,
  parseSharedOrder,
  parseNewDirect,
  parseNewRoom,
  parseProfileChanges,
  parseRoleChange,
  parseRoomChanges,
  SIGN_IN_REFUSED,
  transferIdFromPath,
  workspacePageOf,
  type Bootstrap,
  type ChangedPerson,
  type CustomStyles,
  type Directory,
  type Favorites,
  type NewJoinCode,
  type NewRoomForm,
  type PersonAnswer,
  type ProfileAnswer,
  type RoomId,
  type RoomSettings,
  type Sidebar,
  type StartedDirect,
  type UserId,
  type WorkspaceSettings,
} from "@ember/protocol";
import { mentionPromptItem } from "@ember/richtext";
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
import type { BanProblem } from "./bans";
import { ADDRESS_HEADER, AUTHORIZED_AT_HEADER, BANNED_HEADER, ROOM_HEADER, SESSION_HEADER, USER_HEADER } from "./chat-room";
import type { Env } from "./env";
import { failed, notFound } from "./error-pages";
import { jsonWithETag } from "./etag";
import { redirectToHttps, requiresHttps, withHeaders } from "./headers";
import { health, isUpPath, up } from "./health";
import { join, joinCodeOf, joinPage } from "./join";
import { manifest, manifestFormatOf } from "./manifest";
import { anyOtherPage } from "./pages";
import { DUMMY_DIGEST, passwordHasher } from "./passwords";
import { showQrCode } from "./qr-code";
import { RECOVERY_PATH, resetPassword } from "./recovery";
import { MAX_ADDRESS_LENGTH } from "./revocations";
import { searchMessages } from "./searches";
import { firstRun, isSetupPath, isSetupProtected, keepSetupPrivate, setupPage } from "./setup";
import { closedAtOnce } from "./sockets";
import { newTransferId, transferPage, transferSession } from "./transfers";
import { unfurlLink } from "./unfurl";
import { isFromUnsupportedBrowser, unsupportedBrowserPage } from "./unsupported-browser";
import { versionOf } from "./version";
import { ACCOUNT_BEFORE_SETUP, CREDENTIALS_HEADER, workspace, type YourProfile } from "./workspace";

export { ChatRoom } from "./chat-room";
export { PasswordHasher } from "./passwords";
export { SearchIndex } from "./search-index";
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
 * Removes someone from the workspace, as Delete on workspace settings does, answering them as the
 * people directory then lists them. As in ember-rust, someone who isn't an administrator hears so
 * first, then anyone who isn't active isn't found (accounts/users.rs). Unlike there, nobody can remove
 * themselves.
 */
async function removePerson(request: Request, env: Env, userId: UserId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const person = credentials && (await workspace(env).removePerson(credentials, userId));
  if (!person) return problem(401, "Not signed in");
  if (person === "forbidden") return problem(403, "Only administrators can remove people");
  if (person === "not found") return problem(404, "Not found");
  if (person === "yourself") return problem(403, "Administrators can't remove themselves");
  return json({ user: person } satisfies ChangedPerson);
}

/**
 * What a ban that can't block an IP address someone signed in from answers, which ember-rust's 422 page
 * leaves unsaid, or one that would block the administrator's own, which ember-rust allows.
 */
const BAN_PROBLEMS: Record<BanProblem | "your address", string> = {
  invalid: "They signed in from an IP address that isn't valid, which a ban can't block",
  internal: "They signed in from a private or internal IP address, which a ban can't block",
  "your address": "They signed in from your IP address, which a ban would block for you too",
};

/**
 * Bans someone, as Ban on their page does, answering them as the people directory then lists them. As
 * in ember-rust, someone who isn't an administrator hears so first, then an id nobody has isn't found,
 * whatever their status (users/bans.rs). Unlike there, nobody can ban themselves, or the address
 * they're using.
 */
async function banPerson(request: Request, env: Env, userId: UserId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const person = credentials && (await workspace(env).banPerson(credentials, userId));
  if (!person) return problem(401, "Not signed in");
  if (person === "forbidden") return problem(403, "Only administrators can ban people");
  if (person === "not found") return problem(404, "Not found");
  if (person === "yourself") return problem(403, "Administrators can't ban themselves");
  if (typeof person === "string") return problem(422, BAN_PROBLEMS[person]);
  return json({ user: person } satisfies ChangedPerson);
}

/** Lifts someone's ban, as Remove ban on their page does, answering them as `banPerson` does. */
async function unbanPerson(request: Request, env: Env, userId: UserId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const person = credentials && (await workspace(env).unbanPerson(credentials, userId));
  if (!person) return problem(401, "Not signed in");
  if (person === "forbidden") return problem(403, "Only administrators can lift bans");
  if (person === "not found") return problem(404, "Not found");
  return json({ user: person } satisfies ChangedPerson);
}

/**
 * Your profile as its page shows it, with a new sign-in link for you, as each of ember-rust's profile
 * pages has (users/profiles/_transfer.html). No cache should keep it, since it holds your email address
 * and the link.
 */
async function profileAnswer({ userId, profile }: YourProfile, env: Env): Promise<Response> {
  const transferId = await newTransferId(userId, env.SESSION_SECRET, Date.now());
  return json({ profile, transferId } satisfies ProfileAnswer, { headers: { "Cache-Control": "no-store" } });
}

/** Your profile, for its page (profiles.rs, `show`). */
async function profile(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const yours = credentials && (await workspace(env).profile(credentials));
  return yours ? profileAnswer(yours, env) : problem(401, "Not signed in");
}

/**
 * Saves your profile, as its form does (profiles.rs, `update`), answering it as it is then. Who's
 * asking is checked before a new password is hashed, and a blank one keeps the password they have, as
 * ember-rust's `password=` ignores it. An email address someone else has is refused, where ember-rust
 * fails with 500.
 */
async function changeProfile(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials || !(await workspace(env).authenticate(credentials))) return problem(401, "Not signed in");
  const changes = parseProfileChanges(await request.json().catch(() => null));
  if (typeof changes === "string") return problem(422, changes);
  const { password, ...rest } = changes;
  const passwordDigest = password ? await passwordHasher(env).hash(password) : null;
  const yours = await workspace(env).changeProfile(credentials, rest, passwordDigest);
  if (!yours) return problem(401, "Not signed in");
  if (yours === "email address taken") return problem(422, "That email address has an account already");
  return profileAnswer(yours, env);
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

/** A path segment as text, or "" for malformed percent-encoding, which names nobody. */
function segmentText(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

/**
 * Someone's page, as ember-rust's `users#show` finds them (users.rs): anyone, whatever their status,
 * with their email address and a new sign-in link for administrators. An id nobody has is 404.
 */
async function showPerson(request: Request, env: Env, userId: UserId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const found = credentials && (await workspace(env).person(credentials, userId));
  if (!found) return problem(401, "Not signed in");
  if (found === "not found") return problem(404, "Not found");
  const [shown] = await directoryOf([found.person], env.SESSION_SECRET);
  const transferId = found.transferable ? await newTransferId(found.person.id, env.SESSION_SECRET, Date.now()) : undefined;
  return json({ person: shown!, transferId } satisfies PersonAnswer, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Someone's page, `/users/<id>`, as ember-rust answers it: Campfire's 404 page once signed in, for an
 * id nobody has, and otherwise the app's page, which sends anyone signed out to sign in first.
 */
async function personPage(request: Request, env: Env, pathname: string, userId: UserId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const found = credentials && (await workspace(env).person(credentials, userId));
  return found === "not found" ? notFound(request) : anyOtherPage(request, env, pathname);
}

/**
 * Whom the mentions prompt offers, as ember-rust's `Autocompletable::UsersController` answers Lexxy: the
 * first 20 by name of the active people in `room_id`, or anywhere without one, whose names contain
 * `filter` (or `query`), as `<lexxy-prompt-item>`s. A room someone isn't in is 404.
 */
async function mentionable(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "Not signed in");
  const params = new URL(request.url).searchParams;
  const roomId = present(params.get("room_id"));
  if (roomId !== undefined && !isRoomId(roomId)) return problem(404, ROOM_NOT_FOUND);
  const query = present(params.get("filter")) ?? present(params.get("query")) ?? "";
  const people = await workspace(env).mentionable(credentials, roomId ?? null, query);
  if (!people) return problem(401, "Not signed in");
  if (people === "not found") return problem(404, ROOM_NOT_FOUND);
  const items = (await directoryOf(people, env.SESSION_SECRET)).map(mentionPromptItem);
  return new Response(items.join(""), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** A parameter's value unless it's blank, as Rails' `presence` reads it. */
const present = (value: string | null) => (value === null || value.trim() === "" ? undefined : value);

/** What someone hears when "Must be admin to create new rooms" is on and they aren't one. */
const ROOM_CREATION_FORBIDDEN = "Only administrators can create rooms";

/**
 * Creates an open room, or a closed one for the people it names, as New room's forms do. As in
 * ember-rust, someone who may not create rooms hears so before anything they sent is checked
 * (rooms/opens.rs).
 */
async function createRoom(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "Not signed in");
  const room = parseNewRoom(await request.json().catch(() => null));
  if (typeof room === "string") {
    const may = await workspace(env).mayCreateRooms(credentials);
    if (may === null) return problem(401, "Not signed in");
    return may ? problem(422, room) : problem(403, ROOM_CREATION_FORBIDDEN);
  }
  const created = await workspace(env).createRoom(credentials, room);
  if (!created) return problem(401, "Not signed in");
  return created === "forbidden" ? problem(403, ROOM_CREATION_FORBIDDEN) : json({ room: created }, { status: 201 });
}

/**
 * Starts a DM with the people it names, or opens the one they have, as New direct message does:
 * 201 for a new DM and 200 for one they had, where ember-rust redirects to it (rooms/directs.rs).
 */
async function startDirect(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "Not signed in");
  const direct = parseNewDirect(await request.json().catch(() => null));
  if (typeof direct === "string") return problem(422, direct);
  const started = await workspace(env).startDirect(credentials, direct.userIds);
  return started ? json({ room: started.room } satisfies StartedDirect, { status: started.started ? 201 : 200 }) : problem(401, "Not signed in");
}

/** Who New room's forms list: everyone active, by name, for anyone who may create rooms. */
async function newRoomForm(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const form = credentials && (await workspace(env).newRoomForm(credentials));
  if (!form) return problem(401, "Not signed in");
  return form === "forbidden" ? problem(403, ROOM_CREATION_FORBIDDEN) : json(form satisfies NewRoomForm);
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
 * Deletes a room or DM, as Delete on its settings page does, answering 204 where ember-rust redirects
 * home (rooms.rs). As with changing a room, someone who can't change it hears so, and anyone in a DM
 * can delete it.
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

/**
 * Puts the signed-in person's starred rooms in the order listed, as dragging one in their sidebar does,
 * answering their stars, where ember-rust's `sidebars#update_order` answers 204 (users/sidebars.rs): 400
 * for a list it can't read, and 403 for one that isn't exactly the rooms they've starred.
 */
async function setFavoriteOrder(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "Not signed in");
  const roomIds = parseFavoriteOrder(await request.json().catch(() => null));
  if (typeof roomIds === "string") return problem(400, roomIds);
  const favorites = await workspace(env).setFavoriteOrder(credentials, roomIds);
  if (!favorites) return problem(401, "Not signed in");
  if (favorites === "forbidden") return problem(403, "Those aren't the rooms you've starred");
  return json({ favorites } satisfies { favorites: Favorites });
}

/** What someone hears when they can't put rooms in the shared order. */
const SHARED_ORDER_FORBIDDEN = "Only administrators can put rooms in order for everyone, and only the rooms in their sidebar";

/**
 * Puts the rooms in the signed-in administrator's sidebar in the shared order, as saving it on
 * workspace settings does, answering the rooms they're in that it ranks, where ember-rust's
 * `sidebars#update_default_order` answers 204 (users/sidebars.rs): 400 for a list it can't read, and
 * 403 for anyone but an administrator, or a list naming a room outside their sidebar. An empty list
 * clears the order.
 */
async function setSharedOrder(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, "Not signed in");
  const roomIds = parseSharedOrder(await request.json().catch(() => null));
  // As in ember-rust, someone who isn't an administrator hears so before the list is checked.
  if (typeof roomIds === "string") {
    const administrator = await workspace(env).canAdminister(credentials);
    if (administrator === null) return problem(401, "Not signed in");
    return administrator ? problem(400, roomIds) : problem(403, SHARED_ORDER_FORBIDDEN);
  }
  const sharedOrder = await workspace(env).setSharedOrder(credentials, roomIds);
  if (!sharedOrder) return problem(401, "Not signed in");
  return sharedOrder === "forbidden" ? problem(403, SHARED_ORDER_FORBIDDEN) : json({ sharedOrder } satisfies { sharedOrder: RoomId[] });
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
  headers.set(BANNED_HEADER, String(access.banned));
  // An address longer than any IP address isn't one a ban can hold, and would make too long a tag.
  const { ip } = clientOf(request);
  if (ip !== null && ip.length <= MAX_ADDRESS_LENGTH) headers.set(ADDRESS_HEADER, ip);
  else headers.delete(ADDRESS_HEADER);
  return env.CHAT_ROOM.getByName(roomId).fetch(new Request(request, { headers }));
}

/** What answers an API request, if one of the API's routes takes it. */
function apiAction(request: Request, env: Env, pathname: string): (() => Response | Promise<Response>) | null {
  if (pathname === "/api/bootstrap" && request.method === "GET") return () => bootstrap(request, env);
  if (pathname === "/api/first_run" && request.method === "POST") return () => firstRun(request, env);
  if (pathname === "/api/session" && request.method === "POST") return () => signIn(request, env);
  if (pathname === "/api/session" && request.method === "DELETE") return () => endSession(request, env);
  const transfer = pathname.match(/^\/api\/session\/transfers\/([^/]+)$/);
  if (transfer && request.method === "PUT") return () => transferSession(request, env, segmentText(transfer[1]!));
  if (pathname === "/api/me") return () => me(request, env);
  if (pathname === "/api/account" && request.method === "GET") return () => workspaceSettings(request, env);
  if (pathname === "/api/account" && request.method === "PATCH") return () => changeAccount(request, env);
  if (pathname === "/api/account/join_code" && request.method === "POST") return () => regenerateJoinCode(request, env);
  if (pathname === "/api/account/custom_styles" && request.method === "GET") return () => customStyles(request, env);
  if (pathname === "/api/account/custom_styles" && request.method === "PATCH") return () => changeCustomStyles(request, env);
  if (pathname === "/api/account/room_order" && request.method === "PUT") return () => setSharedOrder(request, env);
  // The ids of people who can be active never need percent-encoding, so an encoded segment can't name one.
  const person = pathname.match(/^\/api\/account\/users\/([^/]+)$/);
  if (person && request.method === "PATCH") return () => changeRole(request, env, person[1]!);
  if (person && request.method === "DELETE") return () => removePerson(request, env, person[1]!);
  if (pathname === "/api/sidebar" && request.method === "GET") return () => sidebar(request, env);
  if (pathname === "/api/users" && request.method === "GET") return () => directory(request, env);
  if (pathname === "/api/autocompletable/users" && request.method === "GET") return () => mentionable(request, env);
  if (pathname === "/api/sidebar/order" && request.method === "PUT") return () => setFavoriteOrder(request, env);
  if (pathname === "/api/users/me/profile" && request.method === "GET") return () => profile(request, env);
  if (pathname === "/api/users/me/profile" && request.method === "PATCH") return () => changeProfile(request, env);
  const someone = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (someone && request.method === "GET") return () => showPerson(request, env, segmentText(someone[1]!));
  const ban = pathname.match(/^\/api\/users\/([^/]+)\/ban$/);
  if (ban && request.method === "POST") return () => banPerson(request, env, segmentText(ban[1]!));
  if (ban && request.method === "DELETE") return () => unbanPerson(request, env, segmentText(ban[1]!));
  if (pathname === "/api/socket") return () => connectToWorkspace(request, env);
  if (pathname === "/api/rooms" && request.method === "POST") return () => createRoom(request, env);
  if (pathname === "/api/rooms/new" && request.method === "GET") return () => newRoomForm(request, env);
  if (pathname === "/api/directs" && request.method === "POST") return () => startDirect(request, env);
  const joining = pathname.match(/^\/api\/join\/([^/]+)$/);
  if (joining && request.method === "POST") return () => join(request, env, joining[1]!);
  if (pathname === "/api/unfurl" && request.method === "POST") return () => unfurlLink(request, env);
  if (pathname === "/api/searches" && request.method === "GET") return () => searchMessages(request, env);

  const socket = pathname.match(/^\/api\/rooms\/([^/]+)\/socket$/);
  if (socket) {
    // Room ids never need percent-encoding, so an encoded segment can only be an unknown room.
    const roomId = socket[1]!;
    return () => (isRoomId(roomId) ? connectToRoom(request, env, roomId) : problem(404, ROOM_NOT_FOUND));
  }
  const settings = pathname.match(/^\/api\/rooms\/([^/]+)\/settings$/);
  if (settings && request.method === "GET") return () => (isRoomId(settings[1]!) ? roomSettings(request, env, settings[1]!) : problem(404, ROOM_NOT_FOUND));
  const favorite = pathname.match(/^\/api\/rooms\/([^/]+)\/favorite$/);
  if (favorite && request.method === "PUT") return () => setFavorite(request, env, favorite[1]!);
  const room = pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (room && request.method === "PATCH") return () => (isRoomId(room[1]!) ? changeRoom(request, env, room[1]!) : problem(404, ROOM_NOT_FOUND));
  if (room && request.method === "DELETE") return () => (isRoomId(room[1]!) ? deleteRoom(request, env, room[1]!) : problem(404, ROOM_NOT_FOUND));
  return null;
}

/** Whether the request comes from an IP address a ban blocks. */
async function isFromBannedAddress(request: Request, env: Env): Promise<boolean> {
  const { ip } = clientOf(request);
  return ip !== null && (await workspace(env).isBanned(ip));
}

/** What a banned IP address's requests to change something answer, as ember-rust's `head(TOO_MANY_REQUESTS)` does. */
const tooManyRequests = () => new Response(null, { status: 429, headers: { "Content-Type": "text/html" } });

/** What the app's routes answer, before the headers every answer gets. */
async function route(request: Request, env: Env, pathname: string): Promise<Response> {
  // The deploy check isn't a browser's, any more than /up is.
  if (pathname === "/api/health") return health(env);
  // Nor is password recovery's script, whose token another site's page can't send, since its header
  // takes a preflight nothing here answers.
  if (pathname === RECOVERY_PATH) return resetPassword(request, env);
  const write = request.method !== "GET" && request.method !== "HEAD";
  const action = apiAction(request, env, pathname);
  // First, as ember-rust's `reject_banned_ip` (concerns.rs): once a route is found, so an unknown
  // address still answers 404, a banned IP address can't change anything, sign in or join.
  if (write && action && (await isFromBannedAddress(request, env))) return tooManyRequests();
  // Then, where ember-rust checks after sign-in and the forgery check: a browser too old for the app
  // has nothing to sign in to. In setup's place, the page is kept as private as setup's own.
  if (isFromUnsupportedBrowser(request)) return keepSetupPrivate(unsupportedBrowserPage(request), env, pathname);
  if (write && pathname.startsWith("/api/") && isCrossSite(request)) return problem(422, "Requests from other sites are refused");
  if (action) return action();
  if (pathname.startsWith("/api/")) return problem(404, "Not found");
  if (isSetupPath(pathname)) return setupPage(request, env);
  const joinCode = joinCodeOf(pathname);
  if (joinCode !== null) return joinPage(request, env, joinCode);
  if (transferIdFromPath(pathname) !== null) return transferPage(request, env);
  const manifestFormat = manifestFormatOf(pathname);
  if (manifestFormat !== null && !write) return manifest(env, manifestFormat);
  if (pathname.startsWith("/qr_code/")) return showQrCode(request);
  const avatarToken = avatarTokenOf(pathname);
  if (avatarToken !== null) return showAvatar(request, env, avatarToken);
  const page = write ? null : workspacePageOf(pathname);
  if (page?.page === "person") return personPage(request, env, pathname, page.userId);
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
