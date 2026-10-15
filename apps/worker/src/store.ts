import type { Boost, Message, RoomId, TimelinePage, User, UserId } from "@ember/protocol";
import type { PreparedBody } from "@ember/richtext";
import { statement, type Db, type Statement } from "./db";
import { logEvent } from "./room-log";

// Messages for one room, kept in the room's Durable Object SQLite storage or in D1 (see db.ts), each
// with the number of its latest change, and the deletions a tab that connects again may yet need to
// hear of (migrations/0015_numbered_changes.sql).

interface MessageRow {
  id: string;
  client_message_id: string;
  creator_id: string;
  creator_name: string;
  body: string;
  plain_text: string;
  /**
   * A JSON array of the people it mentions, each `{ "id", "name" }` as they were when its text was last
   * written, or each an id alone in a row from before mentions kept names.
   */
  mentions: string;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  /** The message's boosts, a JSON array of `BoostRow`s. */
  boosts: string;
}

interface BoostRow {
  id: string;
  message_id: string;
  booster_id: string;
  booster_name: string;
  content: string;
  created_at: string;
}

/** The ids go as one JSON value, since both backends bind at most 100 values a statement. */
export const STORED_CLIENT_MESSAGE_IDS = `SELECT client_message_id FROM messages
  WHERE room_id = ? AND creator_id = ? AND client_message_id IN (SELECT value FROM json_each(?))`;

/** Up to a number of someone's messages, in no particular order, read through the same index as the above. */
export const MESSAGES_BY = `SELECT id FROM messages WHERE room_id = ? AND creator_id = ? LIMIT ?`;

const toBoost = (row: BoostRow): Boost => ({
  id: row.id,
  messageId: row.message_id,
  booster: { id: row.booster_id, name: row.booster_name },
  content: row.content,
  createdAt: row.created_at,
});

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Messages with their boosts gathered by a subquery, so a page is one statement: one round trip to
 * D1, and no list of message ids to bind (both backends bind at most 100 values a statement).
 */
const SELECT_MESSAGES = `SELECT messages.*, (
    SELECT json_group_array(json_object('id', boosts.id, 'message_id', boosts.message_id, 'booster_id', boosts.booster_id,
      'booster_name', boosts.booster_name, 'content', boosts.content, 'created_at', boosts.created_at))
    FROM boosts WHERE boosts.message_id = messages.id
  ) AS boosts FROM messages`;

// The newest page and the pages before and after a message are separate statements, as ember-rust's
// `last_page`, `page_before` and `page_after` are: SQLite can't seek an index through
// `? IS NULL OR id < ?`, so a single statement walked the room from its newest message down to the cursor.
export const NEWEST_MESSAGES = `${SELECT_MESSAGES} WHERE room_id = ? ORDER BY id DESC LIMIT ?`;
export const MESSAGES_BEFORE = `${SELECT_MESSAGES} WHERE room_id = ? AND id < ? ORDER BY id DESC LIMIT ?`;
export const MESSAGES_AFTER = `${SELECT_MESSAGES} WHERE room_id = ? AND id > ? ORDER BY id LIMIT ?`;

/**
 * How many changes behind a tab that connects again can be and still catch up, which is as long as the
 * room keeps a deleted message's id. One further behind gets the newest page, as a new tab does.
 */
export const CHANGES_KEPT = 100;

/** The room's latest change, or 0 before its first: the latest a message carries, or a deletion's after it. */
export const LATEST_CHANGE = `SELECT MAX(
    COALESCE((SELECT MAX(change_seq) FROM messages WHERE room_id = ?), 0),
    COALESCE((SELECT MAX(seq) FROM message_deletions WHERE room_id = ?), 0)
  ) AS seq`;
/**
 * The messages changed after a change, as they are now, in the order of their latest changes, which
 * their index holds, so the room reads only those, however many it has.
 */
export const MESSAGES_CHANGED_SINCE = `${SELECT_MESSAGES} WHERE room_id = ? AND change_seq > ? ORDER BY change_seq`;
/** The messages deleted after a change. */
export const MESSAGES_DELETED_SINCE = `SELECT message_id FROM message_deletions WHERE room_id = ? AND seq > ? ORDER BY seq`;

/** What changed in a room after a change a tab has seen, and the latest change. */
export interface Changes {
  /** The messages changed since, as they are now, oldest first. */
  messages: Message[];
  /** The ids of the messages deleted since, including any made since. */
  deletedIds: string[];
  seq: number;
}

export class MessageStore {
  /**
   * The room's latest change, read once and then counted here, since the room is the only writer of
   * its messages; null until read, and again after a batch fails, which D1 may have saved all the same.
   */
  private seq: number | null = null;

  constructor(
    private readonly db: Db,
    readonly roomId: RoomId,
  ) {}

  /** The newest `limit` messages older than `before` (or the newest overall), oldest first. */
  async page(limit: number, before?: string): Promise<{ messages: Message[]; hasMore: boolean }> {
    const rows =
      before === undefined
        ? await this.db.all<MessageRow>(NEWEST_MESSAGES, this.roomId, limit + 1)
        : await this.db.all<MessageRow>(MESSAGES_BEFORE, this.roomId, before, limit + 1);
    return this.toPage(rows, limit);
  }

