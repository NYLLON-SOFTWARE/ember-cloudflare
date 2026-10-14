import type { Account, Room, RoomId, User, UserId } from "@ember/protocol";
import { statement, type Db } from "./db";

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

/** The settings ember-rust writes out for a new account (crates/db/src/models/account.rs). */
const NEW_ACCOUNT_SETTINGS = JSON.stringify({ restrict_room_creation_to_administrators: false });

/** The account first run creates. */
export interface NewAccount extends Account {
  id: string;
  joinCode: string;
}

/** The person first run makes the workspace's first administrator. */
export interface NewAdministrator {
  id: UserId;
  name: string;
  emailAddress: string;
  passwordDigest: string;
}

/** A session and the person it signs in. */
export interface StoredSession {
  id: string;
  user: User;
  /** Whether the person signed in with just a name. */
  guest: boolean;
  /** When the session was last refreshed, in milliseconds since the epoch. */
  lastActiveAt: number;
}

interface SessionRow {
  session_id: string;
  last_active_at: string;
  user_id: string;
  name: string;
  guest: number;
}

const INSERT_SESSION = `INSERT INTO sessions (id, user_id, token_digest, ip_address, user_agent, last_active_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

/** The rooms someone is in, by name as ember-rust's sidebar sorts them (membership.rs). */
export const ROOMS_FOR_USER = `SELECT rooms.id, rooms.kind, rooms.name FROM memberships JOIN rooms ON rooms.id = memberships.room_id
  WHERE memberships.user_id = ? ORDER BY rooms.name COLLATE NOCASE, rooms.id`;

/** Whether someone is in a room, asked on every room socket's upgrade. */
export const MEMBERSHIP = `SELECT 1 FROM memberships WHERE room_id = ? AND user_id = ?`;

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

/** Keeps the people a JSON list of `{id, name}` names as deactivated guests, unless they're already here. */
const INSERT_FORMER_GUESTS = `INSERT INTO users (id, name, status, guest, created_at, updated_at)
  SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), ${DEACTIVATED}, 1, ?, ? FROM json_each(?) WHERE true
  ON CONFLICT DO NOTHING`;

export class WorkspaceStore {
  constructor(private readonly db: Db) {}

  /** The workspace's account, or null until first run creates it. */
  async account(): Promise<Account | null> {
    const [account] = await this.db.all<Account>(`SELECT name FROM accounts`);
    return account ?? null;
  }

  /**
   * Creates the workspace as ember-rust's first run does (crates/db/src/models/first_run.rs): the
   * account, its first administrator, an open room that takes in every active person, and the
   * administrator's session, who also joins every other open room. If there's an account already,
   * its singleton guard refuses the first statement, and so the whole batch.
   */
  async createWorkspace(
    account: NewAccount,
    administrator: NewAdministrator,
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
    const [row] = await this.db.all<SessionRow>(
      `SELECT sessions.id AS session_id, sessions.last_active_at, users.id AS user_id, users.name, users.guest
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_digest = ? AND users.status = ?`,
      tokenDigest,
      ACTIVE,
    );
    if (!row) return null;
    return { id: row.session_id, user: { id: row.user_id, name: row.name }, guest: row.guest === 1, lastActiveAt: Date.parse(row.last_active_at) };
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

  async deleteSession(tokenDigest: string): Promise<void> {
    await this.db.run(`DELETE FROM sessions WHERE token_digest = ?`, tokenDigest);
  }

  async roomsFor(userId: UserId): Promise<Room[]> {
    return this.db.all<Room>(ROOMS_FOR_USER, userId);
  }

  async isMember(roomId: RoomId, userId: UserId): Promise<boolean> {
    return (await this.db.all(MEMBERSHIP, roomId, userId)).length > 0;
  }

  /** Adds a room and its people: everyone active for an open room, or just `memberIds` for a closed one. */
  async createRoom(room: Room, creatorId: UserId, memberIds: UserId[] | null, now: string): Promise<void> {
    await this.db.batch([
      statement(`INSERT INTO rooms (id, kind, name, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, room.id, room.kind, room.name, creatorId, now, now),
      memberIds ? statement(GRANT_ROOM_TO_USERS, room.id, now, now, JSON.stringify(memberIds)) : statement(GRANT_ROOM_TO_ACTIVE_USERS, room.id, now, now),
    ]);
  }

  /** Of the rooms `ids` names, the ones that aren't registered yet. The ids go as one JSON value. */
  async unregisteredRooms(ids: RoomId[]): Promise<RoomId[]> {
    const rows = await this.db.all<{ id: RoomId }>(`SELECT DISTINCT value AS id FROM json_each(?) WHERE value NOT IN (SELECT id FROM rooms)`, JSON.stringify(ids));
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
