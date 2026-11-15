-- The last canvas saved whole that each canvas tab took (scope "workspace" in src/migrations.ts), by the id
-- its page gave it, so a page that closed before hearing whether its last save landed can tell as the
-- canvas next opens, and merge in what it kept only if it didn't (apps/web/src/lib/canvas-unsaved.ts).
ALTER TABLE room_tabs ADD COLUMN save_id TEXT;
