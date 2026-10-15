import {
  MAX_FAVORITES,
  SUGGESTED_PEOPLE,
  suggestedCount,
  type Account,
  type CloseCode,
  type DirectRoom,
  type Favorites,
  type HelpContact,
  type PersonRole,
  type Profile,
  type Role,
  type RoomChanges,
  type RoomId,
  type RoomSettings,
  type SharedRoom,
  type SidebarRoom,
  type User,
  type UserId,
  type UserStatus,
} from "@ember/protocol";
import { statement, type Db } from "./db";
import { ADDRESS_TAG_PREFIX, EVERYONE, SESSION_TAG_PREFIX, type Revocation } from "./revocations";
import type { RoomEvent } from "./room-log";

// The account, its people, their sessions and their rooms, kept by the Workspace in its own SQLite
// storage or in D1 (see db.ts).

/** The browser and IP a session records. */
export interface Client {
  ip: string | null;
  userAgent: string | null;
}

/** ember-rust's user statuses (crates/db/src/models/user.rs). Only active people can sign in. */
const ACTIVE = 0;
const DEACTIVATED = 1;
const BANNED = 2;
/** ember-rust's role for the people who run the workspace (user.rs). */
const ADMINISTRATOR = 1;
/** ember-rust's roles and statuses (user.rs), each at the number it stores. */
const ROLES: readonly Role[] = ["member", "administrator", "bot"];
const STATUSES: readonly UserStatus[] = ["active", "deactivated", "banned"];

/** The settings ember-rust writes out for a new account (crates/db/src/models/account.rs). */
const NEW_ACCOUNT_SETTINGS = JSON.stringify({ restrict_room_creation_to_administrators: false });

/** What a new account's settings and custom CSS read as: translation buttons hidden, and no CSS. */
export const NEW_ACCOUNT_LOOKS = { hideTranslationButtons: true, customStyles: "" } as const;

/** The workspace's account, with the code in its join link, which only the people in it see. */
export interface JoinableAccount extends Account {
  joinCode: string;
}

/** The account first run creates. */
export interface NewAccount {
  id: string;
  name: string;
  joinCode: string;
}

/** What `WorkspaceStore.changeAccount` changes: the name, Hide translation buttons, or both. */
export type AccountChange = Partial<Pick<Account, "name" | "hideTranslationButtons">>;

/** Someone who signs in with an email address and password: first run's administrator, or someone who joins. */
export interface NewPerson {
  id: UserId;
  name: string;
  emailAddress: string;
  passwordDigest: string;
}

/** A session and the person it signs in. */
export interface StoredSession {
  id: string;
  user: User;
  /** Whether the person is one of the workspace's administrators. */
  administrator: boolean;
  /** Whether the person signed in with just a name. */
  guest: boolean;
  /** When the session was last refreshed, in milliseconds since the epoch. */
  lastActiveAt: number;
}

/** Someone as the people directory lists them, with when they last changed, which their avatar's address follows. */
export interface DirectoryEntry extends User {
  bio: string | null;
  role: Role;
  status: UserStatus;
  updatedAt: string;
}

/** Someone as the people directory lists them, with their email address, which their profile shows too. */
export interface ProfileEntry extends DirectoryEntry {
  emailAddress: string | null;
}

/** What `WorkspaceStore.changeProfile` saves: someone's profile, and the digest of a new password, or null to keep theirs. */
export interface ProfileChange extends Profile {
  passwordDigest: string | null;
}

/** What someone's avatar is drawn from. */
export interface AvatarOwner {
  name: string;
  bot: boolean;
}

/** What changing a room changed, and who's in it then. */
export interface SavedRoomChange {
  /** Whether its name, kind or icon changed. */
  roomChanged: boolean;
  memberIds: UserId[];
  /** Who the change put in the room. */
  addedIds: UserId[];
  /** Who it took out, whose sockets there it queued closing. */
  removedIds: UserId[];
}

/** What applying events from a room's log changed. */
export interface AppliedEvents {
  /** Whose unread marks changed, and whether each is now unread. */
  marks: Map<UserId, boolean>;
  /** When messages came in a DM, when the latest did and everyone in the DM; null otherwise. */
  active: { at: string; userIds: UserId[] } | null;
}

/** A revocation the Workspace has yet to deliver to its room. */
export interface PendingRevocation extends Revocation {
  id: number;
  roomId: RoomId;
}

/** A room the outbox has yet to ask to delete a banned person's messages. */
export interface PendingPurge {
  id: number;
  roomId: RoomId;
  userId: UserId;
  /** When their ban was lifted, if it has been, after which what they write stays. */
  liftedAt: string | null;
}

interface SessionRow {
  session_id: string;
  last_active_at: string;
  user_id: string;
  name: string;
  administrator: number;
  guest: number;
}

