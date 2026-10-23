import { isSearchable, MAX_SEARCH_LENGTH, parseSearch, sanitizeSearch, SEARCH_TOO_LONG, searchTerms, type Message, type Room, type SearchResults } from "@ember/protocol";
import { eachAtMost, ROOMS_AT_ONCE } from "./at-once";
import { credentialsOf } from "./auth";
import { jsonBodyOf } from "./bodies";
import { sharedDb } from "./db";
import type { Env } from "./env";
import { urlOf } from "./request-url";
import { searchIndex, type SearchHit } from "./search-index";
import { indexedMessages, messagesAnywhereWithIds } from "./store";
import { workspace, type Searcher } from "./workspace";

// Searching messages, and recent searches, as ember-rust's searches do (crates/ember/src/controllers/searches.rs).

const problem = (status: number, message: string) => Response.json({ error: message }, { status });

const NOT_SIGNED_IN = "Not signed in";

/**
 * `GET /api/searches?q=`: the newest `SEARCH_LIMIT` messages with every word of `q`, oldest first, in the
 * rooms you're in, the ones you've hidden and DMs too, with those rooms, and your recent searches, as
 * ember-rust's search page lists them (`searches#index`). Only a search with a word left once it's
 * sanitized is run, and none is recorded.
 */
export async function searchMessages(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const searcher = credentials && (await workspace(env).searcher(credentials, null));
  if (!searcher) return problem(401, NOT_SIGNED_IN);
  const q = urlOf(request).searchParams.get("q") ?? "";
  if (q.length > MAX_SEARCH_LENGTH) return problem(422, SEARCH_TOO_LONG);
  return answer(env, sanitizeSearch(q), searcher);
}

/**
 * `POST /api/searches`, `{ q }`: records `q`, sanitized, as your newest recent search, as the search
 * page's form does in ember-rust (`searches#create`), and answers as `GET` does for it. A search with no
 * word left once it's sanitized isn't recorded, where ember-rust records it, spaces and all, and lists it
 * as `“   ”`.
 */
export async function recordSearch(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const search = parseSearch(await jsonBodyOf(request));
  const query = typeof search === "string" ? "" : sanitizeSearch(search.q);
  // Asked even for a search that's refused, so that someone signed out hears that first.
  const searcher = credentials && (await workspace(env).searcher(credentials, isSearchable(query) ? query : null));
  if (!searcher) return problem(401, NOT_SIGNED_IN);
  if (typeof search === "string") return problem(422, search);
  return answer(env, query, searcher);
}

/** `DELETE /api/searches`: forgets your recent searches, as ember-rust's `searches#clear` does. */
export async function clearSearches(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials || !(await workspace(env).clearSearches(credentials))) return problem(401, NOT_SIGNED_IN);
  return new Response(null, { status: 204 });
}

/** What a search for `query`, sanitized, answers: what it finds, if it has a word in it, and the searcher's recent searches. */
async function answer(env: Env, query: string, { rooms, recent }: Searcher): Promise<Response> {
  const found = isSearchable(query) ? await search(env, query, rooms) : { query: null, messages: [], rooms: [] };
  return Response.json({ ...found, recent } satisfies SearchResults, { headers: { "Cache-Control": "no-store" } });
}

/** The messages in `rooms` that have every word of `query`, a sanitized search with a word in it. */
async function search(env: Env, query: string, rooms: Room[]): Promise<Omit<SearchResults, "recent">> {
  const hits = await searchIndex(env).search(searchTerms(query), rooms.map(({ id }) => id));
  const messages = await messagesOf(env, hits);
  const found = new Set(messages.map(({ roomId }) => roomId));
  return { query, messages, rooms: rooms.filter(({ id }) => found.has(id)) };
}

/**
 * The messages `hits` names, oldest first where the hits are newest first, as the index last took them,
 * so a search asks no room: an edit or a boost shows, and a deleted message goes, once its room has sent
 * it, as a match does. A hit the index has no message for, from before it kept them or too big to keep,
 * is read from its room as it is now, and left out if its room no longer has it.
 */
async function messagesOf(env: Env, hits: SearchHit[]): Promise<Message[]> {
  const kept = hits.flatMap(({ message }) => message ?? []);
  const [indexed, read] = await Promise.all([indexedMessages(kept, env.SESSION_SECRET), readNow(env, hits.filter(({ message }) => message === null))]);
  const found = new Map([...indexed, ...read].map((message) => [message.id, message]));
  return hits.toReversed().flatMap(({ messageId }) => found.get(messageId) ?? []);
}

/** The messages `hits` names that are still there: from D1 at once, where every room keeps them, or else from each room once. */
async function readNow(env: Env, hits: SearchHit[]): Promise<Message[]> {
  if (hits.length === 0) return [];
  const db = sharedDb(env);
  if (db) return messagesAnywhereWithIds(db, hits.map(({ messageId }) => messageId), env.SESSION_SECRET);
  const messages: Message[] = [];
  await eachAtMost([...Map.groupBy(hits, ({ roomId }) => roomId)], ROOMS_AT_ONCE, async ([roomId, inRoom]) => {
    messages.push(...(await env.CHAT_ROOM.getByName(roomId).messagesWithIds(roomId, inRoom.map(({ messageId }) => messageId))));
  });
  return messages;
}
