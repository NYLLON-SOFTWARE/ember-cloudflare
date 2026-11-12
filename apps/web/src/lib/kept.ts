import type { Room, SavedItem, SavedList, User, UserId } from "@ember/protocol";
import { membersShown, toSentence } from "./directs";
import { timeLabel } from "./messages";

// What the To-dos and Saved pages make of their items: what each row says, which ones a filter shows, in
// what order, and the times a reminder can be set for.

/** What a list's Filter shows. */
export type KeptFilter = "all" | "messages" | "files" | "notes" | "reminders";

export const FILTER_LABELS: Record<KeptFilter, string> = {
  all: "All items",
  messages: "Messages",
  files: "Files",
  notes: "Your own to-dos",
  reminders: "With a reminder",
};

/** The filters each list offers: Saved holds no notes. */
export const FILTERS: Record<SavedList, KeptFilter[]> = {
  todo: ["all", "messages", "files", "notes", "reminders"],
  saved: ["all", "messages", "files"],
};

/** What a list's Sort orders it by. */
export type KeptSort = "newest" | "oldest" | "reminder";

export const SORT_LABELS: Record<KeptSort, string> = { newest: "Newest first", oldest: "Oldest first", reminder: "Reminder time" };

/** The orders each list offers: Saved has no reminders. */
export const SORTS: Record<SavedList, KeptSort[]> = { todo: ["newest", "oldest", "reminder"], saved: ["newest", "oldest"] };

/** Whether `filter` shows `item`. */
export function shows(filter: KeptFilter, item: SavedItem): boolean {
  switch (filter) {
    case "all":
      return true;
    case "messages":
      return item.kind === "message";
    case "files":
      return item.kind === "file" || (item.kind === "note" && (item.files?.length ?? 0) > 0);
    case "notes":
      return item.kind === "note";
    case "reminders":
      return item.remindAt !== null && item.completedAt === null;
  }
}

/** `items` in `sort`'s order: by when they were kept, or by reminder, soonest first, those with none last. */
export function sorted(items: SavedItem[], sort: KeptSort): SavedItem[] {
  const byKept = (a: SavedItem, b: SavedItem) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1);
  if (sort === "newest") return [...items].sort(byKept);
  if (sort === "oldest") return [...items].sort((a, b) => byKept(b, a));
  return [...items].sort((a, b) => {
    if (a.remindAt === b.remindAt) return byKept(a, b);
    if (a.remindAt === null) return 1;
    if (b.remindAt === null) return -1;
    return a.remindAt < b.remindAt ? -1 : 1;
  });
}

/** What a row says of where its message is: "#general", "Thread in #general", "DM with Ada and Grace", or nothing. */
export function originOf(item: SavedItem, rooms: ReadonlyMap<string, Room>, meId: UserId, nameOf: (user: User) => string): string {
  if (item.kind === "note") return "";
  if (item.unavailable) return "";
  const room = item.roomId === undefined ? undefined : rooms.get(item.roomId);
  if (!room) return "";
  const place = room.kind === "direct" ? `DM with ${toSentence(membersShown(room, meId).map(nameOf)) || "yourself"}` : `#${room.name}`;
  return item.message?.parentId === undefined ? place : `Thread in ${place}`;
}

/** What a row says of its item: a note's or message's text, a file's name, or that it's gone. */
export function summaryOf(item: SavedItem): string {
  if (item.kind === "note") return firstLine(item.plainText ?? "") || item.files?.[0]?.name || "Untitled to-do";
  if (item.unavailable) return "This message is unavailable";
  if (!item.message) return "This message was deleted";
  if (item.message.attachment) return item.message.attachment.name;
  return firstLine(item.message.plainText) || "(no text)";
}

const firstLine = (text: string) => text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";

/** When a row says it was kept, or written, as its date: the message's own time, or the note's. */
export const dateOf = (item: SavedItem) => item.message?.createdAt ?? item.createdAt;

/** A time a reminder can be set for, from the Add reminder menu. */
export interface ReminderChoice {
  label: string;
  at: Date;
}

/** The menu's choices at `now`: in 20 minutes, in an hour, in 3 hours, tomorrow at 9 AM, and next Monday at 9 AM. */
export function reminderChoices(now: Date): ReminderChoice[] {
  const inMinutes = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  monday.setHours(9, 0, 0, 0);
  return [
    { label: "In 20 minutes", at: inMinutes(20) },
    { label: "In 1 hour", at: inMinutes(60) },
    { label: "In 3 hours", at: inMinutes(180) },
    { label: "Tomorrow at 9:00 AM", at: tomorrow },
    { label: "Next Monday at 9:00 AM", at: monday },
  ];
}

/** `date` as a `datetime-local` input's value, in this browser's time zone. */
export function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const monthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const monthDayYear = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

/** A row's date, short, as of `now`: today's time, "Yesterday", "Nov 3" this year, or "Nov 3, 2025". */
export function shortDateLabel(date: Date, now = new Date()): string {
  if (sameDay(date, now)) return timeLabel(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return (date.getFullYear() === now.getFullYear() ? monthDay : monthDayYear).format(date);
}
