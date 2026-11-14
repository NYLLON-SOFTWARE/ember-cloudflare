-- Messages people have scheduled to send later (scope "room" in src/migrations.ts), as Slack's composer
-- schedules them: `body` is the markup the composer wrote, prepared again as the room's alarm posts it at
-- `send_at` (milliseconds since the epoch) as its author's message, with `client_message_id` as its own.
-- A reply in a thread names its parent, and `also_send` is 1 when it goes to the room too. Each is
-- deleted as it's posted, or when its author deletes it.
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  body TEXT NOT NULL,
  parent_id TEXT,
  also_send INTEGER NOT NULL DEFAULT 0,
  send_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_scheduled_messages_on_room_id_and_send_at ON scheduled_messages (room_id, send_at);
CREATE INDEX IF NOT EXISTS index_scheduled_messages_on_room_id_and_author_id ON scheduled_messages (room_id, author_id, send_at);
