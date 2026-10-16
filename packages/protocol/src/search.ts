import type { Message, Room } from "./index.ts";

// Searching messages, as ember-rust's searches do it (crates/ember/src/controllers/searches.rs,
// crates/ember/src/integrations/search.rs and `search_reachable` in crates/db/src/models/message.rs).

/** How many matches a search answers with, at most: the newest. */
export const SEARCH_LIMIT = 100;

/** The longest search, in UTF-16 code units. ember-rust takes any. */
export const MAX_SEARCH_LENGTH = 1_000;

export const SEARCH_TOO_LONG = `Searches can be up to ${MAX_SEARCH_LENGTH.toLocaleString("en-US")} characters.`;

/**
 * Turns every character but Ruby's word characters, which are letters, marks, decimal digits,
 * connectors such as `_`, and the joiners, into a space, one each, as ember-rust's `sanitize_query`
 * does (`params[:q]&.gsub(/[^[:word:]]/, " ")` in Campfire). What's left can't be FTS5's syntax.
 */
export const sanitizeSearch = (q: string) => q.replace(/[^\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}]/gu, " ");

/** Whether a sanitized search has a word in it, which a search needs (`is_present`, searches.rs). */
export const isSearchable = (query: string) => /\S/u.test(query);

/**
 * A sanitized search as FTS5 reads it, as ember-rust's `match_terms` writes it: each word quoted as a
 * string, so that none is read as FTS5's syntax, such as NOT or NEAR, and all of them must match. NULs
 * separate words too, since SQLite would end the query at one.
 */
export const searchTerms = (query: string) =>
  query
    .split(/[\s\0]+/u)
    .filter((word) => word !== "")
    .map((word) => `"${word.replaceAll('"', '""')}"`)
    .join(" ");

/** What `GET /api/searches` answers. */
export interface SearchResults {
  /** What was searched for, sanitized, or null when there was nothing to search for. */
  query: string | null;
  /** The newest messages, up to `SEARCH_LIMIT`, in the rooms you're in that have every word, oldest first. */
  messages: Message[];
  /** The rooms they're in, as your sidebar lists them. */
  rooms: Room[];
}
