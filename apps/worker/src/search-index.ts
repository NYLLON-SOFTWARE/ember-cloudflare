import { SEARCH_LIMIT, type RoomId } from "@ember/protocol";
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { migrate } from "./migrations";

// The search index (search-migrations/0001_search_index.sql): every message's plain text in one FTS5 table,
// which rooms keep up to date from their logs of the messages written, edited and deleted (room-log.ts).

/** What the index keeps of a message: when it was written, which orders the index, and its plain text. */
export interface IndexedMessage {
  id: string;
  createdAt: string;
  text: string;
}

/** A message that has every word searched for, in a room. */
export interface SearchHit {
  messageId: string;
  roomId: RoomId;
}

/**
 * How many of the newest matches a search reads, in rooms the searcher is in or not, before it asks for
 * only the ones in theirs, as ember-rust's `SEARCH_PROBE_LIMIT` (message.rs).
 */
export const SEARCH_PROBE_LIMIT = 1_000;

/** How many messages of a millisecond the index can number apart (search-migrations/0001_search_index.sql). */
const PER_MILLISECOND = 1024;

/** What a deleted room's place in its log becomes, past any call it made before. */
const FORGOTTEN = Number.MAX_SAFE_INTEGER;

/**
 * ember-rust's search probe (`search_reachable_sql`, message.rs): the newest `SEARCH_PROBE_LIMIT` matches
 * of ?1, the FTS5 query, wherever they are, each saying whether it's in one of the rooms the JSON array
 * ?2 lists. It walks the index from its largest number, with nothing to sort, so it reads only as many
 * as are read from it.
 */
export const SEARCH_PROBE = `SELECT search_messages.message_id AS messageId, search_messages.room_id AS roomId,
    search_messages.room_id IN (SELECT value FROM json_each(?2)) AS reachable
  FROM search_index JOIN search_messages ON search_messages.id = search_index.rowid
  WHERE search_index MATCH ?1 ORDER BY search_index.rowid DESC LIMIT ${SEARCH_PROBE_LIMIT}`;

/**
 * ember-rust's search when the probe fills up with matches in rooms the searcher isn't in: the newest
 * `SEARCH_LIMIT` matches of ?1 in the rooms ?2 lists, by whichever plan SQLite finds, such as looking at
 * just those rooms' messages.
 */
export const SEARCH_ROOMS = `SELECT search_messages.message_id AS messageId, search_messages.room_id AS roomId
  FROM search_messages JOIN search_index ON search_index.rowid = search_messages.id
  WHERE search_messages.room_id IN (SELECT value FROM json_each(?2)) AND search_index MATCH ?1
  ORDER BY search_messages.id DESC LIMIT ${SEARCH_LIMIT}`;

/**
 * The largest number given yet to a message of each millisecond the JSON array ?1 lists as its first
 * number, if any has one.
 */
const LATEST_NUMBERS = `SELECT firsts.value AS first, (SELECT max(id) FROM search_messages WHERE id BETWEEN firsts.value AND firsts.value + ${PER_MILLISECOND - 1}) AS latest
  FROM json_each(?1) AS firsts`;

/** The first number a message of the millisecond of `createdAt` can have. */
const firstNumber = (createdAt: string) => Date.parse(createdAt) * PER_MILLISECOND;

