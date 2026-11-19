-- The messages each person has saved for later, kept by the Workspace (scope "workspace" in
-- src/migrations.ts). Nothing of a message is snapshotted: the rows keep the room and message ids, and
-- the Saved pane asks each room for its messages as it shows them, as search results do, so an edit
-- shows and a deleted message's save quietly leaves. A save outlives the room's membership, so
-- room_id can name a room its person can no longer see: those rows are dropped the next time they
-- look at their saves.
CREATE TABLE IF NOT EXISTS saves (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  room_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS index_saves_on_user_id_and_created_at ON saves (user_id, created_at);
