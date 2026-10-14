import messages from "../migrations/0001_messages.sql";
import clientMessageIds from "../migrations/0002_client_message_ids.sql";
import usersAndSessions from "../migrations/0003_users_and_sessions.sql";
import roomsAndMemberships from "../migrations/0004_rooms_and_memberships.sql";
import accounts from "../migrations/0005_accounts.sql";
import revocations from "../migrations/0006_revocations.sql";
import pendingRevocations from "../migrations/0007_pending_revocations.sql";
import deletedRooms from "../migrations/0008_deleted_rooms.sql";
import roomIcons from "../migrations/0009_room_icons.sql";
import roomEvents from "../migrations/0010_room_events.sql";
import unreadMarks from "../migrations/0011_unread_marks.sql";
import richText from "../migrations/0012_rich_text.sql";

/**
 * The kind of Durable Object whose tables a migration creates or changes. On DO SQLite each object
 * applies only its own kind's migrations, so a room's storage never holds the workspace's tables;
 * D1 holds every kind's.
 */
export type Scope = "room" | "workspace";

export interface Migration {
  name: string;
  scope: Scope;
  sql: string;
}

/**
 * Every file in migrations/, oldest first. D1 gets them all from `wrangler d1 migrations apply`; each
 * Durable Object applies the ones for its scope that its storage is missing when it opens. A test
 * checks this list against the directory.
 */
export const MIGRATIONS: Migration[] = [
  { name: "0001_messages.sql", scope: "room", sql: messages },
  { name: "0002_client_message_ids.sql", scope: "room", sql: clientMessageIds },
  { name: "0003_users_and_sessions.sql", scope: "workspace", sql: usersAndSessions },
  { name: "0004_rooms_and_memberships.sql", scope: "workspace", sql: roomsAndMemberships },
  { name: "0005_accounts.sql", scope: "workspace", sql: accounts },
  { name: "0006_revocations.sql", scope: "room", sql: revocations },
  { name: "0007_pending_revocations.sql", scope: "workspace", sql: pendingRevocations },
  { name: "0008_deleted_rooms.sql", scope: "workspace", sql: deletedRooms },
  { name: "0009_room_icons.sql", scope: "workspace", sql: roomIcons },
  { name: "0010_room_events.sql", scope: "room", sql: roomEvents },
  { name: "0011_unread_marks.sql", scope: "workspace", sql: unreadMarks },
  { name: "0012_rich_text.sql", scope: "room", sql: richText },
];

/**
 * Applies the migrations for `scope` that a Durable Object's storage is missing, recording each in
 * the table wrangler keeps for D1. Rooms from before this table existed ran 0001 already; it only
 * creates what's missing, so it runs again harmlessly and is recorded.
 */
export function migrate(storage: DurableObjectStorage, scope: Scope): void {
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`);
  const applied = new Set(storage.sql.exec<{ name: string }>("SELECT name FROM d1_migrations").toArray().map((row) => row.name));
  for (const migration of MIGRATIONS) {
    if (migration.scope !== scope || applied.has(migration.name)) continue;
    storage.transactionSync(() => {
      storage.sql.exec(migration.sql);
      storage.sql.exec("INSERT INTO d1_migrations (name) VALUES (?)", migration.name);
    });
  }
}
