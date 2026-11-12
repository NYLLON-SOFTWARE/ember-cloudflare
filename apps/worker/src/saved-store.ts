import { MAX_SAVED_ITEMS, type RoomId, type SavedKind, type SavedList, type SavedMarks, type UserId } from "@ember/protocol";
import { statement, type Db } from "./db";
import type { DeliveryRow } from "./workspace-store";

// Each person's To-dos and Saved (migrations/0085_saved_items.sql), as the Workspace keeps them.

/** A note's file as an item keeps it: its R2 key, as a room's file's, and what its addresses and card show. */
export interface KeptNoteFile {
  key: string;
  name: string;
  contentType: string;
  byteSize: number;
  width?: number;
  height?: number;
}

/**
 * An item as the Workspace keeps it, with whether its person can still see its message's room. The
 * Worker reads its message from the room, and signs a note's files' addresses.
 */
export interface StoredSavedItem {
  id: string;
  list: SavedList;
  kind: SavedKind;
  roomId: RoomId | null;
  messageId: string | null;
  body: string | null;
  plainText: string | null;
  files: KeptNoteFile[];
  completedAt: string | null;
  remindAt: number | null;
  /** Whether its reminder has gone off. */
  reminded: boolean;
  createdAt: string;
  updatedAt: string;
  available: boolean;
}

/** A message to keep: its room and id, and whether it's a file message, which keeps its file. */
export interface MessageToKeep {
  roomId: RoomId;
  messageId: string;
  kind: "message" | "file";
}

/** A note of your own to keep in To-dos: its markup and plain text, its files, and when it reminds you, if it does. */
export interface NoteToKeep {
  body: string;
  plainText: string;
  files: KeptNoteFile[];
  remindAt: number | null;
}

/** What changes in an item, each part only when it's given. */
export interface StoredSavedChange {
  list?: SavedList;
  completedAt?: string | null;
  remindAt?: number | null;
  note?: { body: string; plainText: string };
  files?: KeptNoteFile[];
}

/** A reminder that's gone off: whose item it is and what it says. */
export interface DueReminder {
  id: string;
  userId: UserId;
  kind: SavedKind;
  /**
   * Whether it still reminds anyone: a to-do in progress, whose person can still see its message's room. Any
   * other goes by unsaid, since a reminder about a room you've left would tell you what's said there.
   */
  live: boolean;
  roomId: RoomId | null;
  messageId: string | null;
  plainText: string | null;
}

interface SavedRow {
  id: string;
  list: SavedList;
  kind: SavedKind;
  room_id: string | null;
  message_id: string | null;
  body: string | null;
  plain_text: string | null;
  files: string | null;
  completed_at: string | null;
  remind_at: number | null;
  reminded_at: number | null;
  created_at: string;
  updated_at: string;
  available: number;
}

/** The item's columns, with whether its person is in its message's room, which a note always is. */
const ITEM_COLUMNS = `saved_items.id, saved_items.list, saved_items.kind, saved_items.room_id, saved_items.message_id, saved_items.body,
  saved_items.plain_text, saved_items.files, saved_items.completed_at, saved_items.remind_at, saved_items.reminded_at, saved_items.created_at, saved_items.updated_at,
  (saved_items.room_id IS NULL OR EXISTS (SELECT 1 FROM memberships WHERE memberships.room_id = saved_items.room_id AND memberships.user_id = saved_items.user_id)) AS available`;

/** Person ?1's items in list ?2, newest first, ?3 at most. */
const ITEMS_IN_LIST = `SELECT ${ITEM_COLUMNS} FROM saved_items WHERE user_id = ?1 AND list = ?2 ORDER BY created_at DESC, id DESC LIMIT ?3`;

/** Person ?1's item ?2. */
const ITEM = `SELECT ${ITEM_COLUMNS} FROM saved_items WHERE id = ?2 AND user_id = ?1`;

/** Person ?1's item that keeps message ?2. */
const ITEM_OF_MESSAGE = `SELECT ${ITEM_COLUMNS} FROM saved_items WHERE user_id = ?1 AND message_id = ?2`;

