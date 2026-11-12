-- When a forwarded message last changed (scope "room", src/forwards.ts): a forward follows its original's edits,
-- as Slack's do, so a message's change marks its forwards' rows, and the room sends each forward's room what it
-- quotes now, then clears the mark. A forward of a forward follows the forward it quotes the same way, so what
-- an original's deletion or edit takes out of the first takes it out of every forward down the chain.
ALTER TABLE forwards ADD COLUMN changed_at TEXT;
CREATE INDEX IF NOT EXISTS index_forwards_changed ON forwards (room_id, changed_at) WHERE changed_at IS NOT NULL;
