-- Bots' tokens and webhooks, kept by the Workspace (scope "workspace" in src/migrations.ts), as
-- ember-rust's `users.bot_token` and `webhooks` keep them (crates/db/src/schema.sql). A bot's key is its
-- id and its token, so a bot is found by its id, and the token needs no index. Unlike ember-rust, a bot
-- has a webhook only while it has somewhere to deliver, and at most one, so the bot's id is the key.
ALTER TABLE users ADD COLUMN bot_token TEXT;
CREATE TABLE IF NOT EXISTS webhooks (
  user_id TEXT PRIMARY KEY REFERENCES users (id),
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
