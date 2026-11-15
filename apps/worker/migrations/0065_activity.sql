-- Each person's Activity, as Slack's is (scope "workspace" in src/migrations.ts, src/activity.ts): what has
-- happened to them, kept once read, marked so. Campfire has none. An item is about a message that
-- mentions them, a message in a DM of theirs, a reply in a thread they follow, a reaction to a message of
-- theirs, or someone adding them to a private room.
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Whose Activity it's in.
  user_id TEXT NOT NULL,
  -- 'mention', 'direct', 'thread', 'reaction' or 'invitation'.
  kind TEXT NOT NULL,
  room_id TEXT NOT NULL,
  -- The message it's about, or reacted to, and null for an invitation.
  message_id TEXT,
  -- For a reply in a thread, the message it replies to.
  parent_id TEXT,
  -- Who wrote the message, reacted, or added them.
  actor_id TEXT NOT NULL,
  -- The start of the message's text.
  preview TEXT NOT NULL DEFAULT '',
  -- A reaction's emoji or words.
  content TEXT,
  created_at TEXT NOT NULL,
  -- When it was read, or null while it's unread.
  read_at TEXT
);
-- A page of someone's Activity, newest first.
CREATE INDEX IF NOT EXISTS index_activity_on_user_id_and_id ON activity (user_id, id);
-- How many items of theirs are unread, and those in a room they've just read.
CREATE INDEX IF NOT EXISTS index_activity_unread ON activity (user_id, room_id) WHERE read_at IS NULL;
-- The items about a message, which go when it's deleted or a reaction to it is taken back.
CREATE INDEX IF NOT EXISTS index_activity_on_message_id ON activity (message_id) WHERE message_id IS NOT NULL;
