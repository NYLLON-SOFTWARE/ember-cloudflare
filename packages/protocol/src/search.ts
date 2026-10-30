import type { Message, Room } from "./index.ts";
import { SEARCHES_PATH } from "./pages.ts";

// Searching messages.

/** How many matches a search answers with, at most: the newest. */
export const SEARCH_LIMIT = 100;

/** The longest search, in UTF-16 code units. */
export const MAX_SEARCH_LENGTH = 1_000;

export const SEARCH_TOO_LONG = `Searches can be up to ${MAX_SEARCH_LENGTH.toLocaleString("en-US")} characters.`;

/** How many recent searches someone keeps: the newest. */
export const RECENT_SEARCHES = 10;

/**
 * Turns every character but Ruby's word characters, which are letters, marks, decimal digits, connectors
 * such as `_`, and the joiners, into a space, one each, as Campfire's
 * `params[:q]&.gsub(/[^[:word:]]/, " ")` does. What's left can't be FTS5's syntax.
 */
export const sanitizeSearch = (q: string) => q.replace(/[^\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}]/gu, " ");

/** Whether a sanitized search has a word in it, which a search needs. */
export const isSearchable = (query: string) => /\S/u.test(query);

/**
 * A sanitized search as FTS5 reads it: each word quoted as a string, so that none is read as FTS5's
 * syntax, such as NOT or NEAR, and all of them must match. NULs separate words too, since SQLite would
 * end the query at one.
 */
export const searchTerms = (query: string) =>
  query
    .split(/[\s\0]+/u)
    .filter((word) => word !== "")
    .map((word) => `"${word.replaceAll('"', '""')}"`)
    .join(" ");

/**
 * The search page's address for a search, which is only ever given sanitized searches. Their spaces
 * become "+" and anything but ASCII letters, digits and "_" is escaped, as Ruby's CGI.escape writes
 * them, and as a form's query string reads them back.
 */
export const searchPath = (query: string) => `${SEARCHES_PATH}?q=${encodeURIComponent(query).replaceAll("%20", "+")}`;

/**
 * Parses what `POST /api/searches` takes, `{ q }`, the search typed in the search page's field. Returns
 * why it's refused instead.
 */
export function parseSearch(data: unknown): { q: string } | string {
  const q = typeof data === "object" && data !== null ? (data as Record<string, unknown>).q : undefined;
  if (typeof q !== "string") return "Searches have to be text";
  return q.length > MAX_SEARCH_LENGTH ? SEARCH_TOO_LONG : { q };
}

/** What `GET /api/searches` answers, and `POST /api/searches` once it has recorded the search. */
export interface SearchResults {
  /** What was searched for, sanitized, or null when there was nothing to search for. */
  query: string | null;
  /** The newest messages, up to `SEARCH_LIMIT`, in the rooms you're in that have every word, oldest first. */
  messages: Message[];
  /** The rooms they're in, as your sidebar lists them. */
  rooms: Room[];
  /** Your recent searches, up to `RECENT_SEARCHES`, newest first. */
  recent: string[];
}