/** The messages person ?1 keeps in either list, ?2 at most, oldest first. */
const MARKS = `SELECT id, list, message_id FROM saved_items WHERE user_id = ?1 AND message_id IS NOT NULL ORDER BY created_at, id LIMIT ?2`;

/**
 * How many of person ?1's to-dos are in progress, and of those, how many are overdue, their reminders gone
 * off, and how many items they've saved.
 */
const COUNTS = `SELECT (SELECT count(*) FROM saved_items WHERE user_id = ?1 AND list = 'todo' AND completed_at IS NULL) AS open,
  (SELECT count(*) FROM saved_items WHERE user_id = ?1 AND list = 'todo' AND completed_at IS NULL AND reminded_at IS NOT NULL) AS overdue,
  (SELECT count(*) FROM saved_items WHERE user_id = ?1 AND list = 'saved') AS saved`;

/** Whether person ?1 is in room ?2, and how many items they keep in list ?3. */
const ROOM_AND_COUNT = `SELECT EXISTS (SELECT 1 FROM memberships WHERE room_id = ?2 AND user_id = ?1) AS member,
  (SELECT count(*) FROM saved_items WHERE user_id = ?1 AND list = ?3) AS count`;

/**
 * Keeps message ?5 of room ?4 for person ?2 in list ?3 as item ?1 of kind ?6, at ?7, while they're in the
 * room and the list has room for it, or moves the item that keeps it already to that list.
 */
const KEEP_MESSAGE = `INSERT INTO saved_items (id, user_id, list, kind, room_id, message_id, created_at, updated_at)
  SELECT ?1, ?2, ?3, ?6, ?4, ?5, ?7, ?7
  WHERE EXISTS (SELECT 1 FROM memberships WHERE room_id = ?4 AND user_id = ?2)
    AND (SELECT count(*) FROM saved_items WHERE user_id = ?2 AND list = ?3) < ?8
  ON CONFLICT (user_id, message_id) WHERE message_id IS NOT NULL DO UPDATE SET list = excluded.list, updated_at = excluded.updated_at,
    remind_at = CASE WHEN excluded.list = 'saved' THEN NULL ELSE saved_items.remind_at END,
    reminded_at = CASE WHEN excluded.list = 'saved' THEN NULL ELSE saved_items.reminded_at END`;

/** Keeps a note for person ?2 in To-dos as item ?1, while the list has room for it. */
const KEEP_NOTE = `INSERT INTO saved_items (id, user_id, list, kind, body, plain_text, files, remind_at, created_at, updated_at)
  SELECT ?1, ?2, 'todo', 'note', ?3, ?4, ?5, ?6, ?7, ?7
  WHERE (SELECT count(*) FROM saved_items WHERE user_id = ?2 AND list = 'todo') < ?8`;

/**
 * Moves person ?1's item ?2 to list ?3 at ?4, as long as that list has room for it. Saved keeps no reminder.
 */
const MOVE = `UPDATE saved_items SET list = ?3, updated_at = ?4,
    remind_at = CASE WHEN ?3 = 'saved' THEN NULL ELSE remind_at END, reminded_at = CASE WHEN ?3 = 'saved' THEN NULL ELSE reminded_at END
  WHERE id = ?2 AND user_id = ?1 AND list <> ?3
    AND (SELECT count(*) FROM saved_items WHERE user_id = ?1 AND list = ?3) < ?5`;

const COMPLETE = `UPDATE saved_items SET completed_at = ?3, updated_at = ?4 WHERE id = ?2 AND user_id = ?1`;
/** Saved has no reminders, so only a to-do takes one. */
const REMIND = `UPDATE saved_items SET remind_at = ?3, reminded_at = NULL, updated_at = ?4 WHERE id = ?2 AND user_id = ?1 AND list = 'todo'`;
const REWRITE_NOTE = `UPDATE saved_items SET body = ?3, plain_text = ?4, updated_at = ?5 WHERE id = ?2 AND user_id = ?1 AND kind = 'note'`;
const REFILE_NOTE = `UPDATE saved_items SET files = ?3, updated_at = ?4 WHERE id = ?2 AND user_id = ?1 AND kind = 'note'`;