const byTime = (a: IndexedMessage, b: IndexedMessage) => firstNumber(a.createdAt) - firstNumber(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Searches every room's messages at once, as ember-rust's one index does, so a search costs one query
 * however many rooms someone is in. It has an object of its own, as an FTS5 query over a large index
 * can take milliseconds, which nothing else should wait for, and its tables live in its own storage
 * even when everyone else's are in D1 (`SEARCH_MIGRATIONS`). So it reads and writes them through the
 * storage's own SQL, whose queries run at once and whose results can be read a row at a time.
 */
export class SearchIndex extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    migrate(ctx.storage, "search");
    this.sql = ctx.storage.sql;
  }

  /**
   * Takes room `roomId`'s log up to its change `seq`: `messages`, as they are now, and the messages
   * `deletedIds` names, which are gone. A message keeps its number when it's edited. A call the room made
   * before one the index has taken, or after the room was deleted, changes nothing. It's one transaction,
   * and nothing can run between its reads and its writes, which never wait.
   */
  apply(roomId: RoomId, seq: number, messages: IndexedMessage[], deletedIds: string[]): void {
    this.ctx.storage.transactionSync(() => {
      const [taken] = this.sql.exec<{ seq: number }>(`SELECT seq FROM search_rooms WHERE room_id = ?`, roomId).toArray();
      if (taken && taken.seq >= seq) return;
      const listed = JSON.stringify(messages.map(({ id }) => id));
      const indexed = this.sql.exec<{ message_id: string }>(`SELECT message_id FROM search_messages WHERE message_id IN (SELECT value FROM json_each(?))`, listed);
      const known = new Set(indexed.toArray().map((row) => row.message_id));
      const added = this.numbered(messages.filter(({ id }) => !known.has(id)));
      this.sql.exec(
        `DELETE FROM search_index WHERE rowid IN (SELECT id FROM search_messages WHERE message_id IN (SELECT value FROM json_each(?)))`,
        JSON.stringify([...known, ...deletedIds]),
      );
      this.sql.exec(`DELETE FROM search_messages WHERE message_id IN (SELECT value FROM json_each(?))`, JSON.stringify(deletedIds));
      this.sql.exec(
        `INSERT INTO search_messages (id, message_id, room_id) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), ? FROM json_each(?)`,
        roomId,
        JSON.stringify(added),
      );
      // A message each, since a JSON array of them all could pass the 2 MB a value can take.
      for (const { id, text } of messages) this.sql.exec(`INSERT INTO search_index (rowid, body) SELECT id, ? FROM search_messages WHERE message_id = ?`, text, id);
      this.sql.exec(`INSERT INTO search_rooms (room_id, seq) VALUES (?, ?) ON CONFLICT (room_id) DO UPDATE SET seq = excluded.seq`, roomId, seq);
    });
  }

  /**
   * Numbers each of `messages` after the latest number of its millisecond, or as its first, oldest first,
   * as `[number, id]`. A millisecond can number 1,024 apart; one with more leaves the rest out, as it does
   * a message whose time can't be read.
   */
  private numbered(messages: IndexedMessage[]): Array<[number, string]> {
    const firsts = JSON.stringify([...new Set(messages.map(({ createdAt }) => firstNumber(createdAt)))]);
    const numbers = this.sql.exec<{ first: number; latest: number | null }>(LATEST_NUMBERS, firsts).toArray();
    const latest = new Map(numbers.map(({ first, latest }) => [first, latest]));
    const added: Array<[number, string]> = [];
    for (const message of messages.sort(byTime)) {
      const first = firstNumber(message.createdAt);
      if (Number.isNaN(first)) {
        console.warn(`Left message ${message.id} out of the search index: its time, ${message.createdAt}, can't be read`);
        continue;
      }
      const previous = latest.get(first);
      const number = previous === null || previous === undefined ? first : previous + 1;
      if (number >= first + PER_MILLISECOND) {
        console.warn(`Left message ${message.id} out of the search index: more than ${PER_MILLISECOND} were written in its millisecond`);
        continue;
      }
      latest.set(first, number);
      added.push([number, message.id]);
    }
    return added;
  }

  /**
   * Forgets room `roomId`'s messages, as deleting the room does, and keeps any call it made before from
   * putting them back.
   */
  forget(roomId: RoomId): void {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM search_index WHERE rowid IN (SELECT id FROM search_messages WHERE room_id = ?)`, roomId);
      this.sql.exec(`DELETE FROM search_messages WHERE room_id = ?`, roomId);
      this.sql.exec(`INSERT INTO search_rooms (room_id, seq) VALUES (?, ?) ON CONFLICT (room_id) DO UPDATE SET seq = excluded.seq`, roomId, FORGOTTEN);
    });
  }

  /**
   * The newest `SEARCH_LIMIT` messages, newest first, in the rooms `roomIds` lists that match `terms`, an
   * FTS5 query, as ember-rust's `search_reachable` finds them (message.rs): from the probe, read a match
   * at a time until the page is full, unless it holds that many matches outside those rooms that the
   * page may not be.
   */
  search(terms: string, roomIds: RoomId[]): SearchHit[] {
    // FTS5 refuses an empty query.
    if (terms === "") return [];
    const rooms = JSON.stringify(roomIds);
    const page: SearchHit[] = [];
    let examined = 0;
    for (const { messageId, roomId, reachable } of this.sql.exec<{ messageId: string; roomId: RoomId; reachable: number }>(SEARCH_PROBE, terms, rooms)) {
      examined++;
      if (reachable === 1 && page.push({ messageId, roomId }) === SEARCH_LIMIT) return page;
    }
    // Reading every match also shows that a short page is all there is.
    if (examined < SEARCH_PROBE_LIMIT) return page;
    return this.sql.exec<{ messageId: string; roomId: RoomId }>(SEARCH_ROOMS, terms, rooms).toArray();
  }
}

export const searchIndex = (env: Env) => env.SEARCH_INDEX.getByName("search");
