import type { Message, UserId } from "@ember/protocol";
import { displayMarkup, type DisplayNode } from "@ember/richtext/dom";

/**
 * How far apart a person's messages can be, either way, and still group, as Campfire's
 * message_formatter.js has it: five minutes, inclusive.
 */
const THREAD_WINDOW_MS = 5 * 60 * 1000;

export interface TimelineItem {
  message: Message;
  /** Whether the message is the first of its day in the reader's time zone, which a separator dates. */
  firstOfDay: boolean;
  /** Same author as the previous message, shortly after it: show it compactly. */
  threaded: boolean;
}

// Times and dates as Campfire's local_time_controller.js writes them, in the reader's locale and time zone.
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });

/** A message's time: "3:04 PM". */
export const timeLabel = (date: Date) => timeFormat.format(date);
/** A day separator's date: "October 12, 2026". */
export const dateLabel = (date: Date) => dateFormat.format(date);
/** What a time or a separator's date shows on hover: "10/12/26, 3:04 PM". */
export const dateTimeLabel = (date: Date) => dateTimeFormat.format(date);

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/**
 * The messages as message_formatter.js lays them out. A message is the first of its day when the one above it
 * is from another day. It's threaded, without its author's avatar and name, when the one above it is the
 * same person's from no more than five minutes before or after, even across midnight, when it has a separator
 * and still no header.
 */
export function timeline(messages: Message[]): TimelineItem[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    if (!previous) return { message, firstOfDay: true, threaded: false };
    const [created, before] = [new Date(message.createdAt), new Date(previous.createdAt)];
    return {
      message,
      firstOfDay: dayKey(before) !== dayKey(created),
      threaded: previous.creator.id === message.creator.id && Math.abs(created.getTime() - before.getTime()) <= THREAD_WINDOW_MS,
    };
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
