-- Each person's To-dos and Saved, Slack's two lists of things kept for later, kept by the Workspace (scope
-- "workspace" in src/migrations.ts). list is 'todo' or 'saved', and an item moves between them by
-- changing it. kind is 'message' or 'file' for an item that keeps a message, or a file message's file,
-- by its room and id, and 'note' for a to-do of its person's own, whose text is body, its markup, and
-- plain_text, and whose files are files, a JSON list of their R2 keys, names, types, sizes and shapes.
-- An item keeps no copy of its message: its room shows it as it is now, and a person who can no longer
-- see the room sees the item as unavailable. Each message is kept once per person, in one list or the
-- other.
--
-- completed_at marks a to-do completed. remind_at, in milliseconds, is when it reminds its person, which
-- the Workspace's alarm does, clearing it.
CREATE TABLE IF NOT EXISTS saved_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  list TEXT NOT NULL,
  kind TEXT NOT NULL,
  room_id TEXT,
  message_id TEXT,
  body TEXT,
  plain_text TEXT,
  files TEXT,
  completed_at TEXT,
  remind_at INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_saved_items_on_user_id_and_list ON saved_items (user_id, list, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS index_saved_items_on_user_id_and_message_id ON saved_items (user_id, message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS index_saved_items_on_remind_at ON saved_items (remind_at) WHERE remind_at IS NOT NULL;
