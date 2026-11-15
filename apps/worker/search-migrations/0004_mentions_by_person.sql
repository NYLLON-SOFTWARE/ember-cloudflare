-- For the Threads page, which lists the threads someone is mentioned in (src/search-index.ts
-- `followedThreads`): whom each message mentions, by the person mentioned.
CREATE INDEX IF NOT EXISTS index_search_mentions_on_user_id_and_id ON search_mentions (user_id, id);
