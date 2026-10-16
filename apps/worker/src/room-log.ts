import type { RoomId, UserId } from "@ember/protocol";
import { statement, type Db, type Statement } from "./db";

// Each room's change log (migrations/0010_room_events.sql), kept in the room's Durable Object SQLite
// storage or in D1 (see db.ts): what has happened in the room that the Workspace marks it unread and
// read by, and has yet to hear of. Beside it, the log of the messages the search index has yet to hear
// of (migrations/0021_unindexed_messages.sql).

/** Something that happened in a room that the Workspace keeps track of. */
export interface RoomEvent {
  /** Its place in the room's log, whose numbers only grow. */
  seq: number;
  /** A new message, or someone opening the room in a shown tab. */
  kind: "message" | "read";
  /** Who wrote the message, or read the room. */
  userId: UserId;
  /** When, as an ISO time: a message's is its `createdAt`. */
  at: string;
}

/** The oldest events a room's log holds, up to a number of them, which are the ones the Workspace hasn't applied. */
export const UNDELIVERED_EVENTS = `SELECT seq, kind, user_id AS userId, at FROM room_events WHERE room_id = ? ORDER BY seq LIMIT ?`;

/** Logs an event, for the batch that makes the change it records. */
export const logEvent = (roomId: RoomId, kind: RoomEvent["kind"], userId: UserId, at: string): Statement =>
  statement(`INSERT INTO room_events (room_id, kind, user_id, at) VALUES (?, ?, ?, ?)`, roomId, kind, userId, at);

/** A message written, edited or deleted that the search index has yet to hear of. */
export interface UnindexedMessage {
  /** Its place in the room's log of them, whose numbers only grow. */
  seq: number;
  messageId: string;
}

/** The oldest messages the search index has yet to hear of, up to a number of them. */
export const UNINDEXED_MESSAGES = `SELECT seq, message_id AS messageId FROM unindexed_messages WHERE room_id = ? ORDER BY seq LIMIT ?`;

/** Logs that a message was written, edited or deleted, for the search index, in the batch that makes the change. */
export const logIndexing = (roomId: RoomId, messageId: string): Statement =>
  statement(`INSERT INTO unindexed_messages (room_id, message_id) VALUES (?, ?)`, roomId, messageId);

/** The same for each of the messages whose ids a JSON array lists. */
export const logIndexingEach = (roomId: RoomId, listed: string): Statement =>
  statement(`INSERT INTO unindexed_messages (room_id, message_id) SELECT ?, value FROM json_each(?)`, roomId, listed);

export class RoomLog {
  constructor(
    private readonly db: Db,
    readonly roomId: RoomId,
  ) {}

  /** Logs that `userId` has read the room. */
  async read(userId: UserId, at: string): Promise<void> {
    const { query, params } = logEvent(this.roomId, "read", userId, at);
    await this.db.run(query, ...params);
  }

  /** The oldest `limit` events the Workspace hasn't applied, oldest first. */
  async undelivered(limit: number): Promise<RoomEvent[]> {
    return this.db.all<RoomEvent>(UNDELIVERED_EVENTS, this.roomId, limit);
  }

  /** Forgets the events up to `seq`, which the Workspace has applied. */
  async delivered(seq: number): Promise<void> {
    await this.db.run(`DELETE FROM room_events WHERE room_id = ? AND seq <= ?`, this.roomId, seq);
  }

  /** The oldest `limit` messages the search index has yet to hear of, oldest first. */
  async unindexed(limit: number): Promise<UnindexedMessage[]> {
    return this.db.all<UnindexedMessage>(UNINDEXED_MESSAGES, this.roomId, limit);
  }

  /** Forgets the messages up to `seq`, which the search index has taken. */
  async indexed(seq: number): Promise<void> {
    await this.db.run(`DELETE FROM unindexed_messages WHERE room_id = ? AND seq <= ?`, this.roomId, seq);
  }

  /** Logs every message the room has, oldest first, for the search index to take them all afresh. */
  async reindex(): Promise<void> {
    await this.db.run(`INSERT INTO unindexed_messages (room_id, message_id) SELECT room_id, id FROM messages WHERE room_id = ? ORDER BY id`, this.roomId);
  }

  /** Forgets every event, and every message the search index has yet to hear of, as deleting the room does. */
  async forget(): Promise<void> {
    await this.db.batch([statement(`DELETE FROM room_events WHERE room_id = ?`, this.roomId), statement(`DELETE FROM unindexed_messages WHERE room_id = ?`, this.roomId)]);
  }
}
