// The wire protocol shared by the browser and the Worker: the room socket's frames, each one JSON
// object with a `type`, and what the API sends and takes. Keep this file dependency-free: the
// worker and the web app both import it directly as TypeScript.

import { ROOM_ICON_NAMES } from "./room-icons.ts";

export { ROOM_ICON_NAMES };
export { avatarColor, avatarSvg, crc32, initials } from "./avatars.ts";
export { isAppPage, KIND_SEGMENTS, WORKSPACE_SETTINGS_PATH, workspacePageOf, type RoomAccess, type WorkspacePage } from "./pages.ts";

export type UserId = string;
export type RoomId = string;

export interface User {
  id: UserId;
  name: string;
}

/** Who's signed in, as the app keeps them: someone, and whether they're one of the workspace's administrators. */
export interface Me extends User {
  administrator: boolean;
}

/** What someone is in the workspace: ember-rust's user roles (crates/db/src/models/user.rs). */
export type Role = "member" | "administrator" | "bot";

/** Whether someone can still sign in: people who were removed are deactivated, and banned people are banned. */
export type UserStatus = "active" | "deactivated" | "banned";

/** Someone as the people directory lists them. */
export interface DirectoryUser extends User {
  /** What they say about themselves, or null when they haven't said. */
  bio: string | null;
  role: Role;
  status: UserStatus;
  /** Their avatar, `/users/<token>/avatar?v=<version>`, whose address changes whenever they do. */
  avatarUrl: string;
}

/** What `GET /api/users` answers: everyone in the workspace, deactivated and banned people too. */
export interface Directory {
  users: DirectoryUser[];
}

export type RoomKind = "open" | "closed" | "direct";

/** A room's icon: the name of one of the Lucide icons in ember-rust's catalog. */
export type RoomIconName = (typeof ROOM_ICON_NAMES)[number];

/**
 * A room's icon as New room and a room's settings send it, as ember-rust's forms send `room[icon]`:
 * an icon's name, or "" for the default `#`.
 */
export type RoomIconChoice = RoomIconName | "";

/** A room someone is in, as their room list shows it. */
export interface Room {
  id: RoomId;
  kind: RoomKind;
  name: string;
  /** Null for the default `#`, which DMs always have. */
  icon: RoomIconName | null;
}

/**
 * The welcome card's invitation: the workspace's first room, where the card shows while the room is
 * new, and the code in the workspace's join link, such as aB3d-Ef5h-iJ7k.
 */
export interface Invitation {
  roomId: RoomId;
  joinCode: string;
}

/** A room in someone's sidebar. */
export interface SidebarRoom extends Room {
  /**
   * Whether a message has come since they last had the room open in a shown tab, which marks it
   * unread for them until they do again.
   */
  unread: boolean;
}

/**
 * The rooms someone has starred, which their sidebar lists first, in the order they starred them, as
 * ember-rust's `favorite_channels` keeps them (account.rs). `version` counts the changes to them, so
 * of two lists, the newer is the one with the larger version, whichever arrives last.
 */
export interface Favorites {
  rooms: RoomId[];
  version: number;
}

/**
 * What `GET /api/sidebar` answers: the rooms someone is in, in the order they were made, the ones
 * they've starred, and the invitation, when they're in its room. It comes with an ETag, and a request
 * whose If-None-Match names it gets 304 Not Modified instead.
 */
export interface Sidebar {
  rooms: SidebarRoom[];
  favorites: Favorites;
  invitation: Invitation | null;
}

/**
 * A room to create: an open room takes in everyone, and a closed one only the people `memberIds` names.
 * Without an icon, it has the default `#`.
 */
export type NewRoom = { name: string; icon?: RoomIconChoice } & ({ kind: "open" } | { kind: "closed"; memberIds: UserId[] });

/** Someone active, as a room's settings list them, with whether they're in the room. */
export interface RoomPerson extends User {
  member: boolean;
}

/** What `GET /api/rooms/new` answers for the New room forms: everyone active, by name. */
export interface NewRoomForm {
  people: User[];
}