const INSERT_SESSION = `INSERT INTO sessions (id, user_id, token_digest, ip_address, user_agent, last_active_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * The same, for someone who signed in, unless they've stopped being active since, or their password
 * has been reset since it was checked.
 */
const INSERT_SESSION_IF_UNCHANGED = `INSERT INTO sessions (id, user_id, token_digest, ip_address, user_agent, last_active_at, created_at, updated_at)
  SELECT ?, id, ?, ?, ?, ?, ?, ? FROM users WHERE id = ? AND status = ${ACTIVE} AND password_digest = ?`;

/**
 * The same, for someone signing in with a sign-in link, unless they're no longer active, or are a guest
 * while the last value says guests can't stay signed in.
 */
const INSERT_TRANSFERRED_SESSION = `INSERT INTO sessions (id, user_id, token_digest, ip_address, user_agent, last_active_at, created_at, updated_at)
  SELECT ?, id, ?, ?, ?, ?, ?, ? FROM users WHERE id = ? AND status = ${ACTIVE} AND (guest = 0 OR ? = 1)`;

/** The session a token's digest names, if its person is still active. */
const SESSION = `SELECT sessions.id AS session_id, sessions.last_active_at, users.id AS user_id, users.name,
    users.role = ${ADMINISTRATOR} AS administrator, users.guest
  FROM sessions JOIN users ON users.id = sessions.user_id
  WHERE sessions.token_digest = ? AND users.status = ${ACTIVE}`;

interface DirectoryRow {
  id: UserId;
  name: string;
  bio: string | null;
  role: number;
  status: number;
  updated_at: string;
}

const directoryEntry = (row: DirectoryRow): DirectoryEntry => ({
  id: row.id,
  name: row.name,
  bio: row.bio,
  role: ROLES[row.role] ?? "member",
  status: STATUSES[row.status] ?? "active",
  updatedAt: row.updated_at,
});

/** Whether a value is `present?`, as ember-rust reads a setting (account.rs): not null, false, blank, or empty. */
function isPresent(value: unknown): boolean {
  if (value === null || value === false || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return typeof value !== "object" || Object.keys(value).length > 0;
}

/**
 * Whether the account's settings hide the translation buttons, as ember-rust reads them (account.rs,
 * `hide_translation_buttons`): hidden until the setting is stored, even for an existing account, then
 * only while it's present, so a stored false or blank shows them. Settings that don't parse hide them.
 */
function hidesTranslationButtons(settings: string | null): boolean {
  let stored: unknown;
  try {
    stored = JSON.parse(settings ?? "{}");
  } catch {
    return true;
  }
  const hide = typeof stored === "object" && stored !== null && !Array.isArray(stored) ? (stored as Record<string, unknown>).hide_translation_buttons : undefined;
  return hide === undefined || isPresent(hide);
}

interface RoomToChangeRow extends SharedRoom {
  can_administer: number;
}

/** A room someone is in, as `ROOMS_FOR_USER` reads it: a DM's name and icon are null. */
interface SidebarRow {
  id: RoomId;
  kind: SidebarRoom["kind"];
  name: string | null;
  icon: SharedRoom["icon"];
  active_at: string;
  unread: number;
}

/** Someone in a DM, as the statements that read a DM's people return them. */
interface DirectMemberRow extends User {
  room_id: RoomId;
}

/** Someone in a DM, as `DIRECT_WITH_KEY` reads them, with when the DM was last active. */
interface KeyedDirectMemberRow extends DirectMemberRow {
  active_at: string;
}

/** A row naming someone, as the statements that answer whom they changed return them. */
interface UserIdRow {
  user_id: UserId;
}

const userIdsOf = (rows: UserIdRow[]) => rows.map((row) => row.user_id);

/** A DM's people, as the app has them, from the rows naming them. */
const membersOf = (rows: DirectMemberRow[]): User[] => rows.map(({ id, name }) => ({ id, name }));

/** A room as someone's sidebar lists it, with the people in it if it's a DM, whom `members` reads. */
const sidebarRoom = ({ id, kind, name, icon, active_at, unread }: SidebarRow, members: DirectMemberRow[] = []): SidebarRoom =>
  kind === "direct"
    ? { id, kind, members: membersOf(members), activeAt: active_at, unread: unread === 1 }
    : { id, kind, name: name ?? "", icon, unread: unread === 1 };

const roomToChange = (row: RoomToChangeRow) => ({ room: { id: row.id, kind: row.kind, name: row.name, icon: row.icon }, canAdminister: row.can_administer === 1 });

const storedSession = (row: SessionRow): StoredSession => ({
  id: row.session_id,
  user: { id: row.user_id, name: row.name },
  administrator: row.administrator === 1,
  guest: row.guest === 1,
  lastActiveAt: Date.parse(row.last_active_at),
});

/** When a room was last active: when its latest message came, or when it was made, until one has. */
const ACTIVE_AT = `coalesce(rooms.last_message_at, rooms.created_at) AS active_at`;

/**
 * The rooms someone is in, with whether each is marked unread for them and when it was last active,
 * which orders DMs, in the order they were made, for the app to go home to the oldest and to `/rooms`
 * to the newest, as ember-rust's `original_for_user` and `last_for_user` find them (room.rs). Rooms
 * from before the Workspace kept a list (`LEGACY_ROOMS`) have ids that don't sort by time, so they go
 * by when they were listed.
 */
export const ROOMS_FOR_USER = `SELECT rooms.id, rooms.kind, rooms.name, rooms.icon, ${ACTIVE_AT}, memberships.unread_at IS NOT NULL AS unread
  FROM memberships JOIN rooms ON rooms.id = memberships.room_id
  WHERE memberships.user_id = ? ORDER BY rooms.created_at, rooms.id`;

/**
 * The workspace's first room, where the welcome card shows: its oldest, of any kind, as ember-rust's
 * `Room::original` finds it (room.rs). Rooms from before the Workspace kept a list (`LEGACY_ROOMS`)
 * count from when they were listed, as they do in `ROOMS_FOR_USER`, so the preview's is its general.
 */
export const ORIGINAL_ROOM = `SELECT id FROM rooms ORDER BY created_at, id LIMIT 1`;

/**
 * Who's in each of someone's DMs, them included, a DM at a time, each DM's people by id, as ember-rust
 * finds them in the order its memberships' index has them (`room.users`, room.rs).
 */
export const DIRECT_MEMBERS_FOR_USER = `SELECT members.room_id, users.id, users.name
  FROM memberships AS mine JOIN rooms ON rooms.id = mine.room_id
    JOIN memberships AS members ON members.room_id = mine.room_id JOIN users ON users.id = members.user_id
  WHERE mine.user_id = ? AND rooms.kind = 'direct' ORDER BY members.room_id, members.user_id`;

/**
 * A DM's key: its people's ids, each once, sorted, as a JSON array, so each group of people has one key
 * whatever order they're named in, and `json_each` reads it back.
 */
const directKey = (memberIds: UserId[]) => JSON.stringify([...new Set(memberIds)].sort());

/**
 * Adds a DM, ?1, made by ?2 for the people ?3 is the key of, as of ?4, unless those people have one
 * already, as ember-rust's `find_or_create_direct_for` makes one (room.rs), answering it if it added it.
 */
const INSERT_DIRECT = `INSERT INTO rooms (id, kind, creator_id, direct_key, created_at, updated_at) VALUES (?1, 'direct', ?2, ?3, ?4, ?4)
  ON CONFLICT (direct_key) DO NOTHING RETURNING id`;

/**
 * Puts the people key ?3 names in DM ?1, as of ?2, if `INSERT_DIRECT` added it, at ember-rust's
 * `default_involvement` for a DM, everything (room.rs).
 */
const GRANT_DIRECT = `INSERT INTO memberships (room_id, user_id, involvement, created_at, updated_at)
  SELECT ?1, users.id, 'everything', ?2, ?2 FROM users
  WHERE users.id IN (SELECT value FROM json_each(?3)) AND EXISTS (SELECT 1 FROM rooms WHERE id = ?1)
  ON CONFLICT DO NOTHING`;

/** The DM a key names, when it was last active, and who's in it, by id. */
const DIRECT_WITH_KEY = `SELECT rooms.id AS room_id, ${ACTIVE_AT}, users.id, users.name
  FROM rooms JOIN memberships ON memberships.room_id = rooms.id JOIN users ON users.id = memberships.user_id
  WHERE rooms.direct_key = ? ORDER BY memberships.user_id`;

/**
 * The people the sidebar suggests ?1 start a DM with, before it leaves out as many as their DMs take:
 * the active people with the oldest accounts who share no DM with them, never them, as ember-rust's
 * `find_direct_placeholder_users` finds them (controllers/presenters/accounts.rs). The people in their
 * DMs come from a subquery, where ember-rust binds them as a list, and the index on users' age lets it
 * stop at the last one it needs rather than sorting everyone.
 */
export const SUGGESTED_FOR_USER = `SELECT id, name FROM users
  WHERE status = ${ACTIVE} AND id <> ?1 AND id NOT IN (
    SELECT members.user_id FROM memberships AS mine JOIN rooms ON rooms.id = mine.room_id
      JOIN memberships AS members ON members.room_id = mine.room_id
    WHERE mine.user_id = ?1 AND rooms.kind = 'direct')
  ORDER BY created_at, id LIMIT ${SUGGESTED_PEOPLE - 1}`;

/**
 * Queues revoking a session's sockets in every room its person is in, the only rooms it can have
 * sockets in, answering a row for each room.
 */
const QUEUE_SESSION_REVOCATIONS = `INSERT INTO pending_revocations (room_id, tag, code, due_at)
  SELECT memberships.room_id, ? || sessions.id, ?, ? FROM sessions JOIN memberships ON memberships.user_id = sessions.user_id
  WHERE sessions.token_digest = ? RETURNING id`;

/**
 * Queues closing the sockets of everyone in a room but the people a JSON list names, whom changing
 * the room takes out of it, answering a row for each. Their person tag closes all their sockets there.
 */
export const QUEUE_MEMBER_REVOCATIONS = `INSERT INTO pending_revocations (room_id, tag, code, due_at)
  SELECT room_id, user_id, ?, ? FROM memberships WHERE room_id = ? AND user_id NOT IN (SELECT value FROM json_each(?)) RETURNING id`;

/**
 * Queues revoking the sockets of each of someone's sessions in every room they're in, answering a row
 * for each session in each room. Session tags, rather than their person tag, so a delivery tried again
 * after they've signed in afresh leaves the new session's sockets open.
 */
const QUEUE_PERSON_SESSION_REVOCATIONS = `INSERT INTO pending_revocations (room_id, tag, code, due_at)
  SELECT memberships.room_id, ? || sessions.id, ?, ? FROM sessions JOIN memberships ON memberships.user_id = sessions.user_id
  WHERE sessions.user_id = ? RETURNING id`;

/** Revocations due by a time, those due longest first, up to a number of them. */
export const DUE_REVOCATIONS = `SELECT id, room_id AS roomId, tag, code FROM pending_revocations WHERE due_at <= ? ORDER BY due_at, id LIMIT ?`;

/**
 * Queues deleting someone's messages in every room they can have written in, answering a row for
 * each: every room but the DMs they aren't in, whose people never change.
 */
const QUEUE_PURGES = `INSERT INTO pending_purges (room_id, user_id, due_at)
  SELECT id, ?1, ?2 FROM rooms WHERE kind <> 'direct' OR id IN (SELECT room_id FROM memberships WHERE user_id = ?1) RETURNING id`;

/**
 * Queues having every room close the sockets from each address in a JSON list, telling them to connect
 * again, answering a row for each room and address: banning an address, or lifting the ban, changes
 * what they may do, which the Workspace checks as they connect.
 */
const QUEUE_ADDRESS_REVOCATIONS = `INSERT INTO pending_revocations (room_id, tag, code, due_at)
  SELECT rooms.id, ?1 || addresses.value, ?2, ?3 FROM rooms, json_each(?4) AS addresses RETURNING id`;

/** The same for the addresses someone's ban blocks, which lifting it unblocks. */
const QUEUE_UNBANNED_ADDRESS_REVOCATIONS = `INSERT INTO pending_revocations (room_id, tag, code, due_at)
  SELECT rooms.id, ?1 || addresses.ip_address, ?2, ?3 FROM rooms, (SELECT DISTINCT ip_address FROM bans WHERE user_id = ?4) AS addresses
  RETURNING id`;

/**
 * The purges a room can take: none while it has sockets left to close, which may be the banned person's,
 * who could write through one after their purge had finished. The outbox holds a revocation only until
 * its room answers, so this reads them all rather than keep an index.
 */
const PURGEABLE = `room_id NOT IN (SELECT room_id FROM pending_revocations)`;

/** Purges due by a time that their rooms can take, those due longest first, up to a number of them. */
export const DUE_PURGES = `SELECT id, room_id AS roomId, user_id AS userId, lifted_at AS liftedAt FROM pending_purges
  WHERE due_at <= ? AND ${PURGEABLE} ORDER BY due_at, id LIMIT ?`;

/** When the next purge a room can take is due. One waiting on its room's revocations is due once they've gone. */
export const NEXT_PURGE_DUE = `SELECT due_at FROM pending_purges WHERE ${PURGEABLE} ORDER BY due_at LIMIT 1`;

/** How long the outbox waits to deliver a revocation again after it fails, doubling each time up to the longest wait. */
const FIRST_RETRY_MS = 1_000;
const LONGEST_RETRY_MS = 5 * 60 * 1000;
/**
 * How many times the outbox tries to deliver a revocation before giving up: over 8 minutes of tries.
 * It never gives up on a room's deletion, whose messages would otherwise stay stored with nothing left
 * to delete them, but tries it at the longest wait until it's delivered.
 */
const DELIVERY_ATTEMPTS = 10;

/** Whether someone is in a room. */
export const MEMBERSHIP = `SELECT 1 FROM memberships WHERE room_id = ? AND user_id = ?`;

/**
 * Whether someone is in a room, and whether a ban blocks the IP address they come from, in one go,
 * asked on every room socket's upgrade.
 */
export const ROOM_ACCESS = `SELECT EXISTS (SELECT 1 FROM memberships WHERE room_id = ? AND user_id = ?) AS member,
  EXISTS (SELECT 1 FROM bans WHERE ip_address = ?) AS banned`;

/**
 * Marks a room unread, as of a message, for its members who aren't marked already, haven't hidden it,
 * didn't write the message and aren't among the people a JSON list names, who are viewing it, as
 * ember-rust's `unread_memberships` does (room.rs), answering a row for each. It writes only the rows
 * it changes, where ember-rust rewrites every member who isn't connected. Nothing changes once the
 * Workspace has applied the message's event, so one delivered again is applied once.
 */
export const MARK_UNREAD = `UPDATE memberships SET unread_at = ?1
  WHERE room_id = ?2 AND unread_at IS NULL AND involvement <> 'invisible' AND user_id <> ?3
    AND user_id NOT IN (SELECT value FROM json_each(?4)) AND ?5 > (SELECT applied_seq FROM rooms WHERE id = ?2)
  RETURNING user_id`;

/** Clears someone's unread mark on a room, as ember-rust's `read` does (membership.rs), answering a row if there was one, once for each event. */
export const MARK_READ = `UPDATE memberships SET unread_at = NULL
  WHERE room_id = ?1 AND user_id = ?2 AND unread_at IS NOT NULL AND ?3 > (SELECT applied_seq FROM rooms WHERE id = ?1)
  RETURNING user_id`;

/**
 * Everyone in DM ?1, to tell of a message in it, numbered ?2, that the Workspace hasn't applied yet,
 * and nobody for any other room or a message applied before.
 */
const TOLD_OF_DIRECT_MESSAGE = `SELECT user_id FROM memberships
  WHERE room_id = ?1 AND ?2 > (SELECT applied_seq FROM rooms WHERE id = ?1 AND kind = 'direct')`;

/** Records that the Workspace has applied room ?2's events up to ?1. */
const APPLIED = `UPDATE rooms SET applied_seq = ?1 WHERE id = ?2 AND applied_seq < ?1`;

/** Records that too, and that the room's latest message came at ?3, unless it has heard of a later one. */
const APPLIED_WITH_MESSAGE = `UPDATE rooms SET applied_seq = ?1, last_message_at = max(coalesce(last_message_at, ?3), ?3)
  WHERE id = ?2 AND applied_seq < ?1`;

/** Whether someone is one of the workspace's active administrators. */
export const ACTIVE_ADMINISTRATOR = `SELECT 1 FROM users WHERE id = ? AND role = ${ADMINISTRATOR} AND status = ${ACTIVE}`;

/**
 * Renames the workspace and records when, unless it has that name already, as ember-rust's
 * `Account::update` changes only what differs (account.rs).
 */
const RENAME_ACCOUNT = `UPDATE accounts SET name = ?1, updated_at = ?2 WHERE name IS NOT ?1`;

/**
 * Sets Hide translation buttons, true or false as JSON, in the account's settings and records when.
 * The other settings stay, as ember-rust merges a change into them (account.rs, `assign`), and
 * settings that aren't a JSON object start afresh, as ember-rust reads them.
 */
const SET_HIDE_TRANSLATION_BUTTONS = `UPDATE accounts SET settings = json_set(
    CASE WHEN json_valid(settings) AND json_type(settings) = 'object' THEN settings ELSE '{}' END,
    '$.hide_translation_buttons', json(?1)
  ), updated_at = ?2`;

/** Saves the workspace's custom CSS as typed and records when, unless it's that already. */
const CHANGE_CUSTOM_STYLES = `UPDATE accounts SET custom_styles = ?1, updated_at = ?2 WHERE custom_styles IS NOT ?1`;

/** Gives the join link a new code and records when, as ember-rust's `reset_join_code` does (account.rs). */
const CHANGE_JOIN_CODE = `UPDATE accounts SET join_code = ?, updated_at = ?`;

/**
 * The rooms someone, ?1, can star: the ones they're in and haven't hidden, but not DMs, as ember-rust's
 * `set_channel_favorite` finds them (account.rs).
 */
const STARRABLE_ROOMS = `SELECT memberships.room_id FROM memberships JOIN rooms ON rooms.id = memberships.room_id
  WHERE memberships.user_id = ?1 AND memberships.involvement <> 'invisible' AND rooms.kind <> 'direct'`;

/** Whether room ?2 is one of them, found by its membership's key. */
const STARRABLE = `EXISTS (SELECT 1 FROM memberships JOIN rooms ON rooms.id = memberships.room_id
  WHERE memberships.room_id = ?2 AND memberships.user_id = ?1 AND memberships.involvement <> 'invisible' AND rooms.kind <> 'direct')`;

/** Whether ?1 has starred room ?2. */
const STARRED = `EXISTS (SELECT 1 FROM favorites WHERE user_id = ?1 AND room_id = ?2)`;

/**
 * Stars room ?2 for ?1 after their other stars, if they can star it and, counting only the rooms they
 * can star, have fewer stars than they can have. A room they've starred already keeps its place.
 */
const STAR = `INSERT INTO favorites (user_id, room_id, position)
  SELECT ?1, ?2, (SELECT coalesce(max(position) + 1, 0) FROM favorites WHERE user_id = ?1)
  WHERE ${STARRABLE} AND (SELECT count(*) FROM favorites WHERE user_id = ?1 AND room_id IN (${STARRABLE_ROOMS})) < ${MAX_FAVORITES}
  ON CONFLICT DO NOTHING`;

/** Unstars room ?2 for ?1, if they can star it. */
const UNSTAR = `DELETE FROM favorites WHERE user_id = ?1 AND room_id = ?2 AND ${STARRABLE}`;

/**
 * What follows a change to someone's stars, once `saved` says it did what was asked: dropping ?1's
 * stars on rooms they can't star now, as ember-rust drops them (account.rs), and counting the change,
 * answering the new version.
 */
const afterStarring = (saved: string) => ({
  drop: `DELETE FROM favorites WHERE user_id = ?1 AND room_id NOT IN (${STARRABLE_ROOMS}) AND ${saved}`,
  count: `UPDATE users SET favorites_version = favorites_version + 1 WHERE id = ?1 AND ${saved} RETURNING favorites_version AS version`,
});
/** A star stands only if it was allowed, and an unstar only needs the room to be one they can star. */
const AFTER_STAR = afterStarring(`${STARRABLE} AND ${STARRED}`);
const AFTER_UNSTAR = afterStarring(STARRABLE);

/** The rooms ?1 has starred and can star, in the order they starred them. */
const FAVORITES_FOR_USER = `SELECT room_id FROM favorites WHERE user_id = ?1 AND room_id IN (${STARRABLE_ROOMS}) ORDER BY position`;
const FAVORITES_VERSION = `SELECT favorites_version AS version FROM users WHERE id = ?`;

/**
 * Whether ?2, a JSON array of distinct room ids, is exactly the rooms ?1 has starred and can star, as
 * ember-rust's `set_favorite_order` requires (account.rs), so that an order from a tab that hasn't
 * heard of a star or unstar since can't undo it. The ids go in as one value, since there can be
 * thousands.
 */
const THEIR_STARS = `(SELECT count(*) FROM json_each(?2)) = (SELECT count(*) FROM favorites WHERE user_id = ?1 AND room_id IN (${STARRABLE_ROOMS}))
  AND NOT EXISTS (SELECT 1 FROM json_each(?2) WHERE value NOT IN (SELECT room_id FROM favorites WHERE user_id = ?1 AND room_id IN (${STARRABLE_ROOMS})))`;

/**
 * Puts ?1's stars in the order ?2 lists them, if it lists exactly their stars. Their stars on rooms they
 * can't star now, which ?2 leaves out, are dropped after it, as ember-rust's new list loses them.
 */
const REORDER_STARS = `UPDATE favorites SET position = listed.key FROM json_each(?2) AS listed
  WHERE favorites.user_id = ?1 AND favorites.room_id = listed.value AND ${THEIR_STARS}`;
const AFTER_REORDER = afterStarring(THEIR_STARS);

/** Everyone active, by name, as ember-rust lists them for New room (`User.active.ordered`, user.rs). */
export const ACTIVE_PEOPLE = `SELECT id, name FROM users WHERE status = ${ACTIVE} ORDER BY lower(name), id`;

/** Everyone, for the people directory: removed and banned people too, whose messages stay. */
const DIRECTORY = `SELECT id, name, bio, role, status, updated_at FROM users ORDER BY id`;

/** Someone active, as the directory lists them, as ember-rust finds whom to change (`User.active.find`, accounts/users.rs). */
const ACTIVE_PERSON = `SELECT id, name, bio, role, status, updated_at FROM users WHERE id = ? AND status = ${ACTIVE}`;

/** Gives someone a role and records when. */
const CHANGE_ROLE = `UPDATE users SET role = ?, updated_at = ? WHERE id = ?`;

/**
 * Takes someone out of every room but their DMs, which they stay in, as ember-rust's `User#deactivate`
 * does (user.rs). It looks up each of their rooms, where `room_id IN (SELECT ...)` would read them all.
 */
