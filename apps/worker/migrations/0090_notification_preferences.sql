-- What each person's notified about wherever they haven't picked a level (scope "workspace" in
-- src/migrations.ts), as Slack's "Notify me about": everything, mentions or nothing, null for mentions.
ALTER TABLE users ADD COLUMN default_involvement TEXT;
-- When their paused notifications come back, in milliseconds since the epoch, or null while they're on.
ALTER TABLE users ADD COLUMN notifications_paused_until INTEGER;
-- Whether they picked their level in a room, rather than following default_involvement there.
ALTER TABLE memberships ADD COLUMN involvement_chosen INTEGER NOT NULL DEFAULT 0;
-- A level other than the one a room or DM starts at was picked.
UPDATE memberships SET involvement_chosen = 1
  WHERE involvement <> CASE WHEN (SELECT kind FROM rooms WHERE rooms.id = memberships.room_id) = 'direct' THEN 'everything' ELSE 'mentions' END;
