-- Scheduled messages the room couldn't post when they were due (scope "room" in src/migrations.ts), as
-- when their author had left the room or their thread's message was deleted: `failed` says why, as their
-- author's tabs show it, and the alarm leaves them for the author to send again, edit or delete. A
-- scheduled message is kept once for the id its author's tab gave it, so a frame sent twice posts once:
-- any kept twice before this are kept once, the first.
ALTER TABLE scheduled_messages ADD COLUMN failed TEXT;
DELETE FROM scheduled_messages WHERE id NOT IN (SELECT min(id) FROM scheduled_messages GROUP BY room_id, author_id, client_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_scheduled_messages_on_room_id_author_id_and_client_message_id ON scheduled_messages (room_id, author_id, client_message_id);
