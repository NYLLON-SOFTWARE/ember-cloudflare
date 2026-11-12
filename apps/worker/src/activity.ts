import { ACTIVITY_PAGE_SIZE, previewOf, type ActivityItem, type ActivityKind, type ActivityMarks, type ActivityPage, type RoomId, type UserId } from "@ember/protocol";
import { statement, type Db, type Statement } from "./db";

// Each person's Activity (migrations/0065_activity.sql), kept by the Workspace beside their memberships:
// items for the messages that mention them, come in their DMs or reply in threads they follow, which the
// Workspace records as it applies each room's events, and for reactions to their messages and their being
// added to private rooms, which it records as they happen.

/** Users' `status` for someone active, and `role` for a bot, as workspace-store.ts numbers them. */
const ACTIVE = 0;
const BOT = 2;

/** An item's columns, as `itemOf` reads them. */
const COLUMNS = `id, kind, room_id, message_id, parent_id, actor_id, preview, content, created_at, read_at`;

interface ItemRow {
  id: number;
  kind: ActivityKind;
  room_id: RoomId;
  message_id: string | null;
  parent_id: string | null;
  actor_id: UserId;
  preview: string;
  content: string | null;
  created_at: string;
  read_at: string | null;
}

/** An item recorded, with whose it is. */
interface RecordedRow extends ItemRow {
  user_id: UserId;
}

const itemOf = (row: ItemRow): ActivityItem => ({
  id: row.id,
  kind: row.kind,
  roomId: row.room_id,
  messageId: row.message_id,
  parentId: row.parent_id,
  actorId: row.actor_id,
  preview: row.preview,
  content: row.content,
  at: row.created_at,
  read: row.read_at !== null,
});

/** Items recorded, by whose they are, each person's oldest first. */
export type RecordedItems = Map<UserId, ActivityItem[]>;

/** The items `rows` recorded, by whose they are. */
export function recordedItems(rows: RecordedRow[]): RecordedItems {
  const items: RecordedItems = new Map();
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const theirs = items.get(row.user_id) ?? [];
    theirs.push(itemOf(row));
    items.set(row.user_id, theirs);
  }
  return items;
}

/** Adds `more` items to `items`, keeping each person's oldest first. */
export function addRecorded(items: RecordedItems, more: RecordedItems): void {
  for (const [userId, theirs] of more) items.set(userId, [...(items.get(userId) ?? []), ...theirs]);
}

/**
 * The items a new message, ?1, numbered ?11 in room ?2's log, by ?3, records, unless the Workspace has
 * applied its event: for each active member of the room but its author and bots, a mention when it
 * mentions them, a JSON list ?7, or everyone, as ?8 says; for a reply, ?4 naming what it replies to, a
 * thread reply when they follow the thread, a JSON list ?9; and in a DM, a direct message when it's in the
 * DM's timeline, as ?10 says. Only mentions reach those who hear nothing of the room. Those viewing it, a
 * JSON list ?12, get theirs read. ?5 is its text's start, ?6 when it came.
 */
const RECORD_MESSAGE = `INSERT INTO activity (user_id, kind, room_id, message_id, parent_id, actor_id, preview, created_at, read_at)
  SELECT memberships.user_id,
    CASE WHEN ?8 = 1 OR memberships.user_id IN (SELECT value FROM json_each(?7)) THEN 'mention'
      WHEN ?4 IS NOT NULL AND memberships.user_id IN (SELECT value FROM json_each(?9)) THEN 'thread'
      ELSE 'direct' END,
    ?2, ?1, ?4, ?3, ?5, ?6,
    CASE WHEN memberships.user_id IN (SELECT value FROM json_each(?12)) THEN ?6 END
  FROM rooms
    JOIN memberships ON memberships.room_id = rooms.id
    JOIN users ON users.id = memberships.user_id
  WHERE rooms.id = ?2 AND ?11 > rooms.applied_seq AND memberships.user_id <> ?3 AND users.status = ${ACTIVE} AND users.role <> ${BOT}
    AND (?8 = 1 OR memberships.user_id IN (SELECT value FROM json_each(?7))
      OR (memberships.involvement NOT IN ('nothing', 'invisible')
        AND (memberships.user_id IN (SELECT value FROM json_each(?9)) OR (rooms.kind = 'direct' AND ?10 = 1))))
  RETURNING user_id, ${COLUMNS}`;

