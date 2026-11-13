-- The skin tone each person chooses on their profile for the emoji of people and hands they type by their
-- :codes and add as quick reactions, as Slack's default skin tone is, kept by the Workspace (scope
-- "workspace" in src/migrations.ts): 0 for the emoji's own yellow, where everyone starts, or 1 to 5 for
-- Unicode's tones, light to dark. Sessions read it with the person, so it comes with who's signed in.
ALTER TABLE users ADD COLUMN skin_tone INTEGER NOT NULL DEFAULT 0;
