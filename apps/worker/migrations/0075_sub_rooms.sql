-- Sub-rooms, kept by the Workspace (scope "workspace" in src/migrations.ts).
--
-- A room's parent_id names the room it's under, one level deep, or is null for a room of its own. A
-- sub-room's members are always some of its parent's, and deleting a parent sets its sub-rooms'
-- parent_id back to null, so a row never names a deleted parent. The index finds a room's sub-rooms.
ALTER TABLE rooms ADD COLUMN parent_id TEXT;
CREATE INDEX IF NOT EXISTS index_rooms_on_parent_id ON rooms (parent_id);
