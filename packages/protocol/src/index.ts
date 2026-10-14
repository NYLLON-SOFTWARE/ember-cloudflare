// The wire protocol shared by the browser and the Worker: the room socket's frames, each one JSON
// object with a `type`, and what the API sends and takes. Keep this file dependency-free: the
// worker and the web app both import it directly as TypeScript.

import { ROOM_ICON_NAMES } from "./room-icons.ts";

export { ROOM_ICON_NAMES };
export { isAppPage, KIND_SEGMENTS, WORKSPACE_SETTINGS_PATH, workspacePageOf, type RoomAccess, type WorkspacePage } from "./pages.ts";

export type UserId = string;
export type RoomId = string;

export interface User {
  id: UserId;
  name: string;
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

/**
 * What `GET /api/rooms` answers: the rooms someone is in, in the order they were made, and the
 * invitation, when they're in its room.
 */
export interface RoomList {
  rooms: Room[];
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
  user: User | null;
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
  user: User;
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
  body: string;
  createdAt: string;
  updatedAt: string;
  boosts: Boost[];
}

export type ClientFrame =
  | { type: "message.create"; clientMessageId: string; body: string }
  | { type: "message.update"; messageId: string; body: string }
  | { type: "message.delete"; messageId: string }
  | { type: "boost.create"; messageId: string; content: string }
  | { type: "boost.delete"; boostId: string }
  | { type: "typing.start" }
  | { type: "typing.stop" }
  | { type: "history.before"; before: string; limit?: number }
  /** Asks which of these messages the room stored from the sender, after a closed socket lost their confirmations. */
  | { type: "message.check"; clientMessageIds: string[] }
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

export const MAX_MESSAGE_LENGTH = 10_000;
/** Matches the `boosts.content varchar(16)` column in ember-rust. */
export const MAX_BOOST_LENGTH = 16;
export const HISTORY_PAGE_SIZE = 50;
/** How many messages one message.check can ask about: more than anyone sends before a dead socket is noticed. */
export const MAX_CHECKED_MESSAGES = 50;
/** ember-rust has no limit; this keeps a name to what a sidebar row and a room's header can show. */
export const MAX_ROOM_NAME_LENGTH = 100;
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

/** Trimmed, non-empty text no longer than `max`, or null. */
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
};

/** Parses an untrusted frame from a socket. Returns null for anything malformed. */
export function parseClientFrame(raw: string): ClientFrame | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const f = data as Record<string, unknown>;

  switch (f.type) {
    case "message.create": {
      const body = text(f.body, MAX_MESSAGE_LENGTH);
      return id(f.clientMessageId) && body ? { type: f.type, clientMessageId: f.clientMessageId, body } : null;
    }
    case "message.update": {
      const body = text(f.body, MAX_MESSAGE_LENGTH);
      return id(f.messageId) && body ? { type: f.type, messageId: f.messageId, body } : null;
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
    case "typing.start":
    case "typing.stop":
    case "ping":
      return { type: f.type };
    default:
      return null;
  }
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

/** Parses a frame from the server. The server is trusted, so this only guards against garbage. */
export function parseServerFrame(raw: string): ServerFrame | null {
  try {
    const data: unknown = JSON.parse(raw);
    return typeof data === "object" && data !== null && typeof (data as { type?: unknown }).type === "string"
      ? (data as ServerFrame)
      : null;
  } catch {
    return null;
  }
}
