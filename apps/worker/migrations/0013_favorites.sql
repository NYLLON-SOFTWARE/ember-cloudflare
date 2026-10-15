-- The rooms each person has starred, kept by the Workspace (scope "workspace" in src/migrations.ts).
-- ember-rust keeps each person's as a list in the account's settings (`ember_favorite_channels`,
-- crates/db/src/models/account.rs); a row each stars or unstars a room without rewriting the rest,
-- and position orders them, first starred first. A star outlives the room's membership, as an id in
-- ember-rust's list does, so room_id names no room: it's dropped at its person's next star or unstar.
CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users (id),
  room_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, room_id)
);
CREATE INDEX IF NOT EXISTS index_favorites_on_user_id_and_position ON favorites (user_id, position);

-- How many times each person's stars have changed, so that of two lists of them, a tab keeps the newer.
ALTER TABLE users ADD COLUMN favorites_version INTEGER NOT NULL DEFAULT 0;
