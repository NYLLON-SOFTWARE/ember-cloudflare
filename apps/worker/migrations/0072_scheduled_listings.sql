-- Everyone's scheduled messages across rooms, as the Workspace lists them (scope "workspace" in
-- src/migrations.ts, src/scheduled-listings.ts): a copy of what each room keeps in scheduled_messages
-- (0070, 0071), which the room sends whenever one is scheduled, moved, marked not sent, posted or deleted,
-- so Drafts & sent can list them without asking every room. preview is the start of the message's plain
-- text, as a reply shows its parent's; send_at is in milliseconds. A listing whose room its person has
-- left stays, unlisted, as the room keeps the message too, and goes with the room when it's deleted.
CREATE TABLE IF NOT EXISTS scheduled_listings (
  room_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  send_at INTEGER NOT NULL,
  preview TEXT NOT NULL,
  parent_id TEXT,
  failed TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (room_id, id)
);
CREATE INDEX IF NOT EXISTS index_scheduled_listings_on_user_id_and_send_at ON scheduled_listings (user_id, send_at);
