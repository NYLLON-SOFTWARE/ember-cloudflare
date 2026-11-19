-- The stays of the workspace's guests of one room, each with when it ends, kept by the Workspace
-- (scope "workspace" in src/migrations.ts). An administrator adds a guest to exactly one room from
-- its settings, which puts them in that room and nothing else: the one membership stands in for the
-- stay's reach, and every check a member goes through asks it, so a guest's other rooms refuse them
-- the way a stranger's do. The stay enforces time: a session whose person has one refuses once its
-- time has passed, whoever signs them in, and the Workspace's alarm, woken by this table's index for
-- the stay that ends next, ends their sessions and sockets, forgets their pushes and searches, and
-- marks them deactivated, whose row it keeps as it keeps a removed person's, until pruning takes it.
-- A guest of one room composes with the guests of the open sign-in (EMBER_GUEST_SIGN_IN), who have
-- no stay here: those keep their sessions only while the flag lets guests stay signed in, and reach
-- every room their memberships give them, as they did before this table.
CREATE TABLE guest_stays (
  -- The guest, who users keeps with guest = 1, as the open sign-in's guests are.
  user_id TEXT PRIMARY KEY,
  -- The one room their stay reaches, which their membership names too.
  room_id TEXT NOT NULL,
  -- When the stay ends, in milliseconds since the epoch. A stay whose time has passed is stale and
  -- harmless once lapsed, and extending one raises it.
  until_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS index_guest_stays_on_until_at ON guest_stays (until_at);