/** What a new message records, as `RECORD_MESSAGE` finds whom for. */
export interface RecordedMessage {
  seq: number;
  roomId: RoomId;
  messageId: string;
  authorId: UserId;
  parentId: string | null;
  plainText: string;
  at: string;
  mentionIds: UserId[];
  everyone: boolean;
  followerIds: UserId[];
  inRoom: boolean;
  viewerIds: string;
}

export const recordMessage = (m: RecordedMessage): Statement =>
  statement(
    RECORD_MESSAGE,
    m.messageId,
    m.roomId,
    m.authorId,
    m.parentId,
    previewOf(m.plainText),
    m.at,
    JSON.stringify(m.mentionIds),
    m.everyone ? 1 : 0,
    JSON.stringify(m.followerIds),
    m.inRoom ? 1 : 0,
    m.seq,
    m.viewerIds,
  );

/**
 * Marks read the items of ?2's in room ?3 that opening it reads, mentions and DMs in its timeline, as of
 * ?1, unless the Workspace has applied the event, numbered ?4, that says they opened it.
 */
const READ_IN_ROOM = `UPDATE activity SET read_at = ?1
  WHERE user_id = ?2 AND room_id = ?3 AND read_at IS NULL AND parent_id IS NULL AND kind IN ('mention', 'direct')
    AND ?4 > (SELECT applied_seq FROM rooms WHERE id = ?3)
  RETURNING id`;

export const readInRoom = (userId: UserId, roomId: RoomId, at: string, seq: number): Statement => statement(READ_IN_ROOM, at, userId, roomId, seq);

/**
 * A page of ?1's items, newest first, older than item ?2, one more than a page holds, to tell whether
 * there are more. Only those in rooms they're still in.
 */
const PAGE = `SELECT ${COLUMNS} FROM activity
  WHERE user_id = ?1 AND id < ?2 AND EXISTS (SELECT 1 FROM memberships WHERE memberships.room_id = activity.room_id AND memberships.user_id = ?1)
  ORDER BY id DESC LIMIT ${ACTIVITY_PAGE_SIZE + 1}`;

/** How many of ?1's items are unread, in rooms they're still in. */
const UNREAD = `SELECT count(*) AS unread FROM activity
  WHERE user_id = ?1 AND read_at IS NULL AND EXISTS (SELECT 1 FROM memberships WHERE memberships.room_id = activity.room_id AND memberships.user_id = ?1)`;

/** Marks ?1's items that a JSON list ?2 names read as of ?3, or unread when ?3 is null, answering those it changed. */
const MARK = `UPDATE activity SET read_at = ?3
  WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2)) AND (read_at IS NULL) = (?3 IS NOT NULL)
  RETURNING id`;

/** Marks all of ?1's items read as of ?2. */
const MARK_ALL = `UPDATE activity SET read_at = ?2 WHERE user_id = ?1 AND read_at IS NULL`;

/**
 * Records a reaction, ?5, by ?4 to message ?2 in room ?1, written by ?3, whose text starts ?6, for its
 * author, unless they reacted themselves, are a bot or aren't active, or aren't in the room any more.
 */
const RECORD_REACTION = `INSERT INTO activity (user_id, kind, room_id, message_id, actor_id, preview, content, created_at)
  SELECT users.id, 'reaction', ?1, ?2, ?4, ?6, ?5, ?7 FROM users
  WHERE users.id = ?3 AND users.id <> ?4 AND users.status = ${ACTIVE} AND users.role <> ${BOT}
    AND EXISTS (SELECT 1 FROM memberships WHERE memberships.room_id = ?1 AND memberships.user_id = ?3)
  RETURNING user_id, ${COLUMNS}`;

/** Removes the item for reaction ?3 by ?2 to message ?1, answering it. */
const REMOVE_REACTION = `DELETE FROM activity WHERE message_id = ?1 AND kind = 'reaction' AND actor_id = ?2 AND content = ?3 RETURNING user_id, id`;

/** Gives every item about message ?1 in room ?2 its text's start as it is now, ?3, answering those it changed. */
const EDIT_MESSAGE = `UPDATE activity SET preview = ?3 WHERE message_id = ?1 AND room_id = ?2 AND preview IS NOT ?3 RETURNING user_id, ${COLUMNS}`;

