-- Messages waiting to be posted at a time the author chose, kept by the room (scope "room" in
-- src/migrations.ts). send_at is UTC ISO-8601 with a Z, so the instant is unambiguous on either
-- backend. Until that time the row is visible only to its author; the room then posts it as an
-- ordinary message and drops the row.
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  body TEXT NOT NULL,
  plain_text TEXT NOT NULL,
  mentions TEXT NOT NULL DEFAULT '[]',
  send_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_scheduled_messages_on_room_id_and_send_at ON scheduled_messages (room_id, send_at);
CREATE INDEX IF NOT EXISTS index_scheduled_messages_on_room_id_and_creator_id_and_send_at ON scheduled_messages (room_id, creator_id, send_at);
