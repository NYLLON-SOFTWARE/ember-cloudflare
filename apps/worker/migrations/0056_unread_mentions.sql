-- Whether a message that mentions someone has come in a room since it was marked unread for them, which
-- draws the room's count in the strong pill rather than the muted one, as Slack sets mentions apart. The
-- Workspace sets it as it counts the message (src/workspace-store.ts `MENTION_UNREAD`), and reading the
-- room clears it.
ALTER TABLE memberships ADD COLUMN unread_mentioned INTEGER NOT NULL DEFAULT 0;