/** What `GET /api/rooms/<id>/settings` answers for a room's settings page. */
export interface RoomSettings {
  room: Room;
  /** Whether you can change the room, as administrators and its creator can. Others see it read-only. */
  canAdminister: boolean;
  /** Everyone active, by name. */
  people: RoomPerson[];
}

/**
 * What `PATCH /api/rooms/<id>` changes in a room, as its settings save it: its name, its icon, and who
 * it's for, everyone or just the people `memberIds` names, which takes anyone else out of it.
 */
export type RoomChanges = { name?: string; icon?: RoomIconChoice } & ({ kind?: "open" } | { kind: "closed"; memberIds: UserId[] });

/** The workspace, which first run creates. */
export interface Account {
  name: string;
}

/** What `GET /api/account` answers for workspace settings. */
export interface WorkspaceSettings {
  account: Account;
  /** The join link's code, which everyone in the workspace can share. */
  joinCode: string;
  /** Whether you can change the workspace, as administrators can. Members see it read-only. */
  canAdminister: boolean;
}

/** What `POST /api/account/join_code` answers: the join link's new code, which the old one no longer joins with. */
export interface NewJoinCode {
  joinCode: string;
}

/** What `PATCH /api/account` changes, as workspace settings save it: the workspace's name. */
export interface AccountChanges {
  name?: string;
}

/** The roles an administrator can give someone with the crown on workspace settings. Bots stay bots. */
export type PersonRole = Exclude<Role, "bot">;

/** What `PATCH /api/account/users/<id>` sets, as the crown on workspace settings does: someone's role. */
export interface RoleChange {
  role: PersonRole;
}

/** What `PATCH /api/account/users/<id>` answers: the person as the people directory now lists them. */
export interface ChangedPerson {
  user: DirectoryUser;
}

/** Whom the sign-in page offers to email for help: the workspace's first administrator. */
export interface HelpContact {
  name: string;
  emailAddress: string;
}

/** What the app asks first (`GET /api/bootstrap`): whether Ember is set up, and who this browser is signed in as. */
export interface Bootstrap {
  /** "pending" until first run creates the workspace and its first administrator. */
  setup: "pending" | "complete";
  /** Whether setup takes the deployment's private link, because `EMBER_SETUP_TOKEN` is set. */
  setupProtected: boolean;
  /** Whether people may sign in with just a name (`EMBER_GUEST_SIGN_IN`). */
  guestSignIn: boolean;
  /** "Ember" before setup, as in ember-rust. */
  account: Account;
  /** Null until there's an administrator. */
  helpContact: HelpContact | null;
  /** This deployment's version: `APP_VERSION`, else `GIT_REVISION`, else the release. */
  version: string;
  user: Me | null;
}

/**
 * Someone new with an email address and password: the workspace's first administrator, as the Set up
 * Ember form sends them to `POST /api/first_run`, or someone joining, as the join form sends them to
 * `POST /api/join/<code>`.
 */
export interface SignUp {
  name: string;
  emailAddress: string;
  password: string;
}

/** What `POST /api/first_run` answers: the administrator it signed in, and All Talk, which opens first. */
export interface NewWorkspace {
  user: Me;
  room: Room;
}

/** Signing in with an email address and password (`POST /api/session`). */
export interface PasswordSignIn {
  emailAddress: string;
  password: string;
}

/** What `POST /api/unfurl` answers for a link with a preview. A link without one gets 204. */
export interface LinkPreview {
  title: string;
  /** The page's og:url when that's a public http(s) URL, else the link that was sent. */
  url: string;
  /** The page's og:image when a HEAD for it answers a JPEG, PNG, GIF or WebP content type. */
  image: string | null;
  description: string;
}

/** ember-rust's one answer to a sign-in it refuses, for a wrong password and too many attempts alike. */
export const SIGN_IN_REFUSED = "Too many requests or unauthorized.";

/**
 * What a room closes a socket with when access to it ends, where ember-rust sends a `disconnect`
 * frame saying whether to reconnect (crates/ember/src/channels/revocation.rs). A close code says the
 * same and can't go missing, as a frame sent just before the close can.
 */
