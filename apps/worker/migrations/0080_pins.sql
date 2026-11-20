-- Pins (scope "room" in src/migrations.ts), as Slack has them: anyone in a room can pin one of its
-- messages to it, and the room's Pinned view lists them, a hundred at most (MAX_PINS in @ember/protocol).
-- Each pin names its message, who pinned it and when. A deleted message's pin goes with it, in the same
-- batch as the deletion (src/store.ts), and a room wiped takes every pin with it, through ON DELETE
-- CASCADE. The room's own id goes with each one, as every table rooms keep in D1 together carries.
CREATE TABLE IF NOT EXISTS pins (
  message_id TEXT PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  pinned_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_pins_on_room_id_and_pinned_at ON pins (room_id, pinned_at);
