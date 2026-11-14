-- Custom emoji, as Slack has them, kept by the Workspace (scope "workspace" in src/migrations.ts): a
-- picture anyone uploads and names, which everyone types by its :name:. Messages and boosts keep the code
-- as text, so nothing refers to a row here, and removing one leaves its code showing. R2 keeps the
-- picture at `object_key`, reserved and deleted through pending_picture_deletions (migration 0032), as
-- avatars are, and `content_type` is what its bytes said it is, which it's served as.
CREATE TABLE IF NOT EXISTS custom_emoji (
  name TEXT PRIMARY KEY,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
