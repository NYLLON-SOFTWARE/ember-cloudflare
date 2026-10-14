-- A room's icon, kept by the Workspace (scope "workspace" in src/migrations.ts): the name of a Lucide
-- icon in ember-rust's catalog, or null for the default #. ember-rust keeps the icons in the account's
-- settings as a map from room id to name (`ember_channel_icons`, crates/db/src/models/account.rs);
-- here a room's icon is read with the room, and goes when the room does.
ALTER TABLE rooms ADD COLUMN icon TEXT;