export const CloseCode = {
  /**
   * Connect again: this browser signed out, say, or the room couldn't trust the connection's sign-in,
   * and a new connection is checked afresh. The app asks at once whether it's still signed in, rather
   * than waiting for the new connection to be refused.
   */
  Reconnect: 4001,
  /** Don't connect again: the person was removed from the workspace or banned, which ended all their sessions. */
  Revoked: 4003,
  /**
   * Don't connect again: the room isn't there for this person, who was taken out of it, or it was
   * deleted. The Worker says so with a socket it closes at once, since a refused upgrade looks to the
   * app like any network failure.
   */
  NotFound: 4004,
} as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];

/** The shortest password first run takes, in characters rather than bytes, as ember-rust counts them. */
export const MIN_PASSWORD_LENGTH = 8;
/** The password fields' `maxlength`, which ember-rust's forms keep from bcrypt's 72-byte limit. */
export const MAX_PASSWORD_LENGTH = 72;
export const PASSWORD_TOO_SHORT = "Password must be at least 8 characters.";
export const PASSWORD_TOO_LONG = "Password must be at most 72 characters.";

export interface Boost {
  id: string;
  messageId: string;
  booster: User;
  content: string;
  createdAt: string;
}

export interface Message {
  id: string;
  /** Generated by the sender so its optimistic copy can be reconciled with the stored one. */
  clientMessageId: string;
  roomId: RoomId;
  creator: User;
  /**
   * Its text as rich text: the markup the room keeps of what the sender wrote (`prepareBody` in
   * packages/richtext). Clients show it through `displayBody`, never as markup.
   */
  body: string;
  /** Its plain text, as Action Text writes it, read from `body` when it was written. */
  plainText: string;
  /** The users it mentions, once each, in order. */
  mentions: UserId[];
  createdAt: string;
  updatedAt: string;
  /** When its text last changed, or null if it never has. */
  editedAt: string | null;
  boosts: Boost[];
}

export type ClientFrame =
  /** A new message, its body markup, as the composer writes it. The room keeps what it can show of it, or refuses it. */
  | { type: "message.create"; clientMessageId: string; body: string }
  /** A message's new body, as for `message.create`. */
  | { type: "message.update"; messageId: string; body: string }
  | { type: "message.delete"; messageId: string }
  | { type: "boost.create"; messageId: string; content: string }
  | { type: "boost.delete"; boostId: string }
  | { type: "typing.start" }
  | { type: "typing.stop" }
  | { type: "history.before"; before: string; limit?: number }
  /** Asks which of these messages the room stored from the sender, after a closed socket lost their confirmations. */
  | { type: "message.check"; clientMessageIds: string[] }
  /** Says the tab has been shown, or hidden, for a few seconds, since the socket's address or the last of these said otherwise. */
  | { type: "presence.visible"; visible: boolean }
  | { type: "ping" };

export type ServerFrame =
  /** Everything a newcomer needs, including who's here. After it, they only hear who arrives and leaves. */
  | { type: "welcome"; you: User; messages: Message[]; present: User[]; hasMore: boolean }
  /** A new message. Its author has stopped typing, too. */
  | { type: "message.created"; message: Message }
  | { type: "message.updated"; message: Message }
  | { type: "message.deleted"; messageId: string }
  | { type: "boost.created"; boost: Boost }
  | { type: "boost.deleted"; boostId: string; messageId: string }
  /** Someone opened the room who didn't have it open already, in another tab. */
  | { type: "presence.joined"; user: User }
  /** Someone closed the last tab they had the room open in, which stops their typing, too. */
  | { type: "presence.left"; userId: UserId }
  | { type: "typing"; user: User; typing: boolean }
  | { type: "history"; messages: Message[]; hasMore: boolean }
  /** Answers message.check: which of the sender's messages the room stored, and which it never received. */
  | { type: "message.checked"; stored: string[]; missing: string[] }
  /**
   * `failed` names the request that went wrong, when the error answers one, and `clientMessageId` or
   * `clientMessageIds` the messages it was about.
   */
  | { type: "error"; message: string; clientMessageId?: string; clientMessageIds?: string[]; failed?: ClientFrame["type"] }
  | { type: "pong" };

/**
 * What a tab sends on its workspace socket (`/api/socket`): only pings, which the runtime answers
 * without waking the Workspace.
 */