/** Forgets person ?1's item ?2, answering its files. */
const CLEAR = `DELETE FROM saved_items WHERE id = ?2 AND user_id = ?1 RETURNING files`;

/** The reminders yet to go off that are due at ?1, ?2 at most, the earliest first. */
const DUE_REMINDERS = `SELECT id, user_id, kind, room_id, message_id, plain_text,
    (list = 'todo' AND completed_at IS NULL
      AND (room_id IS NULL OR EXISTS (SELECT 1 FROM memberships WHERE memberships.room_id = saved_items.room_id AND memberships.user_id = saved_items.user_id))) AS live
  FROM saved_items
  WHERE remind_at <= ?1 AND remind_at IS NOT NULL AND reminded_at IS NULL ORDER BY remind_at LIMIT ?2`;

/** Records that the reminders of items ?1, a JSON list, due at ?2, went off then, leaving any set again since for later. */
const SETTLE_REMINDERS = `UPDATE saved_items SET reminded_at = ?2 WHERE id IN (SELECT value FROM json_each(?1)) AND remind_at <= ?2 AND reminded_at IS NULL`;

/** Takes back the reminders of items ?1, a JSON list, due at ?2, that went by unsaid, leaving any set again since. */
const DROP_REMINDERS = `UPDATE saved_items SET remind_at = NULL WHERE id IN (SELECT value FROM json_each(?1)) AND remind_at <= ?2 AND reminded_at IS NULL`;

/** How long a file sent for a note waits for one before it's deleted. */
export const NOTE_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/** The most files each person may have waiting for a note. */
export const MAX_WAITING_NOTE_UPLOADS = 20;

/** Records file ?2 as person ?1's, waiting for a note, as of ?3, while they have fewer than ?4 waiting. */
const START_UPLOAD = `INSERT INTO note_uploads (key, user_id, created_at)
  SELECT ?2, ?1, ?3 WHERE (SELECT count(*) FROM note_uploads WHERE user_id = ?1) < ?4 RETURNING key`;

/** Takes person ?1's waiting files of ?2, a JSON list, for a note, answering those it took. */
const CLAIM_UPLOADS = `DELETE FROM note_uploads WHERE user_id = ?1 AND key IN (SELECT value FROM json_each(?2)) RETURNING key`;

/** Puts files ?2, a JSON list, back as person ?1's waiting, as of ?3, as a note that took them failed. */
const RELEASE_UPLOADS = `INSERT INTO note_uploads (key, user_id, created_at) SELECT value, ?1, ?3 FROM json_each(?2) WHERE true ON CONFLICT (key) DO NOTHING`;

/** Forgets the files waiting since ?1 or before, ?2 at most, answering them, for R2 to delete. */
const STALE_UPLOADS = `DELETE FROM note_uploads WHERE key IN (SELECT key FROM note_uploads WHERE created_at <= ?1 ORDER BY created_at LIMIT ?2) RETURNING key`;

/** When the oldest file waiting for a note is due to be deleted. */
export const NEXT_UPLOAD_DUE = `SELECT min(created_at) + ${NOTE_UPLOAD_TTL_MS} FROM note_uploads`;

/** When the next reminder yet to go off is due. */
export const NEXT_REMINDER_DUE = `SELECT min(remind_at) FROM saved_items WHERE remind_at IS NOT NULL AND reminded_at IS NULL`;

/**
 * Person ?1's push subscriptions, if they're active, for a reminder, with the count each sets the badge
 * to, as `MESSAGE_PUSHES` counts it.
 */
