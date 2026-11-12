import { MAX_SCHEDULED_MESSAGES, type RoomId, type ScheduledMessage, type UserId } from "@ember/protocol";
import { statement, type Db } from "./db";

// Messages people have scheduled to send later (migrations/0070_scheduled_messages.sql), kept in the
// room's own SQLite storage or in D1 (see db.ts) until its alarm posts them as their authors' messages,
// or, when it can't, marks them not sent (0071_scheduled_failures.sql) for their authors to deal with.

interface ScheduledRow {
  id: string;
  author_id: UserId;
  client_message_id: string;
  body: string;
  parent_id: string | null;
  also_send: number;
  send_at: number;
  failed: string | null;
}

/** A scheduled message as the room posts it: who wrote it, and the id their tab gave it. */
export interface DueMessage extends ScheduledMessage {
  authorId: UserId;
  clientMessageId: string;
}

/** What one person can ask to schedule: a message, or a reply in a thread. */
export type NewScheduled = Omit<DueMessage, "id">;

const COLUMNS = "id, author_id, client_message_id, body, parent_id, also_send, send_at, failed";

const BY_AUTHOR = `SELECT ${COLUMNS} FROM scheduled_messages WHERE room_id = ? AND author_id = ? ORDER BY send_at, id`;
const DUE = `SELECT ${COLUMNS} FROM scheduled_messages WHERE room_id = ? AND send_at <= ? AND failed IS NULL ORDER BY send_at, id LIMIT ?`;
const ONE = `SELECT ${COLUMNS} FROM scheduled_messages WHERE room_id = ? AND id = ?`;
const KEPT = `SELECT id FROM scheduled_messages WHERE room_id = ? AND author_id = ? AND client_message_id = ?`;
const NEXT = `SELECT min(send_at) AS send_at FROM scheduled_messages WHERE room_id = ? AND failed IS NULL`;
/**
 * Keeps a scheduled message unless its author has as many waiting already, or one with its client id,
 * answering a row when it's kept.
 */
const INSERT = `INSERT INTO scheduled_messages (id, room_id, author_id, client_message_id, body, parent_id, also_send, send_at, created_at)
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
  WHERE (SELECT count(*) FROM scheduled_messages WHERE room_id = ?2 AND author_id = ?3) < ?10
  ON CONFLICT (room_id, author_id, client_message_id) DO NOTHING
  RETURNING id`;
/** Moves a scheduled message to another time, when it's tried again even if it couldn't be posted before. */
const MOVE = `UPDATE scheduled_messages SET send_at = ?, failed = NULL WHERE room_id = ? AND id = ? AND author_id = ? RETURNING id`;
const FAIL = `UPDATE scheduled_messages SET failed = ? WHERE room_id = ? AND id = ? RETURNING id`;
const FAIL_OUT_OF_THREAD = `UPDATE scheduled_messages SET failed = ?, parent_id = NULL, also_send = 0 WHERE room_id = ? AND id = ? RETURNING id`;
const DELETE = `DELETE FROM scheduled_messages WHERE room_id = ? AND id = ? RETURNING id`;
const DELETE_ALL = `DELETE FROM scheduled_messages WHERE room_id = ?`;

/** How many due messages the alarm posts at a time, so a room with many due at once doesn't hold up its other events. */
export const POSTED_AT_ONCE = 20;

const fromRow = (row: ScheduledRow): DueMessage => ({
  id: row.id,
  authorId: row.author_id,
  clientMessageId: row.client_message_id,
  body: row.body,
  sendAt: row.send_at,
  ...(row.parent_id !== null && { parentId: row.parent_id, alsoSend: row.also_send === 1 }),
  ...(row.failed !== null && { failed: row.failed }),
});

/** A scheduled message as its author's tabs list it, without what only the room needs. */
export const listed = ({ authorId: _, clientMessageId: __, ...message }: DueMessage): ScheduledMessage => message;

export class ScheduledMessages {
  constructor(
    private readonly db: Db,
    readonly roomId: RoomId,
  ) {}

  /** `authorId`'s scheduled messages here, soonest first. */
  async of(authorId: UserId): Promise<ScheduledMessage[]> {
    return (await this.db.all<ScheduledRow>(BY_AUTHOR, this.roomId, authorId)).map((row) => listed(fromRow(row)));
  }

  /** The scheduled message `id`, or null. */
  async find(id: string): Promise<DueMessage | null> {
    const [row] = await this.db.all<ScheduledRow>(ONE, this.roomId, id);
    return row ? fromRow(row) : null;
  }

  /** Whether `authorId` has scheduled a message here with `clientMessageId`, so one their tab sends again is kept once. */
  async has(authorId: UserId, clientMessageId: string): Promise<boolean> {
    return (await this.db.all(KEPT, this.roomId, authorId, clientMessageId)).length > 0;
  }

  /**
   * Keeps `message` to send later, answering its id, or null when its author has `MAX_SCHEDULED_MESSAGES`
   * waiting already, or one with its client id.
   */
  async add(id: string, message: NewScheduled, now: string): Promise<string | null> {
    const { authorId, clientMessageId, body, parentId, alsoSend, sendAt } = message;
    const rows = await this.db.all<{ id: string }>(
      INSERT,
      id,
      this.roomId,
      authorId,
      clientMessageId,
      body,
      parentId ?? null,
      alsoSend ? 1 : 0,
      sendAt,
      now,
      MAX_SCHEDULED_MESSAGES,
    );
    return rows.length > 0 ? id : null;
  }

  /** Moves `authorId`'s scheduled message `id` to `sendAt`, answering whether they had it. */
  async move(id: string, authorId: UserId, sendAt: number): Promise<boolean> {
    return (await this.db.all(MOVE, sendAt, this.roomId, id, authorId)).length > 0;
  }

  /**
   * Marks scheduled message `id` not sent, saying why, so the alarm leaves it, answering whether it was
   * here. A reply whose thread is gone becomes the room's, where its author's composer shows it.
   */
  async fail(id: string, why: string, outOfThread = false): Promise<boolean> {
    return (await this.db.all(outOfThread ? FAIL_OUT_OF_THREAD : FAIL, why, this.roomId, id)).length > 0;
  }

  /** Deletes scheduled message `id`, answering whether it was here, so one posted or deleted already is posted once. */
  async remove(id: string): Promise<boolean> {
    return (await this.db.all(DELETE, this.roomId, id)).length > 0;
  }

  /** Up to `limit` messages due by `now`, soonest first, leaving out those that couldn't be posted. */
  async due(now: number, limit = POSTED_AT_ONCE): Promise<DueMessage[]> {
    return (await this.db.all<ScheduledRow>(DUE, this.roomId, now, limit)).map(fromRow);
  }

  /** When the next scheduled message is due, or null when none are, but those that couldn't be posted. */
  async next(): Promise<number | null> {
    const [row] = await this.db.all<{ send_at: number | null }>(NEXT, this.roomId);
    return row?.send_at ?? null;
  }

  /** Forgets every scheduled message here, as deleting the room does. */
  async forget(): Promise<void> {
    await this.db.batch([statement(DELETE_ALL, this.roomId)]);
  }
}