export type WorkspaceClientFrame = { type: "ping" };

/** What the Workspace sends on a tab's workspace socket. */
export type WorkspaceServerFrame =
  /** Sent as the Workspace lets the socket in: who its session signs in. */
  | { type: "welcome"; you: Me }
  /** A room of theirs has a message they haven't seen, which marks it unread. Sent only to the person marked, as their mark changes. */
  | { type: "room.unread"; roomId: RoomId }
  /** They've read a room marked unread, in this tab or another. */
  | { type: "room.read"; roomId: RoomId }
  /** Someone changed, as the people directory now lists them: an administrator gave them another role. Sent to everyone. */
  | { type: "user.updated"; user: DirectoryUser }
  /** They've starred or unstarred a room, in this tab or another: their stars as they are now. */
  | { type: "favorites.changed"; favorites: Favorites }
  | { type: "error"; message: string }
  | { type: "pong" };

/**
 * The revision of the room protocol the app speaks, which its room sockets' addresses name. The room
 * tells a tab running an older app to reload, and refuses its messages and edits: before revision 2,
 * tabs sent a message's text rather than its markup, which the room would now read as markup.
 */
export const ROOM_PROTOCOL = 2;

/** What a room socket's address tells the room about the tab opening it. */
export interface RoomSocketParams {
  /** Whether the tab is shown, which `presence.visible` frames update. */
  visible: boolean;
}

/** The query that carries `params` on a room socket's address, with the revision of the protocol the tab speaks. */
export const roomSocketQuery = ({ visible }: RoomSocketParams) => `?visible=${visible ? 1 : 0}&protocol=${ROOM_PROTOCOL}`;

/** The part of a `URLSearchParams` that reading a socket's address needs, which the protocol, made for every runtime, names itself. */
interface SearchParams {
  get(name: string): string | null;
}

/**
 * What a room socket's address says about its tab, as `roomSocketQuery` wrote it, and the revision of the
 * protocol it speaks. A tab that doesn't say counts as shown, and one naming no revision speaks the
 * first, as the app did before it named them.
 */
export const parseRoomSocketParams = (query: SearchParams): RoomSocketParams & { protocol: number } => ({
  visible: query.get("visible") !== "0",
  protocol: Number(query.get("protocol")) || 1,
});

/** The most characters a message's plain text can have. */
export const MAX_MESSAGE_LENGTH = 10_000;
/** What the room says of a message with more, which the app says itself rather than send one. */
export const MESSAGE_TOO_LONG = `Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString("en-US")} characters.`;
/** Whether a message whose plain text is `plainText` is longer than the room takes. */
export const isMessageTooLong = (plainText: string) => plainText.length > MAX_MESSAGE_LENGTH;
/** The most characters of markup a message can arrive as: room for the longest message, formatted. */
export const MAX_MESSAGE_HTML_LENGTH = 100_000;
/** Matches the `boosts.content varchar(16)` column in ember-rust. */
export const MAX_BOOST_LENGTH = 16;
export const HISTORY_PAGE_SIZE = 50;
/** How many messages one message.check can ask about: more than anyone sends before a dead socket is noticed. */
export const MAX_CHECKED_MESSAGES = 50;
/** ember-rust has no limit; this keeps a name to what a sidebar row and a room's header can show. */
export const MAX_ROOM_NAME_LENGTH = 100;
/** ember-rust has no limit; this keeps the workspace's name to what the sidebar's heading can show. */
export const MAX_ACCOUNT_NAME_LENGTH = 100;
/** How many people one request can name: a bound on the request's size, not on a room's. */
export const MAX_LISTED_USERS = 1_000;

/** ember-rust's `REACTIONS`: the first three are quick reactions, the rest sit in the tray. */
export const REACTIONS = [
  ["👍", "Thumbs up"],
  ["👏", "Clapping"],
  ["👋", "Waving hand"],
  ["💪", "Muscle"],
  ["❤️", "Red heart"],
  ["😂", "Face with tears of joy"],
  ["🎉", "Party popper"],
  ["🔥", "Fire"],
] as const;
export const QUICK_REACTION_COUNT = 3;

