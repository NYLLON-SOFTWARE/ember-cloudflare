-- The scheduled messages whose listings the Workspace has yet to hear of (scope "room" in src/migrations.ts,
-- src/scheduled.ts): each change to scheduled_messages logs the message's id in the same batch, and the room
-- sends the Workspace each one as it is then, or that it's gone, and forgets what the Workspace has taken.
-- Every message already scheduled is logged once, so the Workspace lists those too.
CREATE TABLE IF NOT EXISTS scheduled_changes (
  -- AUTOINCREMENT never hands out a number again, so the room forgets only what it has sent.
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  scheduled_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_scheduled_changes_on_room_id_and_seq ON scheduled_changes (room_id, seq);
INSERT INTO scheduled_changes (room_id, scheduled_id) SELECT room_id, id FROM scheduled_messages ORDER BY room_id, send_at;
