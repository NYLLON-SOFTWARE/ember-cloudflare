-- What each person has done with the files they can see (scope "workspace" in src/migrations.ts), as Slack's
-- Files page keeps it: starred a file, which Starred lists, and when they last opened it, which Recently
-- viewed sorts by (src/library.ts). `file_id` is a file's key (migrations/0028_blobs.sql) or a canvas's tab's
-- id (migrations/0061_room_tabs.sql), and `room_id` the room it's in, whose deletion forgets its marks.
CREATE TABLE IF NOT EXISTS file_marks (
  user_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  starred_at TEXT,
  viewed_at TEXT,
  PRIMARY KEY (user_id, file_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS index_file_marks_on_room_id ON file_marks (room_id);