const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
/** Whether `v` lists people's ids, as many as one request can name. */
const userIds = (v: unknown): v is UserId[] => Array.isArray(v) && v.length <= MAX_LISTED_USERS && v.every(id);

/** Markup no longer than `MAX_MESSAGE_HTML_LENGTH`, or null. Whether it holds a message is the room's to read. */
const markup = (v: unknown): string | null => (typeof v === "string" && v.length <= MAX_MESSAGE_HTML_LENGTH ? v : null);

/** Trimmed, non-empty text no longer than `max`, or null. */
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
};

/** The JSON object `raw` holds, or null if it holds anything else. */
function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(raw);
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Parses an untrusted frame from a room's socket. Returns null for anything malformed. */
export function parseClientFrame(raw: string): ClientFrame | null {
  const f = parseObject(raw);
  if (!f) return null;

  switch (f.type) {
    case "message.create": {
      const body = markup(f.body);
      return id(f.clientMessageId) && body !== null ? { type: f.type, clientMessageId: f.clientMessageId, body } : null;
    }
    case "message.update": {
      const body = markup(f.body);
      return id(f.messageId) && body !== null ? { type: f.type, messageId: f.messageId, body } : null;
    }
    case "message.delete":
      return id(f.messageId) ? { type: f.type, messageId: f.messageId } : null;
    case "boost.create": {
      const content = text(f.content, MAX_BOOST_LENGTH);
      return id(f.messageId) && content ? { type: f.type, messageId: f.messageId, content } : null;
    }
    case "boost.delete":
      return id(f.boostId) ? { type: f.type, boostId: f.boostId } : null;
    case "history.before": {
      if (!id(f.before)) return null;
      const limit = typeof f.limit === "number" ? Math.min(Math.max(1, Math.floor(f.limit)), 100) : undefined;
      return { type: f.type, before: f.before, limit };
    }
    case "message.check": {
      const ids = f.clientMessageIds;
      return Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_CHECKED_MESSAGES && ids.every(id)
        ? { type: f.type, clientMessageIds: ids }
        : null;
    }
    case "presence.visible":
      return typeof f.visible === "boolean" ? { type: f.type, visible: f.visible } : null;
    case "typing.start":
    case "typing.stop":
    case "ping":
      return { type: f.type };
    default:
      return null;
  }
}

/** Parses an untrusted frame from a workspace socket. Returns null for anything malformed. */
export function parseWorkspaceClientFrame(raw: string): WorkspaceClientFrame | null {
  return parseObject(raw)?.type === "ping" ? { type: "ping" } : null;
}

/**
 * Whether `value` could name a room. A room's id also names its Durable Object: the Workspace's
 * sortable ids, or the old address of a room from before it kept a list (`LEGACY_ROOMS`).
 */
export function isRoomId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

// Built on first use, so a bundle that never checks an icon leaves the names out.
let roomIconNames: ReadonlySet<string> | undefined;

/**
 * Whether `value` is exactly the name of an icon in the catalog, as ember-rust checks a room's
 * icon: `"coffee"` is, but `" coffee "`, `"Coffee"` and `""`, which stands for the default `#`, aren't.
 */
export function isRoomIcon(value: unknown): value is RoomIconName {
  roomIconNames ??= new Set(ROOM_ICON_NAMES);
  return typeof value === "string" && roomIconNames.has(value);
}

const ICON_REFUSED = 'Icon must be one of the room icons, or "" for the default';

/**
 * A room's icon as ember-rust's `parse_room_icon` takes it (rooms.rs): undefined when it's left out,
 * which keeps the icon, or null when it's neither "" nor exactly an icon's name.
 */
function iconChoice(value: unknown): RoomIconChoice | null | undefined {
  if (value === undefined) return undefined;
  return value === "" || isRoomIcon(value) ? value : null;
}