/** Removes every item about message ?1 in room ?2, answering them. */
const REMOVE_MESSAGE = `DELETE FROM activity WHERE message_id = ?1 AND room_id = ?2 RETURNING user_id, id`;
const RETELL_MESSAGE = `UPDATE activity SET preview = ?3 WHERE message_id = ?1 AND room_id = ?2`;

/** Records ?2 adding the active people a JSON list ?3 names, but bots and themselves, to private room ?1, as of ?4. */
const RECORD_INVITATIONS = `INSERT INTO activity (user_id, kind, room_id, actor_id, created_at)
  SELECT users.id, 'invitation', ?1, ?2, ?4 FROM users
  WHERE users.id IN (SELECT value FROM json_each(?3)) AND users.id <> ?2 AND users.status = ${ACTIVE} AND users.role <> ${BOT}
  RETURNING user_id, ${COLUMNS}`;

/** Removed items, by whose they were. */
export type RemovedItems = Map<UserId, number[]>;

function removedItems(rows: Array<{ user_id: UserId; id: number }>): RemovedItems {
  const removed: RemovedItems = new Map();
  for (const { user_id, id } of rows) removed.set(user_id, [...(removed.get(user_id) ?? []), id]);
  return removed;
}

/** Larger than any item's id, for the newest page. */
const NEWEST = Number.MAX_SAFE_INTEGER;

export class ActivityStore {
  constructor(private readonly db: Db) {}

  /** A page of `userId`'s Activity, newest first, older than item `before`, or the newest. */
  async page(userId: UserId, before: number | null): Promise<ActivityPage> {
    const [rows, [count]] = (await this.db.batch([statement(PAGE, userId, before ?? NEWEST), statement(UNREAD, userId)])) as [ItemRow[], Array<{ unread: number }>];
    return { items: rows.slice(0, ACTIVITY_PAGE_SIZE).map(itemOf), unread: count?.unread ?? 0, more: rows.length > ACTIVITY_PAGE_SIZE };
  }

  /** Marks `userId`'s items as `marks` says, as of `now`, answering the ids it changed, or null for all. */
  async mark(userId: UserId, marks: ActivityMarks, now: string): Promise<number[] | null> {
    if ("all" in marks) {
      await this.db.run(MARK_ALL, userId, now);
      return null;
    }
    const rows = await this.db.all<{ id: number }>(MARK, userId, JSON.stringify(marks.ids), marks.read ? now : null);
    return rows.map((row) => row.id);
  }

  async recordReaction(roomId: RoomId, messageId: string, authorId: UserId, reactorId: UserId, content: string, plainText: string, at: string): Promise<RecordedItems> {
    return recordedItems(await this.db.all<RecordedRow>(RECORD_REACTION, roomId, messageId, authorId, reactorId, content, previewOf(plainText), at));
  }

  async removeReaction(messageId: string, reactorId: UserId, content: string): Promise<RemovedItems> {
    return removedItems(await this.db.all(REMOVE_REACTION, messageId, reactorId, content));
  }

  /** Has the items about message `messageId` in room `roomId` say what it says now, `plainText`, answering those it changed. */
  async editMessage(roomId: RoomId, messageId: string, plainText: string): Promise<RecordedItems> {
    return recordedItems(await this.db.all<RecordedRow>(EDIT_MESSAGE, messageId, roomId, previewOf(plainText)));
  }

  async removeMessage(roomId: RoomId, messageId: string): Promise<RemovedItems> {
    return removedItems(await this.db.all(REMOVE_MESSAGE, messageId, roomId));
  }

  /** Has the items about a message show the start of `plainText`, what it says now. */
  async retellMessage(roomId: RoomId, messageId: string, plainText: string): Promise<void> {
    await this.db.run(RETELL_MESSAGE, messageId, roomId, previewOf(plainText));
  }

  async recordInvitations(roomId: RoomId, actorId: UserId, userIds: UserId[], at: string): Promise<RecordedItems> {
    if (userIds.length === 0) return new Map();
    return recordedItems(await this.db.all<RecordedRow>(RECORD_INVITATIONS, roomId, actorId, JSON.stringify(userIds), at));
  }
}

/** Rows a batch's `recordMessage` statement answered, read into items. */
export const recordedRows = (rows: unknown[]): RecordedItems => recordedItems(rows as RecordedRow[]);
