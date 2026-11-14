// Activity, as Slack's is: a feed of what's happened to you, kept by the Workspace, whose items stay once
// read, marked so. The app's Activity page, at `ACTIVITY_PATH`, lists them a page at a time from
// `GET /api/activity`, marks them read or unread through `POST /api/activity/marks`, and hears of new ones,
// and marks made in other tabs, on the workspace socket.

import type { RoomId, UserId } from "./index.ts";

/**
 * What an item is about: a message that mentions you, by name or with @channel, @here or @everyone, a
 * message in a DM of yours, a reply in a thread you follow, a reaction to a message of yours, or someone
 * adding you to a private room, or one of your to-dos reminding you, as you asked it to: its `content` is the
 * to-do's id, and its room and message the message it keeps, or for a to-do of your own, no room ("") and
 * no message.
 */
export const ACTIVITY_KINDS = ["mention", "direct", "thread", "reaction", "invitation", "reminder"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Something that happened to you. */
export interface ActivityItem {
  /** Its place in your feed, whose numbers only grow. */
  id: number;
  kind: ActivityKind;
  roomId: RoomId;
  /** The message it's about, or for a reaction, the message reacted to, and null for an invitation. */
  messageId: string | null;
  /** For a reply in a thread, the message it replies to. */
  parentId: string | null;
  /** Who wrote the message, reacted or added you. */
  actorId: UserId;
  /** The start of the message's text, or for an invitation, nothing. */
  preview: string;
  /** For a reaction, what it is, an emoji or a few words. */
  content: string | null;
  /** When it happened, as an ISO time. */
  at: string;
  read: boolean;
}

/** What `GET /api/activity` answers: a page of the feed, newest first, and how many items are unread in all of it. */
export interface ActivityPage {
  items: ActivityItem[];
  unread: number;
  /** Whether there are older items, which `?before=<the last item's id>` asks for. */
  more: boolean;
}

/** How many items a page of the feed holds. */
export const ACTIVITY_PAGE_SIZE = 50;

/** The most characters an item's preview keeps of its message's text. */
export const ACTIVITY_PREVIEW_LENGTH = 280;

/** The most items one mark can name. */
export const MAX_ACTIVITY_MARKS = 500;

/** What `POST /api/activity/marks` takes: the items to mark read or unread, or every item, which only marks read. */
export type ActivityMarks = { ids: number[]; read: boolean } | { all: true; read: true };

/** The Activity page's address. */
export const ACTIVITY_PATH = "/activity";

/** Whether `text` mentions everyone in its room, as Slack's @channel, @here and @everyone do. */
export const mentionsEveryone = (text: string) => /(^|[^\w@])@(channel|here|everyone)\b/i.test(text);

/** A message's text as an item's preview: its whitespace run together, cut to `ACTIVITY_PREVIEW_LENGTH`. */
export function previewOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > ACTIVITY_PREVIEW_LENGTH ? `${flat.slice(0, ACTIVITY_PREVIEW_LENGTH - 1)}…` : flat;
}

/** The marks `data` asks for, or why they're refused. */
export function parseActivityMarks(data: unknown): ActivityMarks | string {
  if (typeof data !== "object" || data === null) return "Expected an object";
  const { ids, read, all } = data as Record<string, unknown>;
  if (all === true) return read === true ? { all: true, read: true } : "Only marking read can mark every item";
  if (typeof read !== "boolean") return "read must be true or false";
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ACTIVITY_MARKS) return `ids must list 1 to ${MAX_ACTIVITY_MARKS} items`;
  if (!ids.every((id) => Number.isSafeInteger(id) && id > 0)) return "ids must be item ids";
  return { ids: [...new Set(ids as number[])], read };
}

/** The item id `before` names in a page's address, or null for the newest page, or for one that names none. */
export function parseActivityCursor(before: string | null): number | null {
  if (before === null || !/^\d{1,15}$/.test(before)) return null;
  const id = Number(before);
  return id > 0 ? id : null;
}