const LEAVE_SHARED_ROOMS = `DELETE FROM memberships WHERE user_id = ?
  AND EXISTS (SELECT 1 FROM rooms WHERE rooms.id = memberships.room_id AND rooms.kind <> 'direct')`;

/**
 * Marks someone removed and records when, writing the first value before each "@" of their email
 * address, which frees it, as ember-rust's `deactivated_email_address` does (user.rs). No email address
 * stays none.
 */
const DEACTIVATE = `UPDATE users SET status = ${DEACTIVATED}, email_address = replace(email_address, '@', ?), updated_at = ? WHERE id = ?`;

/** Someone as the directory lists them, whatever their status, as ember-rust finds whom to ban (`find_user`, users.rs). */
const PERSON = `SELECT id, name, bio, role, status, updated_at FROM users WHERE id = ?`;

/**
 * The IP addresses recorded on someone's sessions, each once, without none or blanks, as ember-rust
 * reads them to ban (`create_bans_from_sessions`, user.rs).
 */
const SESSION_IP_ADDRESSES = `SELECT DISTINCT ip_address FROM sessions WHERE user_id = ? AND trim(ip_address) <> ''`;

/** Someone as the directory lists them, with their email address, whatever their status. */
const PERSON_WITH_PROFILE = `SELECT id, name, email_address, bio, role, status, updated_at FROM users WHERE id = ?`;

