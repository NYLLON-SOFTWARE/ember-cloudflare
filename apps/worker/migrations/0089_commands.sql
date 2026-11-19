-- Slash commands and bots' subscriptions to message events, kept by the Workspace (scope "workspace"
-- in src/migrations.ts).
--
-- A command is a name ("/deploy"), what it's for, and the bot it invokes: typing "/name text" in a room
-- the bot is in delivers a Slack-shaped payload to its webhook, as a mention's delivery does. Names are
-- unique across the workspace, one answer to them, and kept lowercased, so a lookup compares one case.
--
-- A subscription puts a bot on every message written in one of its rooms by someone else, delivered to
-- its webhook like a command's, its own messages spared. A bot in the room is checked again when each
-- message is delivered, so a subscription left behind by a leave or a deletion sends nothing, and a row
-- whose room or bot is gone is stale and harmless.
CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  bot_id TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bot_subscriptions (
  room_id TEXT NOT NULL REFERENCES rooms (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
