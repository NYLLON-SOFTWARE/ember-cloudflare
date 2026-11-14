-- The forwards of a room's messages (scope "room" in src/migrations.ts, src/forwards.ts): each forward
-- `forward_id` posted in room `to_room_id` quoting message `message_id` here. When the message goes, its
-- forwards' rows are marked `orphaned_at`, and the room tells each forward's room, which takes the quote and
-- its file away, keeping the forwarder's note, then forgets the row.
CREATE TABLE IF NOT EXISTS forwards (
  room_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  to_room_id TEXT NOT NULL,
  forward_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  orphaned_at TEXT,
  PRIMARY KEY (room_id, to_room_id, forward_id)
);
CREATE INDEX IF NOT EXISTS index_forwards_on_room_id_and_message_id ON forwards (room_id, message_id);
CREATE INDEX IF NOT EXISTS index_forwards_orphaned ON forwards (room_id, orphaned_at) WHERE orphaned_at IS NOT NULL;