/** Saves someone's profile and records when, keeping their password unless given a new one's digest. */
const CHANGE_PROFILE = `UPDATE users SET name = ?, email_address = ?, bio = ?, password_digest = coalesce(?, password_digest), updated_at = ?
  WHERE id = ?`;

/** The same, with whether each is in a room, for its settings. */
export const ACTIVE_PEOPLE_IN_ROOM = `SELECT users.id, users.name, memberships.user_id IS NOT NULL AS member
  FROM users LEFT JOIN memberships ON memberships.room_id = ? AND memberships.user_id = users.id
  WHERE users.status = ${ACTIVE} ORDER BY lower(users.name), users.id`;

/** The people with the ids in a JSON array, whatever their status. */
export const PEOPLE_WITH_IDS = `SELECT id, name FROM users WHERE id IN (SELECT value FROM json_each(?))`;

/** How many people the mentions prompt offers: ember-rust's first page of them, the only one Lexxy asks for. */
export const MENTIONABLE_PAGE = 20;

/**
 * Active people whose names contain ?1, by name, as ember-rust offers them to mention outside a room
 * (`User.active.filtered_by(query).ordered`, autocompletable.rs). It's `LIKE`, so only ASCII letters
 * ignore case, `%` and `_` match anything, and "" matches everyone.
 */
const MENTIONABLE_PEOPLE = `SELECT id, name, bio, role, status, updated_at FROM users
  WHERE status = ${ACTIVE} AND name LIKE '%' || ?1 || '%' ORDER BY lower(name), id LIMIT ${MENTIONABLE_PAGE}`;

/** The same of room ?2's members (`Current.user.rooms.find(room_id).users`). */
const MENTIONABLE_MEMBERS = `SELECT users.id, users.name, users.bio, users.role, users.status, users.updated_at
  FROM memberships JOIN users ON users.id = memberships.user_id
  WHERE memberships.room_id = ?2 AND users.status = ${ACTIVE} AND users.name LIKE '%' || ?1 || '%'
  ORDER BY lower(users.name), users.id LIMIT ${MENTIONABLE_PAGE}`;

/** Whether someone in a room can change it: administrators and the room's creator can, as ember-rust's `can_administer` says (user.rs). */
const CAN_ADMINISTER = `(users.role = ${ADMINISTRATOR} OR rooms.creator_id = users.id) AS can_administer`;

/** A room someone is in, unless it's a DM, and whether they can change it. */
export const ROOM_TO_CHANGE = `SELECT rooms.id, rooms.kind, rooms.name, rooms.icon, ${CAN_ADMINISTER}
  FROM memberships JOIN rooms ON rooms.id = memberships.room_id JOIN users ON users.id = memberships.user_id
  WHERE memberships.room_id = ? AND memberships.user_id = ? AND rooms.kind <> 'direct'`;

/** A room someone is in, DMs included, by its kind, and whether they can change it. */
const ROOM_TO_DELETE = `SELECT rooms.kind, ${CAN_ADMINISTER}
  FROM memberships JOIN rooms ON rooms.id = memberships.room_id JOIN users ON users.id = memberships.user_id
  WHERE memberships.room_id = ? AND memberships.user_id = ?`;

// Memberships are granted with one statement for everyone, rather than a row at a time, since both
// backends bind at most 100 values a statement. A WHERE clause comes before each ON CONFLICT, which
// SQLite would otherwise read as part of a join.

/** Puts someone new in every open room, as ember-rust does for every person and bot who joins (user.rs). */
const GRANT_OPEN_ROOMS_TO_USER = `INSERT INTO memberships (room_id, user_id, created_at, updated_at)
  SELECT id, ?, ?, ? FROM rooms WHERE kind = 'open' ON CONFLICT DO NOTHING`;

/**
 * Puts every active person in an open room, keeping the memberships they already have (room.rs), and
 * answers whom it put in.
 */
const GRANT_ROOM_TO_ACTIVE_USERS = `INSERT INTO memberships (room_id, user_id, created_at, updated_at)
  SELECT ?, id, ?, ? FROM users WHERE status = ${ACTIVE} ON CONFLICT DO NOTHING RETURNING user_id`;

/**
 * Adds one of first run's open rooms, made by ?3, unless the workspace has an open room of its name
 * already, as the preview has its general and random from before the Workspace kept a list.
 */
const INSERT_FIRST_ROOM = `INSERT INTO rooms (id, kind, name, creator_id, created_at, updated_at)
  SELECT ?1, 'open', ?2, ?3, ?4, ?4 WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE kind = 'open' AND name = ?2)`;

/** Puts every active person in one of first run's rooms, if it was added: one it found has them already, being open. */
const GRANT_FIRST_ROOM = `INSERT INTO memberships (room_id, user_id, created_at, updated_at)
  SELECT rooms.id, users.id, ?, ? FROM rooms, users WHERE rooms.id = ? AND users.status = ${ACTIVE} ON CONFLICT DO NOTHING`;

/** The oldest open room with a name, which first run opens: the one it added, or the one it found. */
const OPEN_ROOM_NAMED = `SELECT id, kind, name, icon FROM rooms WHERE kind = 'open' AND name = ? ORDER BY created_at, id LIMIT 1`;

/**
 * Puts the people a JSON list names in a room, whatever their status, as ember-rust's private rooms do,
 * and answers whom it put in.
 */
const GRANT_ROOM_TO_USERS = `INSERT INTO memberships (room_id, user_id, created_at, updated_at)
  SELECT ?, id, ?, ? FROM users WHERE id IN (SELECT value FROM json_each(?)) ON CONFLICT DO NOTHING RETURNING user_id`;

/** Takes everyone but the people a JSON list names out of a room, and answers whom. */
export const REVOKE_ROOM_FROM_OTHERS = `DELETE FROM memberships WHERE room_id = ? AND user_id NOT IN (SELECT value FROM json_each(?)) RETURNING user_id`;

/** Who's in a room, which the memberships' key finds. */
export const ROOM_MEMBERS = `SELECT user_id FROM memberships WHERE room_id = ?`;

/**
 * Renames a room, changes its kind and sets its icon, keeping whichever is null as it is, and records
 * when, unless nothing changes, as ember-rust's `Room::update` does (room.rs). An icon of "" is the
 * default `#`, stored as null.
 */
const UPDATE_ROOM = `UPDATE rooms SET name = coalesce(?1, name), kind = coalesce(?2, kind),
    icon = CASE WHEN ?3 IS NULL THEN icon ELSE nullif(?3, '') END, updated_at = ?4
  WHERE id = ?5 AND (name IS NOT coalesce(?1, name) OR kind IS NOT coalesce(?2, kind)
    OR icon IS NOT CASE WHEN ?3 IS NULL THEN icon ELSE nullif(?3, '') END) RETURNING id`;

