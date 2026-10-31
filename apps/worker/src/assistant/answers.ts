import { ASSISTANT_ID, ASSISTANT_NAME, MAX_MESSAGE_LENGTH, type Card, type CardImage, type LinkPreview, type Message, type User } from "@ember/protocol";
import { OPENGRAPH_EMBED_CONTENT_TYPE, previewContent } from "@ember/richtext";
import { decodeHTMLStrict } from "entities/decode";
import { Marked } from "marked";
import { markdownHtml } from "../bots/markdown";
import { escapeText, linkHref } from "../bots/mrkdwn";
import type { Question, RefusalReason, Turn } from "./gateway";

// What @ember asks its model when someone asks it something, and what it answers with. It reads the
// conversation it's asked in, each message after its writer's name, and answers in Markdown, which it
// posts as the rich text people write (`markdownHtml`), the pictures it shows in a card under it, as bots'
// image cards are, and a preview of its first link, as the composer adds one below a link. When it can't
// answer, it says why, in words that say who can do something about it.

/** How many of the room's latest messages @ember reads when it's asked in the room, the question among them. */
export const ROOM_MESSAGES_READ = 20;

/** How many of a thread's latest replies it reads when it's asked in one, the question among them, after the thread's first message. */
export const THREAD_REPLIES_READ = 50;

/**
 * The most characters of a conversation @ember reads: the newest messages that fit, so that one long
 * conversation costs no more than about 10,000 tokens.
 */
export const MAX_CONVERSATION_LENGTH = 40_000;

/** About how many words @ember is asked to keep an answer to: a Medium answer. */
export const ANSWER_WORDS = 400;

/**
 * The most tokens an answer may take: room for a model that thinks before it answers, as many do
 * unless they're asked not to, and then a Medium answer.
 */
export const ANSWER_MAX_TOKENS = 8_000;

/** The most Markdown an answer keeps, so that its plain text fits in a message, as Markdown's plain text is no longer than it. */
const MAX_ANSWER_LENGTH = MAX_MESSAGE_LENGTH - 500;

/** Where @ember is asked something: the community's name, the room's, or null for a DM, and whether it's in a thread. */
export interface AskedIn {
  community: string;
  roomName: string | null;
  inThread: boolean;
}

/** Why a question for @ember gets no answer, which the room logs. */
export class AnswerError extends Error {}

/**
 * What @ember asks its model about the question `conversation` ends with, which `asker` asked `where`,
 * at `now`: the conversation it can read, its writers named, and how to answer, labeled with who asked.
 */
export function questionFor(conversation: Message[], asker: User, where: AskedIn, now: Date): Question {
  return { instructions: instructionsFor(asker, where, now), turns: turnsOf(readable(conversation, where.inThread)), maxTokens: ANSWER_MAX_TOKENS, askerId: asker.id };
}

/** What @ember is told before the conversation. */
function instructionsFor(asker: User, { community, roomName, inThread }: AskedIn, now: Date): string {
  const room = roomName === null ? "a direct message" : `the room "${roomName}"`;
  const today = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" }).format(now);
  return [
    `You are ${ASSISTANT_NAME}, the AI assistant in the team chat "${community}". People ask you things by mentioning @ember in a room or a thread, or by writing to you directly.`,
    `You're asked in ${inThread ? `a thread in ${room}` : room}. Its messages follow, oldest first, each after its writer's name. Answer the last one, which ${asker.name} wrote, as a helpful teammate would: plainly, and in at most about ${ANSWER_WORDS} words.`,
    "Write in Markdown. Links, bold, italics, lists, quotes, code blocks and tables show as they do in the chat, and a picture you show with ![what it shows](its address) appears under your answer. Don't begin with your name.",
    `Today is ${today}, in UTC.`,
  ].join("\n\n");
}

/**
 * The messages of `conversation` @ember reads: the question it ends with, and as many of those before it
 * as fit in `MAX_CONVERSATION_LENGTH` characters, the newest first, but for a thread's first message, which
 * comes before them all.
 */
function readable(conversation: Message[], inThread: boolean): Message[] {
  const question = conversation.at(-1)!;
  const before = conversation.slice(0, -1);
  const [first, ...replies] = before;
  const candidates = inThread && first ? [first, ...replies.reverse()] : before.reverse();
  const kept = new Set<Message>([question]);
  let length = question.plainText.length;
  for (const message of candidates) {
    length += message.plainText.length;
    if (length > MAX_CONVERSATION_LENGTH) break;
    kept.add(message);
  }
  return conversation.filter((message) => kept.has(message));
}

