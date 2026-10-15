import type { Message, User } from "@ember/protocol";

/** Follow-ups from the same person within this window render without a repeated header. */
const THREAD_WINDOW_MS = 5 * 60 * 1000;

export interface TimelineItem {
  message: Message;
  /** A new calendar day starts here. */
  daySeparator: string | null;
  /** Same author as the previous message, shortly after it: show it compactly. */
  threaded: boolean;
}

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

export function dayLabel(date: Date, now = new Date()): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return "Today";
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function timeLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function timeline(messages: Message[], now = new Date()): TimelineItem[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const created = new Date(message.createdAt);
    const newDay = !previous || dayKey(new Date(previous.createdAt)) !== dayKey(created);
    const threaded =
      !newDay &&
      previous!.creator.id === message.creator.id &&
      created.getTime() - new Date(previous!.createdAt).getTime() < THREAD_WINDOW_MS;
    return { message, daySeparator: newDay ? dayLabel(created, now) : null, threaded };
  });
}

/**
 * Whether `body` @-mentions `name`, ignoring case. The mention can't run on into more letters
 * or digits, judged by Unicode rather than ASCII, so "@José" and "@Alice!" count but "@Adam"
 * doesn't mention Ada.
 */
export function mentions(body: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${escaped}(?![\\p{L}\\p{M}\\p{N}_])`, "iu").test(body);
}

/** Groups a message's boosts by emoji, for the reaction chips under it, naming the boosters with `nameOf`. */
export function boostSummary(message: Message, userId: string, nameOf: (user: User) => string = (user) => user.name) {
  const groups = new Map<string, { content: string; count: number; mine: string | null; names: string[] }>();
  for (const boost of message.boosts) {
    const group = groups.get(boost.content) ?? { content: boost.content, count: 0, mine: null, names: [] };
    group.count += 1;
    group.names.push(nameOf(boost.booster));
    if (boost.booster.id === userId) group.mine = boost.id;
    groups.set(boost.content, group);
  }
  return [...groups.values()];
}