/** Of the rooms a JSON list names, those that are neither registered nor deleted. */
const UNREGISTERED_ROOMS = `SELECT DISTINCT value AS id FROM json_each(?)
  WHERE value NOT IN (SELECT id FROM rooms) AND value NOT IN (SELECT id FROM deleted_rooms)`;

/** Keeps the people a JSON list of `{id, name}` names as deactivated guests, unless they're already here. */
const INSERT_FORMER_GUESTS = `INSERT INTO users (id, name, status, guest, created_at, updated_at)
  SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), ${DEACTIVATED}, 1, ?, ? FROM json_each(?) WHERE true
  ON CONFLICT DO NOTHING`;

export class WorkspaceStore {
  constructor(private readonly db: Db) {}

  /** The workspace's account, or null until first run creates it. */
  async account(): Promise<JoinableAccount | null> {
    const [row] = await this.db.all<{ name: string; join_code: string; settings: string | null; custom_styles: string | null }>(
      `SELECT name, join_code, settings, custom_styles FROM accounts`,
    );
    if (!row) return null;
    return { name: row.name, joinCode: row.join_code, hideTranslationButtons: hidesTranslationButtons(row.settings), customStyles: row.custom_styles ?? "" };
  }

  /** Changes the workspace's name, Hide translation buttons, or both, in one batch. */
  async changeAccount({ name, hideTranslationButtons }: AccountChange, now: string): Promise<void> {
    await this.db.batch([
      ...(name === undefined ? [] : [statement(RENAME_ACCOUNT, name, now)]),
      ...(hideTranslationButtons === undefined ? [] : [statement(SET_HIDE_TRANSLATION_BUTTONS, JSON.stringify(hideTranslationButtons), now)]),
    ]);
  }

  /** Saves the workspace's custom CSS. */
  async changeCustomStyles(customStyles: string, now: string): Promise<void> {
    await this.db.run(CHANGE_CUSTOM_STYLES, customStyles, now);
  }

  /** Gives the join link a new code, so the old one joins no more. */
  async changeJoinCode(joinCode: string, now: string): Promise<void> {
    await this.db.run(CHANGE_JOIN_CODE, joinCode, now);
  }

  /** Whether someone is one of the workspace's active administrators, as they are when this asks. */
  async isAdministrator(userId: UserId): Promise<boolean> {
    return (await this.db.all(ACTIVE_ADMINISTRATOR, userId)).length > 0;
  }

