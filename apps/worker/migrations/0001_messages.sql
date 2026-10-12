-- Used only when STORAGE_BACKEND is "d1". The ChatRoom Durable Object creates the same
-- tables in its own SQLite storage otherwise (see src/store.ts), so keep the two in step.
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_messages_on_room_id_and_id ON messages (room_id, id);

CREATE TABLE IF NOT EXISTS boosts (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  booster_id TEXT NOT NULL,
  booster_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_boosts_on_message_id ON boosts (message_id);
