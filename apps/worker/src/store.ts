import type { Boost, Message, RoomId, User } from "@ember/protocol";
import type { Env } from "./env";
import schema from "../migrations/0001_messages.sql";
import clientMessageIdIndex from "../migrations/0002_client_message_ids.sql";

// Messages for one room. The same SQL runs against the room's Durable Object SQLite
// storage or against D1, chosen by STORAGE_BACKEND; only the driver differs.

type Value = string | number | null;

interface Driver {
  all<T>(query: string, ...params: Value[]): Promise<T[]>;
  run(query: string, ...params: Value[]): Promise<void>;
}

function durableObjectDriver(sql: SqlStorage): Driver {
  return {
    async all<T>(query: string, ...params: Value[]) {
      return sql.exec(query, ...params).toArray() as T[];
    },
    async run(query: string, ...params: Value[]) {
      sql.exec(query, ...params);
    },
  };
}

function d1Driver(db: D1Database): Driver {
  return {
    async all<T>(query: string, ...params: Value[]) {
      return (await db.prepare(query).bind(...params).all<T>()).results;
    },
    async run(query: string, ...params: Value[]) {
      await db.prepare(query).bind(...params).run();
    },
  };
}

/** Picks the driver for a room and makes sure its tables exist. */
export function openStore(env: Env, state: DurableObjectState, roomId: RoomId): MessageStore {
  if (env.STORAGE_BACKEND === "d1") {
    if (!env.DB) throw new Error('STORAGE_BACKEND is "d1" but no D1 database is bound as DB in wrangler.jsonc.');
    return new MessageStore(d1Driver(env.DB), roomId);
  }
  state.storage.sql.exec(schema);
  state.storage.sql.exec(clientMessageIdIndex);
  return new MessageStore(durableObjectDriver(state.storage.sql), roomId);
}

interface MessageRow {
  id: string;
  client_message_id: string;
  creator_id: string;
  creator_name: string;
  body: string;
  created_at: string;
  updated_at: string;
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

export class MessageStore {
  constructor(
    private readonly db: Driver,
    readonly roomId: RoomId,
  ) {}

  /** The newest `limit` messages older than `before` (or the newest overall), oldest first. */
  async page(limit: number, before?: string): Promise<{ messages: Message[]; hasMore: boolean }> {
    const rows = await this.db.all<MessageRow>(
      `SELECT * FROM messages WHERE room_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`,
      this.roomId,
      before ?? null,
      before ?? null,
      limit + 1,
    );
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    return { messages: await this.withBoosts(page), hasMore };
  }

  async find(id: string): Promise<Message | null> {
    const rows = await this.db.all<MessageRow>(`SELECT * FROM messages WHERE room_id = ? AND id = ?`, this.roomId, id);
    const [message] = await this.withBoosts(rows);
    return message ?? null;
  }

  async create(id: string, clientMessageId: string, creator: User, body: string, now: string): Promise<Message> {
    await this.db.run(
      `INSERT INTO messages (id, room_id, client_message_id, creator_id, creator_name, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      this.roomId,
      clientMessageId,
      creator.id,
      creator.name,
      body,
      now,
      now,
    );
    return { id, clientMessageId, roomId: this.roomId, creator, body, createdAt: now, updatedAt: now, boosts: [] };
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

  async updateBody(id: string, body: string, now: string): Promise<void> {
    await this.db.run(`UPDATE messages SET body = ?, updated_at = ? WHERE room_id = ? AND id = ?`, body, now, this.roomId, id);
  }

  /** Its boosts go in the same statement, through ON DELETE CASCADE, so a failure keeps both. */
  async delete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM messages WHERE room_id = ? AND id = ?`, this.roomId, id);
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

  private async withBoosts(rows: MessageRow[]): Promise<Message[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const boosts = await this.db.all<BoostRow>(
      `SELECT * FROM boosts WHERE room_id = ? AND message_id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`,
      this.roomId,
      ...ids,
    );
    const byMessage = Map.groupBy(boosts.map(toBoost), (b) => b.messageId);
    return rows.map((row) => ({
      id: row.id,
      clientMessageId: row.client_message_id,
      roomId: this.roomId,
      creator: { id: row.creator_id, name: row.creator_name },
      body: row.body,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      boosts: byMessage.get(row.id) ?? [],
    }));
  }
}