  /**
   * Creates the workspace as ember-rust's first run does (crates/db/src/models/first_run.rs): the
   * account, its first administrator, open rooms that take in every active person, and the
   * administrator's session, who also joins every other open room. It adds `rooms` in order, all made
   * at once, so the first is the workspace's first room by its id, except any the workspace has an
   * open room of the same name for already, and answers the first, which opens. If there's an account
   * already, its singleton guard refuses the first statement, and so the whole batch.
   */
  async createWorkspace(
    account: NewAccount,
    administrator: NewPerson,
    rooms: Array<Pick<SharedRoom, "id" | "name">>,
    sessionId: string,
    tokenDigest: string,
    client: Client,
    now: string,
  ): Promise<SharedRoom> {
    const results = await this.db.batch([
      statement(`INSERT INTO accounts (id, name, join_code, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, account.id, account.name, account.joinCode, NEW_ACCOUNT_SETTINGS, now, now),
      statement(
        `INSERT INTO users (id, name, email_address, password_digest, role, created_at, updated_at) VALUES (?, ?, ?, ?, ${ADMINISTRATOR}, ?, ?)`,
        administrator.id,
        administrator.name,
        administrator.emailAddress,
        administrator.passwordDigest,
        now,
        now,
      ),
      ...rooms.flatMap((room) => [statement(INSERT_FIRST_ROOM, room.id, room.name, administrator.id, now), statement(GRANT_FIRST_ROOM, now, now, room.id)]),
      statement(GRANT_OPEN_ROOMS_TO_USER, administrator.id, now, now),
      statement(INSERT_SESSION, sessionId, administrator.id, tokenDigest, client.ip, client.userAgent, now, now, now),
      statement(OPEN_ROOM_NAMED, rooms[0]!.name),
    ]);
    return (results.at(-1) as SharedRoom[])[0]!;
  }

  /**
   * Adds someone who joined with the join link as a member, with their session, in every open room,
   * as ember-rust's `User::create` does (user.rs). If someone has their email address already, the
   * address's unique index refuses the first statement, and so the whole batch.
   */
  async createMember(person: NewPerson, sessionId: string, tokenDigest: string, client: Client, now: string): Promise<void> {
    await this.db.batch([
      statement(
        `INSERT INTO users (id, name, email_address, password_digest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        person.id,
        person.name,
        person.emailAddress,
        person.passwordDigest,
        now,
        now,
      ),
      statement(INSERT_SESSION, sessionId, person.id, tokenDigest, client.ip, client.userAgent, now, now, now),
      statement(GRANT_OPEN_ROOMS_TO_USER, person.id, now, now),
    ]);
  }

  /** Whether anyone has exactly this email address, whatever their status. */
  async hasEmailAddress(emailAddress: string): Promise<boolean> {
    return (await this.db.all(`SELECT 1 FROM users WHERE email_address = ?`, emailAddress)).length > 0;
  }

  /** Adds a guest, who has a name but no way to sign in again, together with their session and open rooms. */
  async createGuest(user: User, sessionId: string, tokenDigest: string, client: Client, now: string): Promise<void> {
    await this.db.batch([
      statement(`INSERT INTO users (id, name, guest, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`, user.id, user.name, now, now),
      statement(INSERT_SESSION, sessionId, user.id, tokenDigest, client.ip, client.userAgent, now, now, now),
      statement(GRANT_OPEN_ROOMS_TO_USER, user.id, now, now),
    ]);
  }

  /** The session a token's digest names, if its person is still active. */
  async findSession(tokenDigest: string): Promise<StoredSession | null> {
    const [row] = await this.db.all<SessionRow>(SESSION, tokenDigest);
    return row ? storedSession(row) : null;
  }

  /**
   * The active person whose email address is exactly `emailAddress`, as ember-rust matches it
   * (user.rs), and their password's digest. People without a password never sign in with one.
   */
  async passwordFor(emailAddress: string): Promise<{ userId: UserId; passwordDigest: string } | null> {
    const [row] = await this.db.all<{ id: UserId; password_digest: string }>(
      `SELECT id, password_digest FROM users WHERE email_address = ? AND status = ${ACTIVE} AND password_digest <> ''`,
      emailAddress,
    );
    return row ? { userId: row.id, passwordDigest: row.password_digest } : null;
  }

  /**
   * Starts a session for someone who signed in with the password `passwordDigest` is the digest of,
   * unless they've stopped being active since, or their password has been reset.
   */
  async startSession(userId: UserId, passwordDigest: string, sessionId: string, tokenDigest: string, client: Client, now: string): Promise<StoredSession | null> {
    const [, [row]] = (await this.db.batch([
      statement(INSERT_SESSION_IF_UNCHANGED, sessionId, tokenDigest, client.ip, client.userAgent, now, now, now, userId, passwordDigest),
      statement(SESSION, tokenDigest),
    ])) as [unknown[], SessionRow[]];
    return row ? storedSession(row) : null;
  }

  /**
   * Starts a session for someone who opened a sign-in link for them, unless they're no longer active,
   * or are a guest while `guests` says guests can't stay signed in.
   */
  async startTransferredSession(userId: UserId, guests: boolean, sessionId: string, tokenDigest: string, client: Client, now: string): Promise<StoredSession | null> {
    const [, [row]] = (await this.db.batch([
      statement(INSERT_TRANSFERRED_SESSION, sessionId, tokenDigest, client.ip, client.userAgent, now, now, now, userId, guests ? 1 : 0),
      statement(SESSION, tokenDigest),
    ])) as [unknown[], SessionRow[]];
    return row ? storedSession(row) : null;
  }

  /**
   * The first administrator, whom the sign-in page offers to email for help, as ember-rust's help
   * contact does (presenters/accounts.rs): whatever their status, so a deactivated one still shows.
   */
  async helpContact(): Promise<HelpContact | null> {
    const [row] = await this.db.all<{ name: string; email_address: string | null }>(
      `SELECT name, email_address FROM users WHERE role = ${ADMINISTRATOR} ORDER BY created_at, id LIMIT 1`,
    );
    return row ? { name: row.name, emailAddress: row.email_address ?? "" } : null;
  }

  /** Records that the session is in use from `client`, as ember-rust's `resume` does. */
  async touchSession(id: string, client: Client, now: string): Promise<void> {
    await this.db.run(
      `UPDATE sessions SET last_active_at = ?, ip_address = ?, user_agent = ?, updated_at = ? WHERE id = ?`,
      now,
      client.ip,
      client.userAgent,
      now,
      id,
    );
  }

  /**
   * Ends the session a token's digest names, and in the same transaction queues closing its sockets
   * with `code` in every room its person is in, due at `dueAt`. Answers whether it queued any.
   */
  async endSession(tokenDigest: string, code: CloseCode, dueAt: number): Promise<boolean> {
    const [queued] = await this.db.batch([
      statement(QUEUE_SESSION_REVOCATIONS, SESSION_TAG_PREFIX, code, dueAt, tokenDigest),
      statement(`DELETE FROM sessions WHERE token_digest = ?`, tokenDigest),
    ]);
    return queued!.length > 0;
  }

  /**
   * Whoever has exactly the email address `emailAddress`, whatever their status, as ember-rust's
   * `find_by_email_address` finds them (user.rs), and whether they're a bot.
   */
  async personWithEmailAddress(emailAddress: string): Promise<{ id: UserId; bot: boolean } | null> {
    const [row] = await this.db.all<{ id: UserId; role: number }>(`SELECT id, role FROM users WHERE email_address = ?`, emailAddress);
    return row ? { id: row.id, bot: ROLES[row.role] === "bot" } : null;
  }

  /**
   * Gives someone the password `passwordDigest` is the digest of, recording when, and ends all their
   * sessions, keeping their role and status, as ember-rust's `reset-password` does (admin.rs). In the
   * same transaction it queues closing each session's sockets with `code` in every room they're in, due
   * at `dueAt`, as signing out does. Answers whether it queued any.
   */
  async resetPassword(userId: UserId, passwordDigest: string, code: CloseCode, dueAt: number, now: string): Promise<boolean> {
    const [queued] = await this.db.batch([
      statement(QUEUE_PERSON_SESSION_REVOCATIONS, SESSION_TAG_PREFIX, code, dueAt, userId),
      statement(`UPDATE users SET password_digest = ?, updated_at = ? WHERE id = ?`, passwordDigest, now, userId),
      statement(`DELETE FROM sessions WHERE user_id = ?`, userId),
    ]);
    return queued!.length > 0;
  }

  /**
   * Removes someone from the workspace, as ember-rust's `User#deactivate` does (user.rs), in one
   * transaction: queues closing each of their sessions' sockets with `code` in every room they're in,
   * DMs included, due at `dueAt`, takes them out of every room but their DMs, ends their sessions, and
   * marks them removed, recording when, with `-deactivated-<uuid>` before each "@" of their email
   * address. Their messages, boosts, DMs, role and avatar stay. Answers whether it queued any.
   */
  async removePerson(userId: UserId, uuid: string, code: CloseCode, dueAt: number, now: string): Promise<boolean> {
    const [queued] = await this.db.batch([
      // Before they leave the rooms it finds their sockets in.
      statement(QUEUE_PERSON_SESSION_REVOCATIONS, SESSION_TAG_PREFIX, code, dueAt, userId),
      statement(LEAVE_SHARED_ROOMS, userId),
      statement(`DELETE FROM sessions WHERE user_id = ?`, userId),
      statement(DEACTIVATE, `-deactivated-${uuid}@`, now, userId),
    ]);
    return queued!.length > 0;
  }

  /**
   * Bans someone, as ember-rust's `User#ban` does (user.rs), in one transaction: queues closing each of
   * their sessions' sockets with `code` in every room they're in, due at `dueAt`, blocks each of
   * `ipAddresses`, ends their sessions, marks them banned, recording when, unless they were already,
   * and queues deleting their messages in every room they can have written in, due then too. It queues
   * having every room tell the sockets from those addresses to reconnect, due then as well, so they
   * come back able only to read. Their memberships, role and avatar stay. Answers whether it queued
   * anything.
   */
  async banPerson(userId: UserId, ipAddresses: string[], code: CloseCode, reconnect: CloseCode, dueAt: number, now: string): Promise<boolean> {
    const [revocations, , reconnections, , , purges] = (await this.db.batch([
      // Before their sessions go, which it finds their sockets by.
      statement(QUEUE_PERSON_SESSION_REVOCATIONS, SESSION_TAG_PREFIX, code, dueAt, userId),
      statement(`INSERT INTO bans (user_id, ip_address, created_at, updated_at) SELECT ?, value, ?, ? FROM json_each(?)`, userId, now, now, JSON.stringify(ipAddresses)),
      statement(QUEUE_ADDRESS_REVOCATIONS, ADDRESS_TAG_PREFIX, reconnect, dueAt, JSON.stringify(ipAddresses)),
      statement(`DELETE FROM sessions WHERE user_id = ?`, userId),
      statement(`UPDATE users SET status = ${BANNED}, updated_at = ? WHERE id = ? AND status <> ${BANNED}`, now, userId),
      statement(QUEUE_PURGES, userId, dueAt),
    ])) as unknown[][];
    return revocations!.length > 0 || reconnections!.length > 0 || purges!.length > 0;
  }

  /**
   * Lifts someone's ban, as ember-rust's `User#unban` does (user.rs): unblocks their IP addresses and
   * makes them active, recording when, unless they were already, whatever their status was. The rooms
   * yet to delete their messages delete only those written by then, as ember-rust's job finds only
   * what they'd written when it runs, at once (jobs.rs). It queues having every room tell the sockets
   * from those addresses to reconnect, due at `dueAt`, so they come back able to change things again,
   * unless another ban blocks them too. Answers whether it queued anything.
   */
  async unbanPerson(userId: UserId, reconnect: CloseCode, dueAt: number, now: string): Promise<boolean> {
    const [reconnections] = (await this.db.batch([
      // Before the bans go, which it finds the addresses by.
      statement(QUEUE_UNBANNED_ADDRESS_REVOCATIONS, ADDRESS_TAG_PREFIX, reconnect, dueAt, userId),
      statement(`DELETE FROM bans WHERE user_id = ?`, userId),
      statement(`UPDATE users SET status = ${ACTIVE}, updated_at = ? WHERE id = ? AND status <> ${ACTIVE}`, now, userId),
      // The outbox holds a row only until its room answers, so this reads it all rather than keep an index.
      statement(`UPDATE pending_purges SET lifted_at = ? WHERE user_id = ? AND lifted_at IS NULL`, now, userId),
    ])) as unknown[][];
    return reconnections!.length > 0;
  }

  /** Every IP address a ban blocks. */
  async bannedAddresses(): Promise<string[]> {
    return (await this.db.all<{ ip_address: string }>(`SELECT DISTINCT ip_address FROM bans`)).map((row) => row.ip_address);
  }

  /** The IP addresses recorded on someone's sessions, which banning them blocks. */
  async sessionIpAddresses(userId: UserId): Promise<string[]> {
    return (await this.db.all<{ ip_address: string }>(SESSION_IP_ADDRESSES, userId)).map((row) => row.ip_address);
  }

  /** Up to `limit` of the purges due by `now` whose rooms have no sockets left to close, those due longest first. */
  async duePurges(now: number, limit: number): Promise<PendingPurge[]> {
    return this.db.all<PendingPurge>(DUE_PURGES, now, limit);
  }

  /**
   * Forgets the purges `finished` names, makes the ones `unfinished` names due again at `now`, and puts
   * off the ones `failed` names, each for twice as long as the time before, up to the longest wait. It
   * never gives one up, which would leave a banned person's messages up.
   */
  async settlePurges(finished: number[], unfinished: number[], failed: number[], now: number): Promise<void> {
    await this.db.batch([
      statement(`DELETE FROM pending_purges WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(finished)),
      statement(`UPDATE pending_purges SET attempts = 0, due_at = ? WHERE id IN (SELECT value FROM json_each(?))`, now, JSON.stringify(unfinished)),
      // As a revocation's wait, which has stopped doubling by its last try.
      statement(
        `UPDATE pending_purges SET attempts = attempts + 1, due_at = ? + min(?, ? << min(attempts, ?)) WHERE id IN (SELECT value FROM json_each(?))`,
        now,
        LONGEST_RETRY_MS,
        FIRST_RETRY_MS,
        DELIVERY_ATTEMPTS,
        JSON.stringify(failed),
      ),
    ]);
  }

  /** Up to `limit` of the revocations due by `now`, those due longest first. */
  async dueRevocations(now: number, limit: number): Promise<PendingRevocation[]> {
    return this.db.all<PendingRevocation>(DUE_REVOCATIONS, now, limit);
  }

  /**
   * Forgets the revocations `delivered` names, and puts off the ones `failed` names, each for twice as
   * long as the time before, up to the longest wait. Gives up on any that have failed too often, except
   * a room's deletion, and answers the ones it gave up.
   */
  async settleRevocations(delivered: number[], failed: number[], now: number): Promise<PendingRevocation[]> {
    const [, abandoned] = (await this.db.batch([
      statement(`DELETE FROM pending_revocations WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(delivered)),
      statement(
        `DELETE FROM pending_revocations WHERE id IN (SELECT value FROM json_each(?)) AND attempts + 1 >= ? AND tag <> ? RETURNING id, room_id AS roomId, tag, code`,
        JSON.stringify(failed),
        DELIVERY_ATTEMPTS,
        EVERYONE,
      ),
      // The wait has stopped doubling by the time the others give up. A deletion goes on failing, and
      // shifting the first wait by all its failures would soon overflow, making the wait negative.
      statement(
        `UPDATE pending_revocations SET attempts = attempts + 1, due_at = ? + min(?, ? << min(attempts, ?)) WHERE id IN (SELECT value FROM json_each(?))`,
        now,
        LONGEST_RETRY_MS,
        FIRST_RETRY_MS,
        DELIVERY_ATTEMPTS,
        JSON.stringify(failed),
      ),
    ])) as [unknown[], PendingRevocation[], unknown[]];
    return abandoned;
  }

