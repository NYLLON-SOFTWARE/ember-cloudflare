-- Message shortcuts, kept by the Workspace (scope "workspace" in src/migrations.ts).
--
-- A shortcut is a name as it's shown ("Translate this"), what it's for, and the bot it invokes: picking
-- it in a message's More actions delivers a Slack-shaped message_action payload about that message to
-- the bot's webhook, as a command's delivery is. Names are unique across the workspace, one answer to
-- each, and kept as they're typed, since a shortcut's name is shown rather than typed, where a command's
-- is kept lowercased to be found.
--
-- A sibling of commands rather than a kind of them: a command's name is one case and looked up by it,
-- and its delivery says what was typed, where a shortcut's says which message ran it, so the two share
-- neither their queries nor their payloads, and the bots page registers each beside the other.
CREATE TABLE IF NOT EXISTS shortcuts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  bot_id TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