  /** The oldest `limit` messages newer than `after`, oldest first, and whether there are newer ones still. */
  async after(limit: number, after: string): Promise<{ messages: Message[]; hasNewer: boolean }> {
    const rows = await this.db.all<MessageRow>(MESSAGES_AFTER, this.roomId, after, limit + 1);
    return { messages: rows.slice(0, limit).map((row) => this.toMessage(row)), hasNewer: rows.length > limit };
  }

  /**
   * The page around the message `id`, as ember-rust's `page_around` reads it: up to `limit` messages before
   * it, it, and up to `limit` after, or null when the room doesn't have it.
   */
  async around(id: string, limit: number): Promise<TimelinePage | null> {
    const [message, before, after] = await Promise.all([this.find(id), this.page(limit, id), this.after(limit, id)]);
    if (!message) return null;
    return { messages: [...before.messages, message, ...after.messages], hasMore: before.hasMore, hasNewer: after.hasNewer, around: id };
  }

  /**
   * A page to show in place of a timeline: the one around the message `around` names, if the room has it,
   * or else the newest `limit` messages, as ember-rust's rooms#show picks.
   */
  async timeline(limit: number, around?: string): Promise<TimelinePage> {
    const page = around === undefined ? null : await this.around(around, limit);
    return page ?? { ...(await this.page(limit)), hasNewer: false, around: null };
  }

  /**
   * `timeline`'s page and the room's latest change, for a welcome. The room is the only writer of its
   * messages and changes them one event at a time, so the two agree.
   */
  async opening(limit: number, around?: string): Promise<TimelinePage & { seq: number }> {
    const [page, seq] = await Promise.all([this.timeline(limit, around), this.latestChange()]);
    return { ...page, seq };
  }

  /**
   * What changed after the room's change `since`, for a tab that has seen it, or null if the room can't
   * say: `since` is later than its latest change, or more than `CHANGES_KEPT` behind it.
   */
  async changesSince(since: number): Promise<Changes | null> {
    const seq = await this.latestChange();
    if (since > seq || seq - since > CHANGES_KEPT) return null;
    const [rows, deleted] = await Promise.all([
      this.db.all<MessageRow>(MESSAGES_CHANGED_SINCE, this.roomId, since),
      this.db.all<{ message_id: string }>(MESSAGES_DELETED_SINCE, this.roomId, since),
    ]);
    return { messages: rows.map((row) => this.toMessage(row)).sort(byId), deletedIds: deleted.map((row) => row.message_id), seq };
  }

  async find(id: string): Promise<Message | null> {
    const [row] = await this.db.all<MessageRow>(`${SELECT_MESSAGES} WHERE room_id = ? AND id = ?`, this.roomId, id);
    return row ? this.toMessage(row) : null;
  }