  /**
   * When the outbox's next revocation or purge is due, if any is waiting, leaving out the purges waiting
   * on their rooms' revocations, which are due no sooner.
   */
  async nextDeliveryDue(): Promise<number | null> {
    const [row] = await this.db.all<{ revocation: number | null; purge: number | null }>(
      `SELECT (SELECT min(due_at) FROM pending_revocations) AS revocation, (${NEXT_PURGE_DUE}) AS purge`,
    );
    const due = [row?.revocation, row?.purge].filter((time) => typeof time === "number");
    return due.length > 0 ? Math.min(...due) : null;
  }

  /**
   * The rooms someone is in, with their unread marks and the people in their DMs, the ones they've
   * starred, the people their sidebar suggests for DMs, and the workspace's first room, if there is one
   * yet.
   */
  async roomsFor(userId: UserId): Promise<{ rooms: SidebarRoom[]; favorites: Favorites; suggestions: User[]; originalRoomId: RoomId | null }> {
    const [rows, [original], starred, [user], members, suggested] = (await this.db.batch([
      statement(ROOMS_FOR_USER, userId),
      statement(ORIGINAL_ROOM),
      statement(FAVORITES_FOR_USER, userId),
      statement(FAVORITES_VERSION, userId),
      statement(DIRECT_MEMBERS_FOR_USER, userId),
      statement(SUGGESTED_FOR_USER, userId),
    ])) as [SidebarRow[], Array<{ id: RoomId }>, Array<{ room_id: RoomId }>, Array<{ version: number }>, DirectMemberRow[], User[]];
    const membersByRoom = Map.groupBy(members, (member) => member.room_id);
    const peopleInDirects = new Set(members.map((member) => member.id)).size;
    return {
      rooms: rows.map((row) => sidebarRoom(row, membersByRoom.get(row.id))),
      favorites: { rooms: starred.map((row) => row.room_id), version: user?.version ?? 0 },
      suggestions: suggested.slice(0, suggestedCount(peopleInDirects)),
      originalRoomId: original?.id ?? null,
    };
  }

  /**
   * Puts someone's stars in the order `roomIds` lists them, as dragging one does in ember-rust's sidebar
   * (`set_favorite_order`, account.rs), in one transaction that also drops their stars on rooms they
   * can't star any more. Answers their stars as they are then, or null, having changed nothing, when
   * `roomIds` isn't exactly the rooms they've starred and can star.
   */
  async setFavoriteOrder(userId: UserId, roomIds: RoomId[]): Promise<Favorites | null> {
    const listed = JSON.stringify(roomIds);
    const [, , [saved], starred] = (await this.db.batch([
      statement(REORDER_STARS, userId, listed),
      statement(AFTER_REORDER.drop, userId, listed),
      statement(AFTER_REORDER.count, userId, listed),
      statement(FAVORITES_FOR_USER, userId),
    ])) as [unknown[], unknown[], Array<{ version: number }>, Array<{ room_id: RoomId }>];
    return saved ? { rooms: starred.map((row) => row.room_id), version: saved.version } : null;
  }

  /**
   * Stars room `roomId` for someone, after their other stars, or unstars it, as ember-rust's
   * `set_channel_favorite` does (account.rs), in one transaction that also drops their stars on rooms
   * they can't star any more. Answers their stars as they are then, or null, having changed nothing,
   * when they can't star the room, a DM or one they've hidden or aren't in, or have as many stars as
   * they can have.
   */
  async setFavorite(userId: UserId, roomId: RoomId, favorite: boolean): Promise<Favorites | null> {
    const after = favorite ? AFTER_STAR : AFTER_UNSTAR;
    const [, , [saved], starred] = (await this.db.batch([
      statement(favorite ? STAR : UNSTAR, userId, roomId),
      statement(after.drop, userId, roomId),
      statement(after.count, userId, roomId),
      statement(FAVORITES_FOR_USER, userId),
    ])) as [unknown[], unknown[], Array<{ version: number }>, Array<{ room_id: RoomId }>];
    return saved ? { rooms: starred.map((row) => row.room_id), version: saved.version } : null;
  }

  /**
   * Applies `events` from room `roomId`'s log, in order and in one transaction, with `viewerIds`, who
   * is viewing the room: a message marks it unread for the members who aren't, and a read clears the
   * reader's mark. The latest message also records when the room was last active. Those the Workspace
   * has applied before change nothing. Answers whose marks changed, and whether each is now unread, and,
   * when a message has come in a DM, when the latest did and everyone in the DM, to tell.
   */
  async applyRoomEvents(roomId: RoomId, events: RoomEvent[], viewerIds: UserId[]): Promise<AppliedEvents> {
    const viewers = JSON.stringify(viewerIds);
    const last = events.at(-1)!.seq;
    const message = events.findLast((event) => event.kind === "message");
    // When the latest message came, which a clock behind can make earlier than one logged before it.
    const messageAt = message && events.reduce((latest, { kind, at }) => (kind === "message" && at > latest ? at : latest), message.at);
    const results = (await this.db.batch([
      ...events.map(({ seq, kind, userId, at }) =>
        kind === "message" ? statement(MARK_UNREAD, at, roomId, userId, viewers, seq) : statement(MARK_READ, roomId, userId, seq),
      ),
      ...(message ? [statement(TOLD_OF_DIRECT_MESSAGE, roomId, message.seq), statement(APPLIED_WITH_MESSAGE, last, roomId, messageAt!)] : [statement(APPLIED, last, roomId)]),
    ])) as Array<Array<{ user_id: UserId }>>;
    const marks = new Map<UserId, boolean>();
    events.forEach(({ kind }, i) => {
      for (const { user_id } of results[i]!) marks.set(user_id, kind === "message");
    });
    const told = message ? userIdsOf(results[events.length]!) : [];
    return { marks, active: told.length > 0 ? { at: messageAt!, userIds: told } : null };
  }

  async isMember(roomId: RoomId, userId: UserId): Promise<boolean> {
    return (await this.db.all(MEMBERSHIP, roomId, userId)).length > 0;
  }

  /** Whether `userId` is in room `roomId`, and whether a ban blocks `ipAddress`, if there is one. */
  async roomAccess(roomId: RoomId, userId: UserId, ipAddress: string | null): Promise<{ member: boolean; banned: boolean }> {
    const [row] = await this.db.all<{ member: number; banned: number }>(ROOM_ACCESS, roomId, userId, ipAddress);
    return { member: row!.member === 1, banned: row!.banned === 1 };
  }

  /** Everyone active, by name. */
  async activePeople(): Promise<User[]> {
    return this.db.all<User>(ACTIVE_PEOPLE);
  }

  /** The people with `ids` who exist, active or not. */
  async peopleWithIds(ids: UserId[]): Promise<User[]> {
    return this.db.all<User>(PEOPLE_WITH_IDS, JSON.stringify(ids));
  }

  /**
   * The first page of the active people whose names contain `query`, by name: room `roomId`'s members,
   * or anyone's when it's null.
   */
  async mentionable(query: string, roomId: RoomId | null): Promise<DirectoryEntry[]> {
    const rows = roomId === null ? await this.db.all<DirectoryRow>(MENTIONABLE_PEOPLE, query) : await this.db.all<DirectoryRow>(MENTIONABLE_MEMBERS, query, roomId);
    return rows.map(directoryEntry);
  }

  /** Everyone, whatever their status, for the people directory. */
  async directory(): Promise<DirectoryEntry[]> {
    return (await this.db.all<DirectoryRow>(DIRECTORY)).map(directoryEntry);
  }

  /** Someone as the people directory lists them, whatever their status, or null if nobody has id `userId`. */
  async person(userId: UserId): Promise<DirectoryEntry | null> {
    const [row] = await this.db.all<DirectoryRow>(PERSON, userId);
    return row ? directoryEntry(row) : null;
  }

  /** Someone active, as the people directory lists them, or null unless `userId` is someone active. */
  async activePerson(userId: UserId): Promise<DirectoryEntry | null> {
    const [row] = await this.db.all<DirectoryRow>(ACTIVE_PERSON, userId);
    return row ? directoryEntry(row) : null;
  }