const REMINDER_PUSHES = `SELECT push_subscriptions.id, push_subscriptions.endpoint, push_subscriptions.p256dh_key, push_subscriptions.auth_key,
    (SELECT count(*) FROM memberships AS marked WHERE marked.user_id = push_subscriptions.user_id AND marked.unread_at IS NOT NULL) AS badge
  FROM push_subscriptions JOIN users ON users.id = push_subscriptions.user_id
  WHERE push_subscriptions.user_id = ?1 AND users.status = 0 /* active */ ORDER BY push_subscriptions.id`;

function filesOf(json: string | null): KeptNoteFile[] {
  if (json === null) return [];
  try {
    const files = JSON.parse(json) as unknown;
    return Array.isArray(files) ? (files as KeptNoteFile[]) : [];
  } catch {
    return [];
  }
}

const itemOf = (row: SavedRow): StoredSavedItem => ({
  id: row.id,
  list: row.list,
  kind: row.kind,
  roomId: row.room_id,
  messageId: row.message_id,
  body: row.body,
  plainText: row.plain_text,
  files: filesOf(row.files),
  completedAt: row.completed_at,
  remindAt: row.remind_at,
  reminded: row.reminded_at !== null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  available: row.available === 1,
});

const filesJson = (files: KeptNoteFile[]) => (files.length === 0 ? null : JSON.stringify(files));

/** Why keeping an item failed: its person isn't in the message's room, or the list is full. */
export type KeepRefusal = "forbidden" | "full";

export class SavedStore {
  constructor(private readonly db: Db) {}

  /** Someone's items in `list`, newest first. */
  async items(userId: UserId, list: SavedList): Promise<StoredSavedItem[]> {
    return (await this.db.all<SavedRow>(ITEMS_IN_LIST, userId, list, MAX_SAVED_ITEMS)).map(itemOf);
  }

  /** Someone's item `id`, or null if they have none. */
  async item(userId: UserId, id: string): Promise<StoredSavedItem | null> {
    const [row] = await this.db.all<SavedRow>(ITEM, userId, id);
    return row ? itemOf(row) : null;
  }

  /** The messages someone keeps, in either list, and how many to-dos and saved items they have. */
  async marks(userId: UserId): Promise<SavedMarks> {
    const [rows, [counts]] = (await this.db.batch([statement(MARKS, userId, 2 * MAX_SAVED_ITEMS), statement(COUNTS, userId)])) as [
      Array<{ id: string; list: SavedList; message_id: string }>,
      Array<{ open: number; overdue: number; saved: number }>,
    ];
    return {
      marks: rows.map((row) => ({ id: row.id, list: row.list, messageId: row.message_id })),
      openTodos: counts?.open ?? 0,
      overdueTodos: counts?.overdue ?? 0,
      savedItems: counts?.saved ?? 0,
    };
  }

  /**
   * Keeps a message for someone in `list` as a new item `id`, or moves the item that keeps it already
   * there, answering the item, or why it can't.
   */
  async keepMessage(userId: UserId, id: string, list: SavedList, { roomId, messageId, kind }: MessageToKeep, now: string): Promise<StoredSavedItem | KeepRefusal> {
    const [[access], , [row]] = (await this.db.batch([
      statement(ROOM_AND_COUNT, userId, roomId, list),
      statement(KEEP_MESSAGE, id, userId, list, roomId, messageId, kind, now, MAX_SAVED_ITEMS),
      statement(ITEM_OF_MESSAGE, userId, messageId),
    ])) as [Array<{ member: number; count: number }>, unknown[], SavedRow[]];
    if (row?.list === list) return itemOf(row);
    return access?.member ? "full" : "forbidden";
  }

  /** Keeps a note for someone in To-dos as item `id`, answering it, or null when To-dos is full. */
  async keepNote(userId: UserId, id: string, { body, plainText, files, remindAt }: NoteToKeep, now: string): Promise<StoredSavedItem | null> {
    const [, [row]] = (await this.db.batch([
      statement(KEEP_NOTE, id, userId, body, plainText, filesJson(files), remindAt, now, MAX_SAVED_ITEMS),
      statement(ITEM, userId, id),
    ])) as [unknown[], SavedRow[]];
    return row ? itemOf(row) : null;
  }

