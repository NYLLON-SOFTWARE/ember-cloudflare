-- The IANA time zone each person's browser last said it's in (scope "workspace" in src/migrations.ts),
-- for the local time their profile shows others, or null before it has. Campfire keeps none.
ALTER TABLE users ADD COLUMN time_zone TEXT;
