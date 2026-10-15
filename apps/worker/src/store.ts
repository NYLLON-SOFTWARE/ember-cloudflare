import type { Boost, Message, RoomId, User, UserId } from "@ember/protocol";
import type { PreparedBody } from "@ember/richtext";
import { statement, type Db } from "./db";
import { logEvent } from "./room-log";

// Messages for one room, kept in the room's Durable Object SQLite storage or in D1 (see db.ts).

interface MessageRow {
  id: string;
  client_message_id: string;
  creator_id: string;
  creator_name: string;
  body: string;
  plain_text: string;
  /** A JSON array of the mentioned users' ids. */
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

// The newest page and the page before a message are separate statements, as ember-rust's
// `last_page` and `page_before` are: SQLite can't seek an index through `? IS NULL OR id < ?`, so a
// single statement walked the room from its newest message down to the cursor.
export const NEWEST_MESSAGES = `${SELECT_MESSAGES} WHERE room_id = ? ORDER BY id DESC LIMIT ?`;
export const MESSAGES_BEFORE = `${SELECT_MESSAGES} WHERE room_id = ? AND id < ? ORDER BY id DESC LIMIT ?`;

export class MessageStore {
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
    const hasMore = rows.length > limit;
    return { messages: rows.slice(0, limit).reverse().map((row) => this.toMessage(row)), hasMore };
  }

  async find(id: string): Promise<Message | null> {
    const [row] = await this.db.all<MessageRow>(`${SELECT_MESSAGES} WHERE room_id = ? AND id = ?`, this.roomId, id);
    return row ? this.toMessage(row) : null;
  }

  /** Stores a new message, logging it in the same transaction for the Workspace to mark the room unread by. */
  async create(id: string, clientMessageId: string, creator: User, body: PreparedBody, now: string): Promise<Message> {
    await this.db.batch([
      statement(
        `INSERT INTO messages (id, room_id, client_message_id, creator_id, creator_name, body, plain_text, mentions, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ),
      logEvent(this.roomId, "message", creator.id, now),
    ]);
    return {
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

  /** Replaces a message's text, which marks it edited, and answers the message as it is now. */
  async updateBody(message: Message, body: PreparedBody, now: string): Promise<Message> {
    await this.db.run(
      `UPDATE messages SET body = ?, plain_text = ?, mentions = ?, updated_at = ?, edited_at = ? WHERE room_id = ? AND id = ?`,
      body.html,
      body.plainText,
      JSON.stringify(body.mentions),
      now,
      now,
      this.roomId,
      message.id,
    );
    return { ...message, body: body.html, plainText: body.plainText, mentions: body.mentions, updatedAt: now, editedAt: now };
  }

  /** Its boosts go in the same statement, through ON DELETE CASCADE, so a failure keeps both. */
  async delete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM messages WHERE room_id = ? AND id = ?`, this.roomId, id);
  }

  /** Deletes every message here, and through ON DELETE CASCADE their boosts, as deleting the room does. */
  async deleteAllMessages(): Promise<void> {
    await this.db.run(`DELETE FROM messages WHERE room_id = ?`, this.roomId);
  }

  async addBoost(id: string, messageId: string, booster: User, content: string, now: string): Promise<Boost> {
    await this.db.run(
      `INSERT INTO boosts (id, room_id, message_id, booster_id, booster_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      this.roomId,
      messageId,
      booster.id,
      booster.name,
      content,
      now,
    );
    return { id, messageId, booster, content, createdAt: now };
  }

  async findBoost(id: string): Promise<Boost | null> {
    const [row] = await this.db.all<BoostRow>(`SELECT * FROM boosts WHERE room_id = ? AND id = ?`, this.roomId, id);
    return row ? toBoost(row) : null;
  }

  async removeBoost(id: string): Promise<void> {
    await this.db.run(`DELETE FROM boosts WHERE room_id = ? AND id = ?`, this.roomId, id);
  }

  private toMessage(row: MessageRow): Message {
    return {
      id: row.id,
      clientMessageId: row.client_message_id,
      roomId: this.roomId,
      creator: { id: row.creator_id, name: row.creator_name },
      body: row.body,
      plainText: row.plain_text,
      mentions: JSON.parse(row.mentions) as UserId[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      editedAt: row.edited_at,
      // json_group_array doesn't promise an order, so sort here rather than in the subquery.
      boosts: (JSON.parse(row.boosts) as BoostRow[]).map(toBoost).sort(byId),
    };
  }
}
