import type { Message, RoomId } from "./index.ts";
import type { StoredFile } from "./files.ts";
import { MAX_ID_LENGTH } from "./pages.ts";

// To-dos and Saved, Slack's two lists of things someone keeps for later: the same kind of item in either
// list, so an item moves between them. Each is one person's, and nobody else hears of it. An item keeps a
// message, a file message's file, or a note of its own with its own text and files, made in To-dos. An
// item that keeps a message shows it as the room has it now: edited, deleted, or unavailable once its
// person can no longer see the room.

/** The two lists: To-dos, for tasks, and Saved, for everything else. */
export const SAVED_LISTS = ["todo", "saved"] as const;
export type SavedList = (typeof SAVED_LISTS)[number];

/** What an item keeps: a message, a file message's file, or a note of its own, which To-dos makes and Saved may keep. */
export type SavedKind = "message" | "file" | "note";

/** The most items each list holds, so a list loads in one answer. */
export const MAX_SAVED_ITEMS = 500;

/** Why a list that's full takes no more. */
export const SAVED_LIST_FULL = `A list holds up to ${MAX_SAVED_ITEMS} items. Clear some first.`;

/** The most files a note carries. */
export const MAX_NOTE_FILES = 10;

/** The largest file a note takes, which goes up in one request rather than in a room's parts. */
export const MAX_NOTE_FILE_SIZE = 25_000_000;
export const NOTE_FILE_TOO_LARGE = "Files on a to-do must be 25 MB or smaller.";

/** Where a note's file goes up, its bytes as the body, its name in `?name=`. */
export const NOTE_FILES_PATH = "/api/saved/files";

/** An item in one of someone's lists, as their lists show it. */
export interface SavedItem {
  id: string;
  list: SavedList;
  kind: SavedKind;
  /** The room of the message it keeps; left out for a note. */
  roomId?: RoomId;
  messageId?: string;
  /**
   * The message it keeps, as its room has it now, or null once it's deleted. Left out for a note, and
   * while its person can't see the room (`unavailable`).
   */
  message?: Message | null;
  /** Its person can no longer see its message's room: they left it, were taken out, or it was deleted. */
  unavailable?: true;
  /** A note's text, as markup the composer wrote and Ember sanitized, and its plain text. */
  body?: string;
  plainText?: string;
  /** A note's files. */
  files?: StoredFile[];
  /** When it was marked completed, or null while it's in progress. */
  completedAt: string | null;
  /** When it reminds its person, or reminded them, or null for no reminder. */
  remindAt: string | null;
  /** Its reminder has gone off: a to-do in progress is overdue then. */
  reminded?: true;
  createdAt: string;
  updatedAt: string;
}

/** What marks a message as kept in one of your lists, so its actions say Remove rather than Add. */
export interface SavedMark {
  id: string;
  list: SavedList;
  messageId: string;
}

/**
 * What `GET /api/saved/marks` answers: the messages you keep, how many of your to-dos are in progress, how
 * many of those are overdue, their reminders gone off, and how many items you've saved.
 */
export interface SavedMarks {
  marks: SavedMark[];
  openTodos: number;
  overdueTodos: number;
  savedItems: number;
}

/** What `GET /api/saved?list=` answers: the list's items, newest first. */
export interface SavedItems {
  items: SavedItem[];
}

/**
 * What `POST /api/saved` takes: a message to keep in `list`, by its room and id, or a note of your own
 * for To-dos, with its markup and the ids of the files `NOTE_FILES_PATH` took for it. Either may set a
 * reminder in To-dos. Keeping a message that's already in one of your lists moves it to `list`.
 */
export type NewSavedItem =
  | { list: SavedList; roomId: RoomId; messageId: string; remindAt?: string }
  | { list: "todo"; body: string; fileIds?: string[]; remindAt?: string };

/** What `PATCH /api/saved/<id>` changes: its list, whether it's completed, its reminder, or a note's text and files. */
export interface SavedChange {
  list?: SavedList;
  completed?: boolean;
  remindAt?: string | null;
  body?: string;
  fileIds?: string[];
}

/** A note's file as `NOTE_FILES_PATH` took it, which a new note or a change names by its id. */
export type NoteFile = StoredFile;

const isId = (value: unknown): value is string => typeof value === "string" && value !== "" && value.length <= MAX_ID_LENGTH;

