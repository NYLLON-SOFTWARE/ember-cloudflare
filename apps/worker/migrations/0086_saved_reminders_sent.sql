-- When a to-do's reminder went off (scope "workspace", src/saved-store.ts), in milliseconds, so the item
-- keeps its reminder's time and shows as overdue while it's in progress; null until it goes off, and again
-- once another reminder is set. The alarm looks only at the reminders yet to go off.
ALTER TABLE saved_items ADD COLUMN reminded_at INTEGER;
CREATE INDEX IF NOT EXISTS index_saved_items_on_remind_at_unsent ON saved_items (remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL;
