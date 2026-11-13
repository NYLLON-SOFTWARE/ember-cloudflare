-- The mood each person wears beside their name (scope "workspace" in src/migrations.ts): a JSON object
-- with their emoji, a few words beside it, and when it comes off by itself, or null while they wear
-- none. It rides their profile: the workspace keeps what it's given and sets no alarm for the clear
-- time, so one whose time has passed is the page's to leave out.
ALTER TABLE users ADD COLUMN mood TEXT;
