-- The tabs a room's members add beside Messages and Files & links (scope "workspace" in src/migrations.ts),
-- as Slack's channel tabs: a file sent in the room, a link, a folder of files and links, or a canvas, a
-- document they write together (src/room-tabs.ts). The Workspace keeps them, as it knows who's in each room,
-- and lists every room's canvases on the Files page in one query. Deleting the room deletes them.
--
-- `target` is a file tab's file, as JSON (`{ messageId, file }`, the file without its addresses, which are
-- signed as it's read), or a link tab's `{ url }`. A canvas keeps its document, Tiptap's JSON, in `body`, and
-- `version` counts its saves, so a save made over an older version is refused rather than lost.
CREATE TABLE IF NOT EXISTS room_tabs (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  target TEXT,
  body TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  creator_id TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  updater_id TEXT NOT NULL,
  updater_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_room_tabs_on_room_id_and_position ON room_tabs (room_id, position);
CREATE INDEX IF NOT EXISTS index_room_tabs_canvases ON room_tabs (room_id) WHERE kind = 'canvas';

-- The files and links in a folder tab, in the order they were added, each `target` as a tab's is.
CREATE TABLE IF NOT EXISTS room_tab_items (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  title TEXT NOT NULL,
  target TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_room_tab_items_on_tab_id ON room_tab_items (tab_id, created_at);
CREATE INDEX IF NOT EXISTS index_room_tab_items_on_room_id ON room_tab_items (room_id);