const isList = (value: unknown): value is SavedList => SAVED_LISTS.includes(value as SavedList);

/** The longest a note's markup may be, as a message's. */
const MAX_NOTE_HTML_LENGTH = 100_000;

/** The furthest ahead a reminder can be: a year. */
export const MAX_REMIND_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

/** Whether `value` is a time a reminder can be set for, as an ISO 8601 string. */
const isRemindTime = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));

/** `value` as the ids of a note's files, or null when it isn't a list of at most `MAX_NOTE_FILES` distinct ids. */
function fileIdsOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_NOTE_FILES || !value.every(isId)) return null;
  return new Set(value).size === value.length ? value : null;
}

/** Parses what `POST /api/saved` takes, answering why it's refused instead. */
export function parseNewSavedItem(data: unknown): NewSavedItem | string {
  if (typeof data !== "object" || data === null) return "Say what to keep";
  const { list, roomId, messageId, body, fileIds, remindAt } = data as Record<string, unknown>;
  if (!isList(list)) return "Items go in To-dos or Saved";
  if (roomId !== undefined || messageId !== undefined) {
    if (!isId(roomId) || !isId(messageId)) return "Keep a message by its room and id";
    if (remindAt === undefined) return { list, roomId, messageId };
    if (!isRemindTime(remindAt)) return "A reminder needs a time";
    if (list === "saved") return REMINDER_NOT_IN_SAVED;
    return { list, roomId, messageId, remindAt };
  }
  if (list !== "todo") return "Add notes of your own to To-dos";
  if (typeof body !== "string" || body.length > MAX_NOTE_HTML_LENGTH) return "A to-do's text is too long";
  const files = fileIds === undefined ? [] : fileIdsOf(fileIds);
  if (!files) return `A to-do carries up to ${MAX_NOTE_FILES} files`;
  if (remindAt !== undefined && !isRemindTime(remindAt)) return "A reminder needs a time";
  return { list, body, ...(files.length > 0 && { fileIds: files }), ...(remindAt !== undefined && { remindAt }) };
}

/** Parses what `PATCH /api/saved/<id>` takes, answering why it's refused instead. */
export function parseSavedChange(data: unknown): SavedChange | string {
  if (typeof data !== "object" || data === null) return "Say what to change";
  const { list, completed, remindAt, body, fileIds } = data as Record<string, unknown>;
  const change: SavedChange = {};
  if (list !== undefined) {
    if (!isList(list)) return "Items go in To-dos or Saved";
    change.list = list;
  }
  if (completed !== undefined) {
    if (typeof completed !== "boolean") return "An item is completed or not";
    change.completed = completed;
  }
  if (remindAt !== undefined) {
    if (remindAt !== null && !isRemindTime(remindAt)) return "A reminder needs a time";
    if (remindAt !== null && list === "saved") return REMINDER_NOT_IN_SAVED;
    change.remindAt = remindAt;
  }
  if (body !== undefined) {
    if (typeof body !== "string" || body.length > MAX_NOTE_HTML_LENGTH) return "A to-do's text is too long";
    change.body = body;
  }
  if (fileIds !== undefined) {
    const files = fileIdsOf(fileIds);
    if (!files) return `A to-do carries up to ${MAX_NOTE_FILES} files`;
    change.fileIds = files;
  }
  return Object.keys(change).length > 0 ? change : "Say what to change";
}

/** Whether a reminder at `remindAt` can be set at `now`: in the future, and at most a year ahead. */
export function isRemindableAt(remindAt: string, now: number): boolean {
  const at = Date.parse(remindAt);
  return at > now && at - now <= MAX_REMIND_AHEAD_MS;
}

/** Why a reminder can't be set for then. */
export const REMINDER_NOT_AHEAD = "Pick a time in the next year for the reminder.";

/** Why an item in Saved, which keeps no reminders, can't take one. */
export const REMINDER_NOT_IN_SAVED = "Only a to-do takes a reminder. Move it to To-dos first.";

/** Where an item's page is: in To-dos, `/todos/<id>`, and in Saved, `/saved/<id>`, or the list's own. */
export const savedPath = (list: SavedList, itemId?: string) => `/${list === "todo" ? "todos" : "saved"}${itemId === undefined ? "" : `/${encodeURIComponent(itemId)}`}`;
