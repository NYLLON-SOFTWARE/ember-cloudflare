import type { Message, UserId } from "@ember/protocol";
import { displayMarkup, type DisplayNode } from "@ember/richtext/dom";

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
 * What Reply writes in the composer (reply_controller.js): what the message shows, quoted, with each
 * mention as the bare name `nameOf` gives, then its author with a link to it, and a line to reply on.
 */
export function replyQuote(nodes: DisplayNode[], author: string, link: string, nameOf: (userId: UserId) => string): string {
  const linkToOriginal: DisplayNode = { kind: "element", name: "a", attrs: { href: link }, children: [{ kind: "text", value: "#" }] };
  const quote: DisplayNode[] = [
    { kind: "element", name: "blockquote", attrs: {}, children: nodes },
    { kind: "element", name: "cite", attrs: {}, children: [{ kind: "text", value: `${author} ` }, linkToOriginal] },
    { kind: "element", name: "p", attrs: {}, children: [{ kind: "element", name: "br", attrs: {}, children: [] }] },
  ];
  return displayMarkup(quote, ({ userId }) => nameOf(userId));
}
