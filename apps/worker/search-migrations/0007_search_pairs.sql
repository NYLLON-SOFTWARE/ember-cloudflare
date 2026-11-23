-- Whether the search index keeps each message's runs of Chinese, Japanese and Korean characters as it does
-- now, a term for each character and the next (src/search-words.ts `termsOf`), so that a search finds a
-- word inside a run, as their words have no spaces between them, or as it kept every message before this,
-- each run a word whole. Only a message with such runs is kept differently, so the walk below pairs those
-- alone, and leaves the rest at 0.
ALTER TABLE search_messages ADD COLUMN paired INTEGER NOT NULL DEFAULT 0;

-- The walk that pairs the characters of the messages the index took before this, newest first, until it
-- has read them all: those left are numbered below `before`. None for an index that held none.
CREATE TABLE IF NOT EXISTS search_pairing (
  before INTEGER NOT NULL
);
INSERT INTO search_pairing (before) SELECT id + 1 FROM search_messages ORDER BY id DESC LIMIT 1;
