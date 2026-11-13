-- Who has hushed their push notifications (Do not disturb), until when, in milliseconds since the
-- epoch, kept by the Workspace (scope "workspace" in src/migrations.ts). A hush covers a push only
-- while its time hasn't passed: the queries check the moment, so a row whose time has passed is stale
-- and harmless, setting a hush again overwrites it, and lifting one takes the row away. It hushes push
-- notifications alone: involvement, unread marks, the app badge and banners in the app carry on.
CREATE TABLE dnd (
  user_id TEXT PRIMARY KEY,
  until_at INTEGER NOT NULL
);