/**
 * The conversation as the model reads it: each message after its writer's name, a file as its name, and
 * @ember's own answers as the model's turns, leaving out what was deleted and what has nothing to read.
 */
function turnsOf(messages: Message[]): Turn[] {
  return messages.flatMap((message): Turn[] => {
    const text = message.attachment ? `(shares a file, ${message.plainText})` : message.plainText.trim();
    if (message.deleted || text === "") return [];
    return [message.creator.id === ASSISTANT_ID ? { role: "assistant", text } : { role: "user", text: `${message.creator.name}: ${text}` }];
  });
}

/** @ember's answer as the room posts it: its Markdown as markup, a card of the pictures it shows, and its first web link, for a preview. */
export interface Answer {
  markup: string;
  cards: Card[];
  firstLink: string | null;
}

const markdown = new Marked({ gfm: true });

/**
 * `text`, the model's answer in Markdown, as @ember posts it, without its name in front, where the
 * conversation's form leads some models to write it, and cut to what one message holds.
 */
export function answerOf(text: string): Answer {
  const answer = cutToFit(text.replace(/^\s*(?:ember:|\*\*ember:\*\*|\*\*ember\*\*:)\s*/i, ""), MAX_ANSWER_LENGTH);
  const images: CardImage[] = [];
  let firstLink: string | null = null;
  markdown.walkTokens(markdown.lexer(answer), (token) => {
    if (token.type === "image") {
      const url = webAddress(decodeHTMLStrict(token.href));
      if (url) images.push({ url, alt: decodeHTMLStrict(token.text) });
    } else if (token.type === "link") {
      // As `markdownHtml` reads them: an autolink's address is its text, with no character references.
      firstLink ??= webAddress(token.autolink ? token.href : decodeHTMLStrict(token.href));
    }
  });
  const cards: Card[] = images.length === 0 ? [] : [{ source: "blocks", parts: images.map((image) => ({ kind: "image", image })) }];
  return { markup: markdownHtml(answer), cards, firstLink };
}

/** `address` as a web address, as a link to it goes, or null when it isn't one. */
function webAddress(address: string): string | null {
  const url = linkHref(address);
  return url && /^https?:/i.test(url) ? url : null;
}

/** `text` cut, a block at a time, to at most `length` characters, ending with an ellipsis where it's cut. */
function cutToFit(text: string, length: number): string {
  if (text.length <= length) return text;
  let kept = "";
  for (const { raw } of markdown.lexer(text)) {
    if (kept.length + raw.length > length - 3) break;
    kept += raw;
  }
  return `${(kept || text.slice(0, length - 3)).trimEnd()}\n\n…`;
}

/** `preview` as the attachment the composer adds below a link it has a preview of, as Lexxy writes one. */
export function previewAttachment({ url, image, title, description }: LinkPreview): string {
  const content = previewContent({ href: url, url: image ?? undefined, filename: title, description });
  return `<action-text-attachment content-type="${OPENGRAPH_EMBED_CONTENT_TYPE}" content="${escapeText(content).replace(/"/g, "&quot;")}"></action-text-attachment>`;
}

/** Where administrators set Ember AI up, as @ember's notes name it. */
const SETTINGS = "AI assistant in community settings";

/** What @ember says when it can't answer, for each reason it can't, and while its API token doesn't open. */
export const NOTES: Record<RefusalReason | "unopened token", string> = {
  token: `I can't answer right now: Cloudflare didn't take Ember AI's API token. An administrator can give it another under ${SETTINGS}.`,
  account: `I can't answer right now: Cloudflare can't find Ember AI's account. An administrator can set it up again under ${SETTINGS}.`,
  credits: "I can't answer right now: the AI Gateway credits that pay for my model have run out. An administrator can top them up in AI Gateway, or choose a Workers AI model.",
  model: `I can't answer right now: AI Gateway didn't take my question for its model. An administrator can choose another model under ${SETTINGS}.`,
  busy: "I can't answer right now: AI Gateway is turning requests away, or a spend limit was reached. Try again later.",
  "too long": "I can't answer that here: the conversation is longer than my model reads at once. Try asking in a new thread.",
  unanswered: "I couldn't answer: AI Gateway didn't answer in time. Try again in a moment.",
  nothing: "I couldn't answer: my model answered with nothing. Try asking again.",
  "unopened token": `I can't answer right now: Ember AI's API token no longer opens here. An administrator can set it up again under ${SETTINGS}.`,
};
