-- For the Threads page, which lists every thread in someone's rooms, latest active first
-- (src/search-index.ts `listedThreads`): the messages in threads, newest first, with the room each is in,
-- and each thread's messages in order, to tell which is its latest.
CREATE INDEX IF NOT EXISTS index_search_messages_in_threads_on_id ON search_messages (id, thread_id, room_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS index_search_messages_on_thread_id_and_id ON search_messages (thread_id, id) WHERE thread_id IS NOT NULL;
