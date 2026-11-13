-- Reminders of messages, kept by the Workspace (scope "workspace" in src/migrations.ts). Someone asks
-- one from a message's menu, and it comes back to them at remind_at: to every tab they have open then,
-- and, when they weren't near Ember then, as a push to their browsers. The row stays until they've
-- dismissed it, so a tab that opens later finds it still, and so does the page they left it on. The
-- message is kept as its creator_id, creator_name and excerpt read when the reminder was set, whatever
-- has happened to the message or its room since.
CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  remind_at INTEGER NOT NULL,
  reminded_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX index_reminders_on_remind_at ON reminders (remind_at);
CREATE INDEX index_reminders_on_user ON reminders (user_id, remind_at);
