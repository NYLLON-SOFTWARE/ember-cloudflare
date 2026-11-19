-- When a reminder's pushes were settled: they went out to every browser they could reach, or they're
-- given up on, having been tried for a day past its time (REMINDER_PUSH_GRACE_MS in src/workspace.ts)
-- while its notice sat in the person's tabs all along. Null until then, and what brings a reminder
-- back to the runs after its telling, which says the notice once, to try its pushes again.
ALTER TABLE reminders ADD COLUMN pushed_at INTEGER;