  /**
   * Changes someone's item `id`, answering it as it is then, null if they have none, or "full" when the
   * list it's to move to has no room for it, having changed nothing.
   */
  async change(userId: UserId, id: string, change: StoredSavedChange, now: string): Promise<StoredSavedItem | "full" | null> {
    const changes = [
      ...(change.completedAt !== undefined ? [statement(COMPLETE, userId, id, change.completedAt, now)] : []),
      ...(change.remindAt !== undefined ? [statement(REMIND, userId, id, change.remindAt, now)] : []),
      ...(change.note ? [statement(REWRITE_NOTE, userId, id, change.note.body, change.note.plainText, now)] : []),
      ...(change.files ? [statement(REFILE_NOTE, userId, id, filesJson(change.files), now)] : []),
      ...(change.list ? [statement(MOVE, userId, id, change.list, now, MAX_SAVED_ITEMS)] : []),
    ];
    const results = await this.db.batch([...changes, statement(ITEM, userId, id)]);
    const [row] = results.at(-1) as SavedRow[];
    if (!row) return null;
    return change.list && row.list !== change.list ? "full" : itemOf(row);
  }

  /** Forgets someone's item `id`, answering its note's files, or null if they had no such item. */
  async clear(userId: UserId, id: string): Promise<KeptNoteFile[] | null> {
    const [row] = await this.db.all<{ files: string | null }>(CLEAR, userId, id);
    return row ? filesOf(row.files) : null;
  }

  /** The reminders due at `now`, `limit` at most. */
  async dueReminders(now: number, limit: number): Promise<DueReminder[]> {
    const rows = await this.db.all<{ id: string; user_id: string; kind: SavedKind; room_id: string | null; message_id: string | null; plain_text: string | null; live: number }>(
      DUE_REMINDERS,
      now,
      limit,
    );
    return rows.map((row) => ({ id: row.id, userId: row.user_id, kind: row.kind, live: row.live === 1, roomId: row.room_id, messageId: row.message_id, plainText: row.plain_text }));
  }

  /** Takes back the reminders of `ids`, due at `now`, that went by unsaid, so their to-dos aren't overdue. */
  async dropReminders(ids: string[], now: number): Promise<void> {
    if (ids.length > 0) await this.db.run(DROP_REMINDERS, JSON.stringify(ids), now);
  }

  /** Records that the reminders of `ids` due at `now` went off. */
  async settleReminders(ids: string[], now: number): Promise<void> {
    if (ids.length > 0) await this.db.run(SETTLE_REMINDERS, JSON.stringify(ids), now);
  }

  /** Records file `key` as `userId`'s, waiting for a note, answering false when they have too many waiting. */
  async startUpload(userId: UserId, key: string, now: number): Promise<boolean> {
    return (await this.db.all(START_UPLOAD, userId, key, now, MAX_WAITING_NOTE_UPLOADS)).length > 0;
  }

  /** Takes `userId`'s waiting files of `keys` for a note, answering those it took. */
  async claimUploads(userId: UserId, keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    return (await this.db.all<{ key: string }>(CLAIM_UPLOADS, userId, JSON.stringify(keys))).map(({ key }) => key);
  }

  /** Puts `keys` back as `userId`'s waiting files. */
  async releaseUploads(userId: UserId, keys: string[], now: number): Promise<void> {
    if (keys.length > 0) await this.db.run(RELEASE_UPLOADS, userId, JSON.stringify(keys), now);
  }

  /** Forgets up to `limit` files that have waited for a note since `before`, answering them. */
  async staleUploads(before: number, limit: number): Promise<string[]> {
    return (await this.db.all<{ key: string }>(STALE_UPLOADS, before, limit)).map(({ key }) => key);
  }

  /** Where someone's reminder is pushed: their push subscriptions, while they're active. */
  async reminderDeliveries(userId: UserId): Promise<DeliveryRow[]> {
    return this.db.all<DeliveryRow>(REMINDER_PUSHES, userId);
  }
}