  /**
   * Stores a new message, logging it in the same transaction for the Workspace to mark the room unread
   * by, and answers it with the change's number.
   */
  async create(id: string, clientMessageId: string, creator: User, body: PreparedBody, now: string): Promise<{ message: Message; seq: number }> {
    const seq = await this.change((seq) => [
      statement(
        `INSERT INTO messages (id, room_id, client_message_id, creator_id, creator_name, body, plain_text, mentions, created_at, updated_at, change_seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        this.roomId,
        clientMessageId,
        creator.id,
        creator.name,
        body.html,
        body.plainText,
        JSON.stringify(body.mentions),
        now,
        now,
        seq,
      ),
      logEvent(this.roomId, "message", creator.id, now),
    ]);
    return {
      message: {
        id,
        clientMessageId,
        roomId: this.roomId,
        creator,
        body: body.html,
        plainText: body.plainText,
        mentions: body.mentions,
        createdAt: now,
        updatedAt: now,
        editedAt: null,
        boosts: [],
      },
      seq,
    };
  }

  /** Which of `clientMessageIds` the room has stored from `creator`. */
  async storedClientMessageIds(creator: User, clientMessageIds: string[]): Promise<string[]> {
    const rows = await this.db.all<Pick<MessageRow, "client_message_id">>(
      STORED_CLIENT_MESSAGE_IDS,
      this.roomId,
      creator.id,
      JSON.stringify(clientMessageIds),
    );
    return rows.map((row) => row.client_message_id);
  }

  /** Everyone who wrote or reacted here, under each name they did it with. */
  async authors(): Promise<User[]> {
    return this.db.all<User>(
      `SELECT creator_id AS id, creator_name AS name FROM messages WHERE room_id = ?
       UNION SELECT booster_id, booster_name FROM boosts WHERE room_id = ?`,
      this.roomId,
      this.roomId,
    );
  }

  /**
   * Replaces a message's text, which marks it edited, and answers the message as it is now with the
   * change's number, as the methods below that change a message answer theirs.
   */
  async updateBody(message: Message, body: PreparedBody, now: string): Promise<{ message: Message; seq: number }> {
    const seq = await this.change((seq) => [
      statement(
        `UPDATE messages SET body = ?, plain_text = ?, mentions = ?, updated_at = ?, edited_at = ?, change_seq = ? WHERE room_id = ? AND id = ?`,
        body.html,
        body.plainText,
        JSON.stringify(body.mentions),
        now,
        now,
        seq,
        this.roomId,
        message.id,
      ),
    ]);
    return { message: { ...message, body: body.html, plainText: body.plainText, mentions: body.mentions, updatedAt: now, editedAt: now }, seq };
  }

  /** The ids of up to `limit` of `creatorId`'s messages here. */
  async messageIdsBy(creatorId: UserId, limit: number): Promise<string[]> {
    return (await this.db.all<{ id: string }>(MESSAGES_BY, this.roomId, creatorId, limit)).map((row) => row.id);
  }

  /**
   * Deletes the messages `ids` names, each a change of its own, numbered in the order they're named,
   * and answers the first's number. Their boosts go in the same statement, through ON DELETE CASCADE,
   * so a failure keeps both. Their ids stay with their deletions' numbers, and the deletions that fall
   * out of the latest `CHANGES_KEPT` go. The ids go as one JSON value, which a page of them can fill.
   */
  async delete(ids: string[]): Promise<number> {
    const listed = JSON.stringify(ids);
    return this.change(
      (seq) => [
        statement(`DELETE FROM messages WHERE room_id = ? AND id IN (SELECT value FROM json_each(?))`, this.roomId, listed),
        statement(`INSERT INTO message_deletions (room_id, seq, message_id) SELECT ?, ? + key, value FROM json_each(?)`, this.roomId, seq, listed),
        statement(`DELETE FROM message_deletions WHERE room_id = ? AND seq <= ?`, this.roomId, seq + ids.length - 1 - CHANGES_KEPT),
      ],
      ids.length,
    );
  }

  /**
   * Deletes every message here, and through ON DELETE CASCADE their boosts, as deleting the room does,
   * and the deletions it kept, since no tab can connect to it again.
   */
  async deleteAllMessages(): Promise<void> {
    await this.db.batch([statement(`DELETE FROM messages WHERE room_id = ?`, this.roomId), statement(`DELETE FROM message_deletions WHERE room_id = ?`, this.roomId)]);
    this.seq = null;
  }

  async addBoost(id: string, messageId: string, booster: User, content: string, now: string): Promise<{ boost: Boost; seq: number }> {
    const seq = await this.change((seq) => [
      statement(
        `INSERT INTO boosts (id, room_id, message_id, booster_id, booster_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        this.roomId,
        messageId,
        booster.id,
        booster.name,
        content,
        now,
      ),
      this.numbered(messageId, seq),
    ]);
    return { boost: { id, messageId, booster, content, createdAt: now }, seq };
  }

  async findBoost(id: string): Promise<Boost | null> {
    const [row] = await this.db.all<BoostRow>(`SELECT * FROM boosts WHERE room_id = ? AND id = ?`, this.roomId, id);
    return row ? toBoost(row) : null;
  }

  async removeBoost(boost: Boost): Promise<number> {
    return this.change((seq) => [statement(`DELETE FROM boosts WHERE room_id = ? AND id = ?`, this.roomId, boost.id), this.numbered(boost.messageId, seq)]);
  }

  /**
   * Makes `count` changes to the room's messages, numbered from the next after its latest, with the
   * statements `making` gives for the first number, in one batch, and answers that number.
   */
  private async change(making: (seq: number) => Statement[], count = 1): Promise<number> {
    const seq = (await this.latestChange()) + 1;
    try {
      await this.db.batch(making(seq));
    } catch (error) {
      this.seq = null;
      throw error;
    }
    this.seq = seq + count - 1;
    return seq;
  }

  /** Gives message `messageId` the number of a change to its reactions. */
  private numbered(messageId: string, seq: number): Statement {
    return statement(`UPDATE messages SET change_seq = ? WHERE room_id = ? AND id = ?`, seq, this.roomId, messageId);
  }

  private async latestChange(): Promise<number> {
    this.seq ??= (await this.db.all<{ seq: number }>(LATEST_CHANGE, this.roomId, this.roomId))[0]!.seq;
    return this.seq;
  }

  /** Rows read newest first, one more than `limit` if there are more, as a page oldest first. */
  private toPage(rows: MessageRow[], limit: number): { messages: Message[]; hasMore: boolean } {
    return { messages: rows.slice(0, limit).reverse().map((row) => this.toMessage(row)), hasMore: rows.length > limit };
  }

  private toMessage(row: MessageRow): Message {
    return {
      id: row.id,
      clientMessageId: row.client_message_id,
      roomId: this.roomId,
      creator: { id: row.creator_id, name: row.creator_name },
      body: row.body,
      plainText: row.plain_text,
      mentions: (JSON.parse(row.mentions) as (User | UserId)[]).map((person) => (typeof person === "string" ? { id: person, name: "" } : person)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      editedAt: row.edited_at,
      // json_group_array doesn't promise an order, so sort here rather than in the subquery.
      boosts: (JSON.parse(row.boosts) as BoostRow[]).map(toBoost).sort(byId),
    };
  }
}
