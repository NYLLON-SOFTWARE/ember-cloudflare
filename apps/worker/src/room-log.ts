import type { RoomId, UserId } from "@ember/protocol";
import { statement, type Db, type Statement } from "./db";

// Each room's change log (migrations/0010_room_events.sql), kept in the room's Durable Object SQLite
// storage or in D1 (see db.ts): what has happened in the room that the Workspace marks it unread and
// read by, and has yet to hear of.

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

  /** Forgets every event, as deleting the room does. */
  async forget(): Promise<void> {
    await this.db.run(`DELETE FROM room_events WHERE room_id = ?`, this.roomId);
  }
}