/** Parses an untrusted request to create a room. Returns why it's refused instead of the room. */
export function parseNewRoom(data: unknown): NewRoom | string {
  if (typeof data !== "object" || data === null) return "Expected a JSON object";
  const r = data as Record<string, unknown>;
  if (r.kind !== "open" && r.kind !== "closed") return 'Kind must be "open" or "closed"';
  const name = text(r.name, MAX_ROOM_NAME_LENGTH);
  if (!name) return `Name must be 1 to ${MAX_ROOM_NAME_LENGTH} characters`;
  const icon = iconChoice(r.icon);
  if (icon === null) return ICON_REFUSED;
  if (r.kind === "open") return { kind: r.kind, name, icon };
  const memberIds = r.memberIds ?? [];
  return userIds(memberIds) ? { kind: r.kind, name, icon, memberIds } : `Members must be a list of at most ${MAX_LISTED_USERS} user ids`;
}

/**
 * Parses an untrusted change to a room. Returns why it's refused instead of the changes. Making a
 * room private needs its members listed, even if that's nobody, since everyone left out is taken out.
 */
export function parseRoomChanges(data: unknown): RoomChanges | string {
  if (typeof data !== "object" || data === null) return "Expected a JSON object";
  const r = data as Record<string, unknown>;
  const name = r.name === undefined ? undefined : text(r.name, MAX_ROOM_NAME_LENGTH);
  if (name === null) return `Name must be 1 to ${MAX_ROOM_NAME_LENGTH} characters`;
  const icon = iconChoice(r.icon);
  if (icon === null) return ICON_REFUSED;
  const changes = { name, icon };
  if (r.kind === undefined) return changes;
  if (r.kind === "open") return { ...changes, kind: r.kind };
  if (r.kind !== "closed") return 'Kind must be "open" or "closed"';
  return userIds(r.memberIds) ? { ...changes, kind: r.kind, memberIds: r.memberIds } : `Members must be a list of at most ${MAX_LISTED_USERS} user ids`;
}

/**
 * Parses an untrusted change to the workspace. Returns why it's refused instead of the changes. As in
 * ember-rust, the name is saved as typed, even blank.
 */
export function parseAccountChanges(data: unknown): AccountChanges | string {
  // An array is an object too, but not one that can name a change.
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "Expected a JSON object";
  const { name } = data as Record<string, unknown>;
  if (name === undefined) return {};
  return typeof name === "string" && name.length <= MAX_ACCOUNT_NAME_LENGTH ? { name } : `Name must be at most ${MAX_ACCOUNT_NAME_LENGTH} characters`;
}

/**
 * Parses an untrusted role change as ember-rust reads `user[role]` (accounts/users.rs): exactly
 * "administrator" makes someone an administrator, and anything else a member, blank included. Null
 * without a role at all, which ember-rust answers 400, as it does a request without `user`.
 */
export function parseRoleChange(data: unknown): RoleChange | null {
  if (typeof data !== "object" || data === null || Array.isArray(data) || !("role" in data)) return null;
  return { role: data.role === "administrator" ? "administrator" : "member" };
}

/**
 * Parses an untrusted first run or join. Returns why it's refused instead, when a field is missing;
 * the password's length is checked apart from this, since each form has its own rules.
 */
export function parseSignUp(data: unknown): SignUp | string {
  if (typeof data !== "object" || data === null) return "Expected a JSON object";
  const f = data as Record<string, unknown>;
  const name = typeof f.name === "string" ? f.name.trim() : "";
  // Like ember-rust, take the address as typed: the browser checks its shape and trims it.
  const emailAddress = typeof f.emailAddress === "string" ? f.emailAddress : "";
  if (!name || !emailAddress || typeof f.password !== "string") return "Name, email address and password are required";
  return { name, emailAddress, password: f.password };
}

/** Whether a password is shorter than first run takes, counting an emoji as one character. */
export const isPasswordTooShort = (password: string) => [...password].length < MIN_PASSWORD_LENGTH;

/**
 * Whether a password is longer than the password fields take, counting UTF-16 units as their
 * `maxlength` does, so the server takes exactly the passwords the forms can send.
 */
export const isPasswordTooLong = (password: string) => password.length > MAX_PASSWORD_LENGTH;

/**
 * Parses a frame from the server: a room's, or the workspace socket's when `Frame` says so. The
 * server is trusted, so this only guards against garbage.
 */
export function parseServerFrame<Frame extends { type: string } = ServerFrame>(raw: string): Frame | null {
  const data = parseObject(raw);
  return typeof data?.type === "string" ? (data as Frame) : null;
}
