import type { Message, User, UserId } from "@ember/protocol";
import { timeLabel } from "./messages";

// How the DMs page lists each DM, after Slack's: when its latest message came, what it said and who
// said it, and how many are unread.

const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short" });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const monthDayFormat = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });
const fullDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** `date` moved `days` days on, at the same time of day. */
function daysOn(date: Date, days: number): Date {
  const moved = new Date(date);
  moved.setDate(date.getDate() + days);
  return moved;
}

/**
 * When a DM was last active, as of `now`: its time today, "Yesterday", the day of the week within the
 * week before, the month and day this year, or the full date before that.
 */
export function activityLabel(date: Date, now = new Date()): string {
  const day = dayFormat.format(date);
  if (day === dayFormat.format(now)) return timeLabel(date);
  if (day === dayFormat.format(daysOn(now, -1))) return "Yesterday";
  if (date > daysOn(now, -7)) return weekdayFormat.format(date);
  if (date.getFullYear() === now.getFullYear()) return monthDayFormat.format(date);
  return fullDateFormat.format(date);
}

/** A message's text on one line, as a preview shows it. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * What a DM's row says of its latest message: "You: …" for yours, the writer's name first in a group
 * DM, and the text alone in a DM with one other person, who wrote it.
 */
export function previewOf(message: Message, meId: UserId, group: boolean, nameOf: (user: User) => string): string {
  const text = message.deleted ? "This message was deleted." : oneLine(message.plainText);
  if (message.creator.id === meId) return `You: ${text}`;
  return group ? `${nameOf(message.creator)}: ${text}` : text;
}

export { unreadBadge } from "./unread-badge";

/** Whether a DM with `members` is one the DMs page's filter, `typed`, finds: any of their names has it, whatever its case. */
export function namesMatch(members: User[], typed: string, nameOf: (user: User) => string): boolean {
  const sought = typed.trim().toLocaleLowerCase();
  return sought === "" || members.some((member) => nameOf(member).toLocaleLowerCase().includes(sought));
}
