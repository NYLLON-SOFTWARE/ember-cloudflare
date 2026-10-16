import { isSearchable, MAX_SEARCH_LENGTH, sanitizeSearch, SEARCH_TOO_LONG, searchTerms, type Message, type Room, type SearchResults } from "@ember/protocol";
import { eachAtMost, ROOMS_AT_ONCE } from "./at-once";
import { credentialsOf } from "./auth";
import { sharedDb } from "./db";
import type { Env } from "./env";
import { searchIndex, type SearchHit } from "./search-index";
import { messagesAnywhereWithIds } from "./store";
import { workspace } from "./workspace";

// Searching messages, as ember-rust's searches do (crates/ember/src/controllers/searches.rs).

const problem = (status: number, message: string) => Response.json({ error: message }, { status });

/**
 * `GET /api/searches?q=`: the newest `SEARCH_LIMIT` messages with every word of `q`, oldest first, in the
 * rooms you're in, the ones you've hidden and DMs too, with those rooms, as ember-rust's search page
 * lists them (`searches#index`). Only a search with a word left once it's sanitized is run.
 */
export async function searchMessages(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const rooms = credentials && (await workspace(env).searchableRooms(credentials));
  if (!rooms) return problem(401, "Not signed in");
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.length > MAX_SEARCH_LENGTH) return problem(422, SEARCH_TOO_LONG);
  const query = sanitizeSearch(q);
  const results = isSearchable(query) ? await search(env, query, rooms) : ({ query: null, messages: [], rooms: [] } satisfies SearchResults);
  return Response.json(results, { headers: { "Cache-Control": "no-store" } });
}

/** The messages in `rooms` that have every word of `query`, a sanitized search with a word in it. */
async function search(env: Env, query: string, rooms: Room[]): Promise<SearchResults> {
  const hits = await searchIndex(env).search(searchTerms(query), rooms.map(({ id }) => id));
  const messages = await messagesOf(env, hits);
  const found = new Set(messages.map(({ roomId }) => roomId));
  return { query, messages, rooms: rooms.filter(({ id }) => found.has(id)) };
}

/**
 * The messages `hits` names, as they are now, oldest first where the hits are newest first, leaving out
 * any deleted since the index heard of them.
 */
async function messagesOf(env: Env, hits: SearchHit[]): Promise<Message[]> {
  const found = new Map((await read(env, hits)).map((message) => [message.id, message]));
  return hits.toReversed().flatMap(({ messageId }) => found.get(messageId) ?? []);
}

/** The messages `hits` names that are still there: from D1 at once, where every room keeps them, or else from each room once. */
async function read(env: Env, hits: SearchHit[]): Promise<Message[]> {
  const db = sharedDb(env);
  if (db) return messagesAnywhereWithIds(db, hits.map(({ messageId }) => messageId));
  const messages: Message[] = [];
  await eachAtMost([...Map.groupBy(hits, ({ roomId }) => roomId)], ROOMS_AT_ONCE, async ([roomId, inRoom]) => {
    messages.push(...(await env.CHAT_ROOM.getByName(roomId).messagesWithIds(roomId, inRoom.map(({ messageId }) => messageId))));
  });
  return messages;
}