  /** Gives someone `role`, recording when. */
  async changeRole(userId: UserId, role: PersonRole, now: string): Promise<void> {
    await this.db.run(CHANGE_ROLE, ROLES.indexOf(role), now, userId);
  }

  /** Someone with their email address, whatever their status, or null if nobody has id `userId`. */
  async personWithProfile(userId: UserId): Promise<ProfileEntry | null> {
    const [row] = await this.db.all<DirectoryRow & { email_address: string | null }>(PERSON_WITH_PROFILE, userId);
    return row ? { ...directoryEntry(row), emailAddress: row.email_address } : null;
  }

  /** Saves someone's profile, and a new password when `passwordDigest` is one's, recording when. */
  async changeProfile(userId: UserId, { name, emailAddress, bio, passwordDigest }: ProfileChange, now: string): Promise<void> {
    await this.db.run(CHANGE_PROFILE, name, emailAddress, bio, passwordDigest, now, userId);
  }

  /** What the avatar of whoever has id `userId` is drawn from, whatever their status, or null if nobody does. */
  async avatarOwner(userId: UserId): Promise<AvatarOwner | null> {
    const [row] = await this.db.all<{ name: string; role: number }>(`SELECT name, role FROM users WHERE id = ?`, userId);
    return row ? { name: row.name, bot: ROLES[row.role] === "bot" } : null;
  }

  /** Room `roomId`, unless it's a DM or someone isn't in it, and whether they can change it. */
  async roomToChange(roomId: RoomId, userId: UserId): Promise<{ room: SharedRoom; canAdminister: boolean } | null> {
    const [row] = await this.db.all<RoomToChangeRow>(ROOM_TO_CHANGE, roomId, userId);
    return row ? roomToChange(row) : null;
  }

  /** The same, with everyone active and whether they're in the room, read together. */
  async roomSettings(roomId: RoomId, userId: UserId): Promise<RoomSettings | null> {
    const [[row], people] = (await this.db.batch([statement(ROOM_TO_CHANGE, roomId, userId), statement(ACTIVE_PEOPLE_IN_ROOM, roomId)])) as [
      RoomToChangeRow[],
      Array<User & { member: number }>,
    ];
    return row ? { ...roomToChange(row), people: people.map((person) => ({ ...person, member: person.member === 1 })) } : null;
  }

  /**
   * Makes `changes` to a room in one transaction, where ember-rust takes two (closeds.rs): renames
   * it, and makes it open to everyone active, or private to just the people `memberIds` names, taking
   * anyone else out and queueing closing their sockets there with `code`, due at `dueAt`. Answers what
   * it changed, and who's in the room then.
   */
  async changeRoom(roomId: RoomId, changes: RoomChanges, code: CloseCode, dueAt: number, now: string): Promise<SavedRoomChange> {
    const update = statement(UPDATE_ROOM, changes.name ?? null, changes.kind ?? null, changes.icon ?? null, now, roomId);
    const members = statement(ROOM_MEMBERS, roomId);
    if (changes.kind === "open") {
      const [updated, added, after] = (await this.db.batch([update, statement(GRANT_ROOM_TO_ACTIVE_USERS, roomId, now, now), members])) as UserIdRow[][];
      return { roomChanged: updated!.length > 0, memberIds: userIdsOf(after!), addedIds: userIdsOf(added!), removedIds: [] };
    }
    if (changes.kind !== "closed") {
      const [updated, after] = (await this.db.batch([update, members])) as UserIdRow[][];
      return { roomChanged: updated!.length > 0, memberIds: userIdsOf(after!), addedIds: [], removedIds: [] };
    }
    const memberIds = JSON.stringify(changes.memberIds);
    const [updated, added, , removed, after] = (await this.db.batch([
      update,
      statement(GRANT_ROOM_TO_USERS, roomId, now, now, memberIds),
      statement(QUEUE_MEMBER_REVOCATIONS, code, dueAt, roomId, memberIds),
      statement(REVOKE_ROOM_FROM_OTHERS, roomId, memberIds),
      members,
    ])) as UserIdRow[][];
    return { roomChanged: updated!.length > 0, memberIds: userIdsOf(after!), addedIds: userIdsOf(added!), removedIds: userIdsOf(removed!) };
  }

  /** The kind of room `roomId`, DMs included, and whether someone can change it, unless they aren't in it. */
  async roomToDelete(roomId: RoomId, userId: UserId): Promise<{ kind: SidebarRoom["kind"]; canAdminister: boolean } | null> {
    const [row] = await this.db.all<{ kind: SidebarRoom["kind"]; can_administer: number }>(ROOM_TO_DELETE, roomId, userId);
    return row ? { kind: row.kind, canAdminister: row.can_administer === 1 } : null;
  }

  /**
   * Deletes a room and who is in it, as ember-rust's `Room::destroy` does (room.rs), and in the same
   * transaction queues closing every socket in it with `code`, due at `dueAt`, in place of whatever
   * else the outbox had for it. The room's own object deletes its messages when that reaches it. The
   * room is remembered as deleted, so registering `LEGACY_ROOMS` doesn't bring it back. Answers who was
   * in it.
   */
  async deleteRoom(roomId: RoomId, code: CloseCode, dueAt: number, now: string): Promise<UserId[]> {
    const [, , members] = (await this.db.batch([
      // Queued before the rest go, so it takes an id none of them had: SQLite numbers a row after the
      // largest id left, and the alarm settles what it delivered by id, so taking the id of one it's
      // delivering now would settle the deletion with it.
      statement(`INSERT INTO pending_revocations (room_id, tag, code, due_at) VALUES (?, ?, ?, ?)`, roomId, EVERYONE, code, dueAt),
      statement(`DELETE FROM pending_revocations WHERE room_id = ? AND tag <> ?`, roomId, EVERYONE),
      statement(`DELETE FROM memberships WHERE room_id = ? RETURNING user_id`, roomId),
      // Its messages all go, a banned person's with them.
      statement(`DELETE FROM pending_purges WHERE room_id = ?`, roomId),
      statement(`DELETE FROM rooms WHERE id = ?`, roomId),
      statement(`INSERT INTO deleted_rooms (id, deleted_at) VALUES (?, ?) ON CONFLICT DO NOTHING`, roomId, now),
    ])) as UserIdRow[][];
    return userIdsOf(members!);
  }

  /**
   * Adds a room and its people: everyone active for an open room, or just `memberIds` for a closed one.
   * Answers who's in it.
   */
  async createRoom(room: SharedRoom, creatorId: UserId, memberIds: UserId[] | null, now: string): Promise<UserId[]> {
    const [, members] = (await this.db.batch([
      statement(
        `INSERT INTO rooms (id, kind, name, icon, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        room.id,
        room.kind,
        room.name,
        room.icon,
        creatorId,
        now,
        now,
      ),
      memberIds ? statement(GRANT_ROOM_TO_USERS, room.id, now, now, JSON.stringify(memberIds)) : statement(GRANT_ROOM_TO_ACTIVE_USERS, room.id, now, now),
    ])) as UserIdRow[][];
    return userIdsOf(members!);
  }

  /**
   * The DM whose people are exactly the ones `memberIds` names, who all exist, adding it as `roomId`,
   * made by `creatorId`, if they have none, in one transaction, as ember-rust's
   * `find_or_create_direct_for` does (room.rs). Answers it, and whether it added it.
   */
  async startDirect(roomId: RoomId, creatorId: UserId, memberIds: UserId[], now: string): Promise<{ room: DirectRoom; started: boolean }> {
    const key = directKey(memberIds);
    const [added, , members] = (await this.db.batch([
      statement(INSERT_DIRECT, roomId, creatorId, key, now),
      statement(GRANT_DIRECT, roomId, now, key),
      statement(DIRECT_WITH_KEY, key),
    ])) as [unknown[], unknown[], KeyedDirectMemberRow[]];
    const [{ room_id: id, active_at: activeAt }] = members as [KeyedDirectMemberRow];
    return { room: { id, kind: "direct", members: membersOf(members), activeAt }, started: added!.length > 0 };
  }

  /** Of the rooms `ids` names, the ones that aren't registered yet and were never deleted. The ids go as one JSON value. */
  async unregisteredRooms(ids: RoomId[]): Promise<RoomId[]> {
    const rows = await this.db.all<{ id: RoomId }>(UNREGISTERED_ROOMS, JSON.stringify(ids));
    return rows.map((row) => row.id);
  }

  /**
   * Registers a room from before the Workspace kept a list as an open room everyone is in, named for
   * its old address, and keeps the people who wrote or reacted in it as deactivated guests.
   */
  async registerLegacyRoom(id: RoomId, authors: User[], now: string): Promise<void> {
    await this.db.batch([
      statement(INSERT_FORMER_GUESTS, now, now, JSON.stringify(authors)),
      statement(`INSERT INTO rooms (id, kind, name, created_at, updated_at) VALUES (?, 'open', ?, ?, ?) ON CONFLICT DO NOTHING`, id, id, now, now),
      statement(GRANT_ROOM_TO_ACTIVE_USERS, id, now, now),
    ]);
  }
}
