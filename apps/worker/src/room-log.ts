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
  /**
   * A new message as it is when the room sends the event, for its pushes, unless it has been deleted
   * since, as ember-rust's push job finds it again (jobs.rs), or was logged before events named it.
   */
  message?: PushedMessage;
}

/** What a new message's pushes say, and whom they go to at @mentions. */
export interface PushedMessage {
  id: string;
  plainText: string;
  /** Everyone it mentions, once each. */
  mentionIds: UserId[];
}

/**
 * The oldest events a room's log holds, up to a number of them, which are the ones the Workspace hasn't
 * applied, with each new message's text and mentions as they are now, by the message's key.
 */
export const UNDELIVERED_EVENTS = `SELECT room_events.seq, room_events.kind, room_events.user_id AS userId, room_events.at,
    messages.id AS messageId, messages.plain_text AS plainText, messages.mentions
  FROM room_events LEFT JOIN messages ON messages.id = room_events.message_id
  WHERE room_events.room_id = ? ORDER BY room_events.seq LIMIT ?`;

interface EventRow extends Omit<RoomEvent, "message"> {
  messageId: string | null;
  plainText: string | null;
  /** A JSON array of the people the message mentions, each `{ "id", "name" }`, or an id alone in a row from before mentions kept names. */
  mentions: string | null;
}

function eventOf({ messageId, plainText, mentions, ...event }: EventRow): RoomEvent {
  if (messageId === null) return event;
  const mentioned = (JSON.parse(mentions!) as Array<{ id: UserId } | UserId>).map((person) => (typeof person === "string" ? person : person.id));
  return { ...event, message: { id: messageId, plainText: plainText!, mentionIds: [...new Set(mentioned)] } };
}

/** Logs an event, for the batch that makes the change it records, naming the message a new message's is for. */
export const logEvent = (roomId: RoomId, kind: RoomEvent["kind"], userId: UserId, at: string, messageId: string | null = null): Statement =>
  statement(`INSERT INTO room_events (room_id, kind, user_id, at, message_id) VALUES (?, ?, ?, ?, ?)`, roomId, kind, userId, at, messageId);

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
    return (await this.db.all<EventRow>(UNDELIVERED_EVENTS, this.roomId, limit)).map(eventOf);
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
