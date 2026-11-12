-- The files people have sent for notes of their own in To-dos that no note carries yet (scope "workspace",
-- src/saved-store.ts), by their R2 keys: a note takes a file only while it's here, which it then leaves, so
-- no two notes share a file, and each person has only so many waiting. Those a day old, never used, the
-- Workspace's alarm has R2 delete. created_at is in milliseconds.
CREATE TABLE IF NOT EXISTS note_uploads (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS index_note_uploads_on_user_id ON note_uploads (user_id);
CREATE INDEX IF NOT EXISTS index_note_uploads_on_created_at ON note_uploads (created_at);
