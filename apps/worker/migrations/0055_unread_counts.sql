-- How many messages have come in a room since it was marked unread for someone, up to 10, after which the
-- sidebar says "9+" (`UNREAD_COUNT_CAP` in @ember/protocol), counting only those that mention them where
-- they follow the room at @mentions or not at all. The Workspace counts each message as it marks the room
-- unread (src/workspace-store.ts `COUNT_UNREAD`), and reading the room starts it again at none. Rooms
-- marked unread before it was kept count from none.
ALTER TABLE memberships ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0;
