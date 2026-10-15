-- Bans, kept by the Workspace (scope "workspace" in src/migrations.ts).
--
-- A ban blocks each IP address recorded on its person's sessions when they were banned, as
-- ember-rust's `bans` table does (crates/db/src/schema.sql), with its indexes: by address, which a
-- request's check finds, and by person, which lifting the ban deletes.
CREATE TABLE IF NOT EXISTS bans (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  ip_address TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_bans_on_ip_address ON bans (ip_address);
CREATE INDEX IF NOT EXISTS index_bans_on_user_id ON bans (user_id);

-- The rooms the Workspace has yet to ask to delete a banned person's messages, another outbox
-- beside pending_revocations (migration 0007): banning someone writes a row for each room they may
-- have written in, in the same batch, and the Workspace's alarm asks each room to delete their
-- messages a page at a time, as ember-rust's `RemoveBannedContentJob` deletes them one by one
-- (crates/ember/src/jobs.rs), until it has none of theirs left (src/workspace.ts).
CREATE TABLE IF NOT EXISTS pending_purges (
  id INTEGER PRIMARY KEY,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  -- Failed deliveries in a row.
  attempts INTEGER NOT NULL DEFAULT 0,
  -- When to ask the room next, in milliseconds since the epoch.
  due_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS index_pending_purges_on_due_at ON pending_purges (due_at);
