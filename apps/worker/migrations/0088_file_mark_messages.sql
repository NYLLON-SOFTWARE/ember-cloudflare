-- The message holding each file someone marks (scope "workspace" in src/migrations.ts), so Starred finds a
-- file starred long ago however many newer files its rooms hold (src/library.ts). Null for a canvas, and for
-- a file marked before this.
ALTER TABLE file_marks ADD COLUMN message_id TEXT;
