import type { CloseCode, HelpContact, PersonRole, Role, Room, RoomChanges, RoomId, RoomSettings, SidebarRoom, User, UserId, UserStatus } from "@ember/protocol";
import { statement, type Db } from "./db";
import { EVERYONE, SESSION_TAG_PREFIX, type Revocation } from "./revocations";
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
/** ember-rust's role for the people who run the workspace (user.rs). */
const ADMINISTRATOR = 1;
/** ember-rust's roles and statuses (user.rs), each at the number it stores. */
const ROLES: readonly Role[] = ["member", "administrator", "bot"];
const STATUSES: readonly UserStatus[] = ["active", "deactivated", "banned"];

/** The settings ember-rust writes out for a new account (crates/db/src/models/account.rs). */
const NEW_ACCOUNT_SETTINGS = JSON.stringify({ restrict_room_creation_to_administrators: false });

/** The workspace's account, with the code in its join link, which only the people in it see. */
export interface JoinableAccount {
  name: string;
  joinCode: string;
}

/** The account first run creates. */
export interface NewAccount extends JoinableAccount {
  id: string;
}

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

/** What someone's avatar is drawn from. */
export interface AvatarOwner {
  name: string;
  bot: boolean;
}

/** A revocation the Workspace has yet to deliver to its room. */
export interface PendingRevocation extends Revocation {
  id: number;
  roomId: RoomId;
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

/** The same, for someone who signed in, unless they've stopped being active since. */
const INSERT_SESSION_IF_ACTIVE = `INSERT INTO sessions (id, user_id, token_digest, ip_address, user_agent, last_active_at, created_at, updated_at)
  SELECT ?, id, ?, ?, ?, ?, ?, ? FROM users WHERE id = ? AND status = ${ACTIVE}`;

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

interface RoomToChangeRow extends Room {
  can_administer: number;
}

const roomToChange = (row: RoomToChangeRow) => ({ room: { id: row.id, kind: row.kind, name: row.name, icon: row.icon }, canAdminister: row.can_administer === 1 });

const storedSession = (row: SessionRow): StoredSession => ({
  id: row.session_id,
  user: { id: row.user_id, name: row.name },
  administrator: row.administrator === 1,
  guest: row.guest === 1,
  lastActiveAt: Date.parse(row.last_active_at),
});

/**
 * The rooms someone is in, with whether each is marked unread for them, in the order they were made,
 * for the app to go home to the oldest and to `/rooms` to the newest, as ember-rust's
 * `original_for_user` and `last_for_user` find them (room.rs). Rooms from before the Workspace kept a
 * list (`LEGACY_ROOMS`) have ids that don't sort by time, so they go by when they were listed.
 */
export const ROOMS_FOR_USER = `SELECT rooms.id, rooms.kind, rooms.name, rooms.icon, memberships.unread_at IS NOT NULL AS unread
  FROM memberships JOIN rooms ON rooms.id = memberships.room_id
  WHERE memberships.user_id = ? ORDER BY rooms.created_at, rooms.id`;

/**
 * The workspace's first room, where the welcome card shows, as ember-rust's `Room::original` finds it
 * (room.rs). Ids sort in the order rooms were made, so the primary key's index finds it at once, and
 * rooms from before the Workspace kept a list (`LEGACY_ROOMS`) have no creator and are passed over.
 */
export const ORIGINAL_ROOM = `SELECT id FROM rooms WHERE creator_id IS NOT NULL ORDER BY id LIMIT 1`;

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

/** Revocations due by a time, those due longest first, up to a number of them. */
export const DUE_REVOCATIONS = `SELECT id, room_id AS roomId, tag, code FROM pending_revocations WHERE due_at <= ? ORDER BY due_at, id LIMIT ?`;

/** How long the outbox waits to deliver a revocation again after it fails, doubling each time up to the longest wait. */
const FIRST_RETRY_MS = 1_000;
const LONGEST_RETRY_MS = 5 * 60 * 1000;
/**
 * How many times the outbox tries to deliver a revocation before giving up: over 8 minutes of tries.
 * It never gives up on a room's deletion, whose messages would otherwise stay stored with nothing left
 * to delete them, but tries it at the longest wait until it's delivered.
 */
const DELIVERY_ATTEMPTS = 10;

/** Whether someone is in a room, asked on every room socket's upgrade. */
export const MEMBERSHIP = `SELECT 1 FROM memberships WHERE room_id = ? AND user_id = ?`;

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

/** Whether someone is one of the workspace's active administrators. */
export const ACTIVE_ADMINISTRATOR = `SELECT 1 FROM users WHERE id = ? AND role = ${ADMINISTRATOR} AND status = ${ACTIVE}`;

/**
 * Renames the workspace and records when, unless it has that name already, as ember-rust's
 * `Account::update` changes only what differs (account.rs).
 */
const RENAME_ACCOUNT = `UPDATE accounts SET name = ?1, updated_at = ?2 WHERE name IS NOT ?1`;

/** Gives the join link a new code and records when, as ember-rust's `reset_join_code` does (account.rs). */
const CHANGE_JOIN_CODE = `UPDATE accounts SET join_code = ?, updated_at = ?`;

/** Everyone active, by name, as ember-rust lists them for New room (`User.active.ordered`, user.rs). */
export const ACTIVE_PEOPLE = `SELECT id, name FROM users WHERE status = ${ACTIVE} ORDER BY lower(name), id`;

/** Everyone, for the people directory: removed and banned people too, whose messages stay. */
const DIRECTORY = `SELECT id, name, bio, role, status, updated_at FROM users ORDER BY id`;

/** Someone active, as the directory lists them, as ember-rust finds whom to change (`User.active.find`, accounts/users.rs). */
const ACTIVE_PERSON = `SELECT id, name, bio, role, status, updated_at FROM users WHERE id = ? AND status = ${ACTIVE}`;

/** Gives someone a role and records when. */
const CHANGE_ROLE = `UPDATE users SET role = ?, updated_at = ? WHERE id = ?`;

/** The same, with whether each is in a room, for its settings. */
export const ACTIVE_PEOPLE_IN_ROOM = `SELECT users.id, users.name, memberships.user_id IS NOT NULL AS member
  FROM users LEFT JOIN memberships ON memberships.room_id = ? AND memberships.user_id = users.id
  WHERE users.status = ${ACTIVE} ORDER BY lower(users.name), users.id`;

/**
 * A room someone is in, unless it's a DM, and whether they can change it: administrators and the
 * room's creator can, as ember-rust's `can_administer` says (user.rs).
 */
export const ROOM_TO_CHANGE = `SELECT rooms.id, rooms.kind, rooms.name, rooms.icon, (users.role = ${ADMINISTRATOR} OR rooms.creator_id = users.id) AS can_administer
  FROM memberships JOIN rooms ON rooms.id = memberships.room_id JOIN users ON users.id = memberships.user_id
  WHERE memberships.room_id = ? AND memberships.user_id = ? AND rooms.kind <> 'direct'`;

// Memberships are granted with one statement for everyone, rather than a row at a time, since both
// backends bind at most 100 values a statement. A WHERE clause comes before each ON CONFLICT, which
// SQLite would otherwise read as part of a join.

/** Puts someone new in every open room, as ember-rust does for every person and bot who joins (user.rs). */
const GRANT_OPEN_ROOMS_TO_USER = `INSERT INTO memberships (room_id, user_id, created_at, updated_at)
  SELECT id, ?, ?, ? FROM rooms WHERE kind = 'open' ON CONFLICT DO NOTHING`;

/** Puts every active person in an open room, keeping the memberships they already have (room.rs). */
const GRANT_ROOM_TO_ACTIVE_USERS = `INSERT INTO memberships (room_id, user_id, created_at, updated_at)
  SELECT ?, id, ?, ? FROM users WHERE status = ${ACTIVE} ON CONFLICT DO NOTHING`;

/** Puts the people a JSON list names in a room, whatever their status, as ember-rust's private rooms do. */
const GRANT_ROOM_TO_USERS = `INSERT INTO memberships (room_id, user_id, created_at, updated_at)
  SELECT ?, id, ?, ? FROM users WHERE id IN (SELECT value FROM json_each(?)) ON CONFLICT DO NOTHING`;

/** Takes everyone but the people a JSON list names out of a room. */
export const REVOKE_ROOM_FROM_OTHERS = `DELETE FROM memberships WHERE room_id = ? AND user_id NOT IN (SELECT value FROM json_each(?))`;

/**
 * Renames a room, changes its kind and sets its icon, keeping whichever is null as it is, and records
 * when, unless nothing changes, as ember-rust's `Room::update` does (room.rs). An icon of "" is the
 * default `#`, stored as null.
 */
const UPDATE_ROOM = `UPDATE rooms SET name = coalesce(?1, name), kind = coalesce(?2, kind),
    icon = CASE WHEN ?3 IS NULL THEN icon ELSE nullif(?3, '') END, updated_at = ?4
  WHERE id = ?5 AND (name IS NOT coalesce(?1, name) OR kind IS NOT coalesce(?2, kind)
    OR icon IS NOT CASE WHEN ?3 IS NULL THEN icon ELSE nullif(?3, '') END)`;

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
    const [row] = await this.db.all<{ name: string; join_code: string }>(`SELECT name, join_code FROM accounts`);
    return row ? { name: row.name, joinCode: row.join_code } : null;
  }

  /** Renames the workspace. */
  async renameAccount(name: string, now: string): Promise<void> {
    await this.db.run(RENAME_ACCOUNT, name, now);
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
   * account, its first administrator, an open room that takes in every active person, and the
   * administrator's session, who also joins every other open room. If there's an account already,
   * its singleton guard refuses the first statement, and so the whole batch.
   */
  async createWorkspace(
    account: NewAccount,
    administrator: NewPerson,
    room: Pick<Room, "id" | "name">,
    sessionId: string,
    tokenDigest: string,
    client: Client,
    now: string,
  ): Promise<void> {
    await this.db.batch([
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
      statement(`INSERT INTO rooms (id, kind, name, creator_id, created_at, updated_at) VALUES (?, 'open', ?, ?, ?, ?)`, room.id, room.name, administrator.id, now, now),
      statement(GRANT_ROOM_TO_ACTIVE_USERS, room.id, now, now),
      statement(GRANT_OPEN_ROOMS_TO_USER, administrator.id, now, now),
      statement(INSERT_SESSION, sessionId, administrator.id, tokenDigest, client.ip, client.userAgent, now, now, now),
    ]);
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

  /** Starts a session for someone who signed in, unless they've stopped being active since. */
  async startSession(userId: UserId, sessionId: string, tokenDigest: string, client: Client, now: string): Promise<StoredSession | null> {
    const [, [row]] = (await this.db.batch([
      statement(INSERT_SESSION_IF_ACTIVE, sessionId, tokenDigest, client.ip, client.userAgent, now, now, now, userId),
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

  /** When the next revocation is due, if any is waiting. */
  async nextRevocationDue(): Promise<number | null> {
    const [row] = await this.db.all<{ due_at: number | null }>(`SELECT min(due_at) AS due_at FROM pending_revocations`);
    return row?.due_at ?? null;
  }

  /** The rooms someone is in, with their unread marks, and the workspace's first room, if there is one yet. */
  async roomsFor(userId: UserId): Promise<{ rooms: SidebarRoom[]; originalRoomId: RoomId | null }> {
    const [rows, [original]] = (await this.db.batch([statement(ROOMS_FOR_USER, userId), statement(ORIGINAL_ROOM)])) as [
      Array<Room & { unread: number }>,
      Array<{ id: RoomId }>,
    ];
    return { rooms: rows.map((row) => ({ ...row, unread: row.unread === 1 })), originalRoomId: original?.id ?? null };
  }

  /**
   * Applies `events` from room `roomId`'s log, in order and in one transaction, with `viewerIds`, who
   * is viewing the room: a message marks it unread for the members who aren't, and a read clears the
   * reader's mark. Those the Workspace has applied before change nothing. Answers whose marks changed,
   * and whether each is now unread.
   */
  async applyRoomEvents(roomId: RoomId, events: RoomEvent[], viewerIds: UserId[]): Promise<Map<UserId, boolean>> {
    const viewers = JSON.stringify(viewerIds);
    const last = events.at(-1)!.seq;
    const results = (await this.db.batch([
      ...events.map(({ seq, kind, userId, at }) =>
        kind === "message" ? statement(MARK_UNREAD, at, roomId, userId, viewers, seq) : statement(MARK_READ, roomId, userId, seq),
      ),
      statement(`UPDATE rooms SET applied_seq = ? WHERE id = ? AND applied_seq < ?`, last, roomId, last),
    ])) as Array<Array<{ user_id: UserId }>>;
    const marks = new Map<UserId, boolean>();
    events.forEach(({ kind }, i) => {
      for (const { user_id } of results[i]!) marks.set(user_id, kind === "message");
    });
    return marks;
  }

  async isMember(roomId: RoomId, userId: UserId): Promise<boolean> {
    return (await this.db.all(MEMBERSHIP, roomId, userId)).length > 0;
  }

  /** Everyone active, by name. */
  async activePeople(): Promise<User[]> {
    return this.db.all<User>(ACTIVE_PEOPLE);
  }

  /** Everyone, whatever their status, for the people directory. */
  async directory(): Promise<DirectoryEntry[]> {
    return (await this.db.all<DirectoryRow>(DIRECTORY)).map(directoryEntry);
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

  /** What the avatar of whoever has id `userId` is drawn from, whatever their status, or null if nobody does. */
  async avatarOwner(userId: UserId): Promise<AvatarOwner | null> {
    const [row] = await this.db.all<{ name: string; role: number }>(`SELECT name, role FROM users WHERE id = ?`, userId);
    return row ? { name: row.name, bot: ROLES[row.role] === "bot" } : null;
  }

  /** Room `roomId`, unless it's a DM or someone isn't in it, and whether they can change it. */
  async roomToChange(roomId: RoomId, userId: UserId): Promise<{ room: Room; canAdminister: boolean } | null> {
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
   * anyone else out and queueing closing their sockets there with `code`, due at `dueAt`. Answers
   * whether it queued any.
   */
  async changeRoom(roomId: RoomId, changes: RoomChanges, code: CloseCode, dueAt: number, now: string): Promise<boolean> {
    const update = statement(UPDATE_ROOM, changes.name ?? null, changes.kind ?? null, changes.icon ?? null, now, roomId);
    if (changes.kind === "open") {
      await this.db.batch([update, statement(GRANT_ROOM_TO_ACTIVE_USERS, roomId, now, now)]);
      return false;
    }
    if (changes.kind !== "closed") {
      await this.db.batch([update]);
      return false;
    }
    const memberIds = JSON.stringify(changes.memberIds);
    const [, , queued] = await this.db.batch([
      update,
      statement(GRANT_ROOM_TO_USERS, roomId, now, now, memberIds),
      statement(QUEUE_MEMBER_REVOCATIONS, code, dueAt, roomId, memberIds),
      statement(REVOKE_ROOM_FROM_OTHERS, roomId, memberIds),
    ]);
    return queued!.length > 0;
  }

  /**
   * Deletes a room and who is in it, as ember-rust's `Room::destroy` does (room.rs), and in the same
   * transaction queues closing every socket in it with `code`, due at `dueAt`, in place of whatever
   * else the outbox had for it. The room's own object deletes its messages when that reaches it. The
   * room is remembered as deleted, so registering `LEGACY_ROOMS` doesn't bring it back.
   */
  async deleteRoom(roomId: RoomId, code: CloseCode, dueAt: number, now: string): Promise<void> {
    await this.db.batch([
      // Queued before the rest go, so it takes an id none of them had: SQLite numbers a row after the
      // largest id left, and the alarm settles what it delivered by id, so taking the id of one it's
      // delivering now would settle the deletion with it.
      statement(`INSERT INTO pending_revocations (room_id, tag, code, due_at) VALUES (?, ?, ?, ?)`, roomId, EVERYONE, code, dueAt),
      statement(`DELETE FROM pending_revocations WHERE room_id = ? AND tag <> ?`, roomId, EVERYONE),
      statement(`DELETE FROM memberships WHERE room_id = ?`, roomId),
      statement(`DELETE FROM rooms WHERE id = ?`, roomId),
      statement(`INSERT INTO deleted_rooms (id, deleted_at) VALUES (?, ?) ON CONFLICT DO NOTHING`, roomId, now),
    ]);
  }

  /** Adds a room and its people: everyone active for an open room, or just `memberIds` for a closed one. */
  async createRoom(room: Room, creatorId: UserId, memberIds: UserId[] | null, now: string): Promise<void> {
    await this.db.batch([
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
    ]);
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
