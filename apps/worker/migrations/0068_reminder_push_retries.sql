-- When a reminder's pushes were last tried, and which of its person's browsers they reached. A try
-- whose pushes fail keeps when it was, which puts trying the rest off for a while
-- (REMINDER_PUSH_RETRY_MS in src/workspace-store.ts), so a push service that won't take them isn't
-- asked run after run; and the list is what the tries after send, a browser a try reached being sent
-- no reminder twice.
ALTER TABLE reminders ADD COLUMN push_tried_at INTEGER;
ALTER TABLE reminders ADD COLUMN delivered TEXT;
