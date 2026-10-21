import { MAX_MESSAGE_HTML_LENGTH } from "./index.ts";

// A bot's cards: what a Slack incoming webhook's legacy attachments show under the message it posts
// (apps/worker/src/bots/slack.ts), kept as JSON beside the message's body (room migration 0034), as a
// file message keeps its file. Text in a card is rich text in the stored form, as a body is, which the
// room makes with `prepareBody` and clients draw through `displayBody`, never as markup.

/** The most cards a message keeps, as Slack takes at most 100 attachments. */
export const MAX_CARDS = 100;
/** The most parts a card keeps, more than an attachment can fill. */
const MAX_PARTS = 20;
/** The most fields or buttons a part keeps. */
const MAX_ITEMS = 100;
/** The longest plain text a card keeps in a name, title, button or footer, as Slack's text objects take. */
const MAX_TEXT_LENGTH = 3000;
/** The longest address a card keeps, as Slack takes an image's. */
const MAX_URL_LENGTH = 3000;

/** A card under a bot's message: a Slack attachment, framed, with a bar down its left side in its color. */
export interface Card {
  /** What it shows: an attachment, whose bar takes its color. */
  source: "attachment";
  /** Its bar's color, in lowercase: Slack's `good`, `warning` or `danger`, or a color written `#rrggbb`. */
  color?: string;
  /** Rich text above its frame, where Slack puts an attachment's pretext. */
  pretext?: string;
  /** A small image at the right of its parts, as Slack shows an attachment's thumbnail. */
  thumb?: CardImage;
  parts: CardPart[];
}

/** What a card shows, top to bottom. */
export type CardPart =
  /** Who it's from, in a small row with their icon, linked. */
  | { kind: "author"; name: string; href?: string; icon?: string }
  | { kind: "title"; text: string; href?: string }
  /** Rich text. */
  | { kind: "text"; html: string }
  | { kind: "fields"; fields: CardField[] }
  | { kind: "image"; image: CardImage }
  | { kind: "buttons"; buttons: CardButton[] }
  /** A small row at the foot: an icon, text, and a moment in seconds, which shows in its reader's time zone. */
  | { kind: "footer"; text?: string; icon?: string; at?: number };

/** A title in plain text over a value in rich text, taking half the card's width when `short`. */
export interface CardField {
  title?: string;
  html: string;
  short: boolean;
}

export interface CardImage {
  url: string;
  /** What it shows, for screen readers, or "" where the payload doesn't say. */
  alt: string;
}

/** A link drawn as a button, filled for `primary` and red for `danger`. */
export interface CardButton {
  text: string;
  href: string;
  style?: "primary" | "danger";
}

/** An address as a card may keep it, or undefined for one it can't: the room's rule for links and images. */
export type CardAddress = (url: string) => string | undefined;

const COLOR = /^(?:good|warning|danger|#[0-9a-f]{6})$/i;

/**
 * The cards `value` lists, as a message can keep them: each with its parts that are well formed and not
 * too long, of kinds it knows, and the addresses `address` keeps, without whatever else it holds. A card
 * left with nothing to show goes. The room runs it on every message it stores with cards.
 */
export function parseCards(value: unknown, address: CardAddress): Card[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_CARDS).flatMap((card) => parseCard(card, address) ?? []);
}

/**
 * The parts `value` lists as a card keeps them: those that are well formed and not too long, of kinds it
 * knows, with the addresses `address` keeps. A bot's translator keeps the same, so that a part the room
 * would leave out can't take the place of what the card shows without it.
 */
export function parseParts(value: unknown, address: CardAddress): CardPart[] {
  return listOf(value)
    .slice(0, MAX_PARTS)
    .flatMap((part) => parsePart(part, address) ?? []);
}

function parseCard(value: unknown, address: CardAddress): Card | null {
  if (!isRecord(value) || value.source !== "attachment") return null;
  const parts = parseParts(value.parts, address);
  const pretext = htmlOf(value.pretext);
  if (parts.length === 0 && pretext === undefined) return null;
  const color = typeof value.color === "string" && COLOR.test(value.color) ? value.color.toLowerCase() : undefined;
  const thumb = imageOf(value.thumb, address);
  return { source: "attachment", ...(color && { color }), ...(pretext && { pretext }), ...(thumb && { thumb }), parts };
}

function parsePart(value: unknown, address: CardAddress): CardPart | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "author": {
      const name = textOf(value.name);
      return name === undefined ? null : { kind: "author", name, ...linked("href", value.href, address), ...linked("icon", value.icon, address) };
    }
    case "title": {
      const text = textOf(value.text);
      return text === undefined ? null : { kind: "title", text, ...linked("href", value.href, address) };
    }
    case "text": {
      const html = htmlOf(value.html);
      return html === undefined ? null : { kind: "text", html };
    }
    case "fields": {
      const fields = itemsOf(value.fields, fieldOf);
      return fields.length === 0 ? null : { kind: "fields", fields };
    }
    case "image": {
      const image = imageOf(value.image, address);
      return image ? { kind: "image", image } : null;
    }
    case "buttons": {
      const buttons = itemsOf(value.buttons, (button) => buttonOf(button, address));
      return buttons.length === 0 ? null : { kind: "buttons", buttons };
    }
    case "footer": {
      const text = textOf(value.text);
      const at = momentOf(value.at);
      if (text === undefined && at === undefined) return null;
      return { kind: "footer", ...(text && { text }), ...linked("icon", value.icon, address), ...(at !== undefined && { at }) };
    }
    default:
      return null;
  }
}

function fieldOf(value: unknown): CardField | null {
  if (!isRecord(value)) return null;
  const title = textOf(value.title);
  const html = htmlOf(value.html);
  if (title === undefined && html === undefined) return null;
  return { ...(title && { title }), html: html ?? "", short: value.short === true };
}

function buttonOf(value: unknown, address: CardAddress): CardButton | null {
  if (!isRecord(value)) return null;
  const text = textOf(value.text);
  const href = urlOf(value.href, address);
  if (text === undefined || href === undefined) return null;
  const style = value.style === "primary" || value.style === "danger" ? value.style : undefined;
  return { text, href, ...(style && { style }) };
}

function imageOf(value: unknown, address: CardAddress): CardImage | undefined {
  if (!isRecord(value)) return undefined;
  const url = urlOf(value.url, address);
  return url === undefined ? undefined : { url, alt: textOf(value.alt) ?? "" };
}

/** `{ [key]: url }` for an address `address` keeps, or nothing, to spread into a part. */
function linked<Key extends string>(key: Key, value: unknown, address: CardAddress): { [key in Key]?: string } {
  const url = urlOf(value, address);
  return url === undefined ? {} : ({ [key]: url } as { [key in Key]?: string });
}

function urlOf(value: unknown, address: CardAddress): string | undefined {
  return typeof value === "string" && value.length <= MAX_URL_LENGTH ? address(value) : undefined;
}

/** Plain text a card shows, or undefined for none, or too much. */
const textOf = (value: unknown) => (typeof value === "string" && value.trim() !== "" && value.length <= MAX_TEXT_LENGTH ? value : undefined);

/** A moment in seconds that a date can hold, or undefined. */
const momentOf = (value: unknown) => (typeof value === "number" && !Number.isNaN(new Date(value * 1000).getTime()) ? value : undefined);

/** Rich text a card shows, or undefined for none, or more than a message's body can hold. */
const htmlOf = (value: unknown) => (typeof value === "string" && value !== "" && value.length <= MAX_MESSAGE_HTML_LENGTH ? value : undefined);

/** The items of a list that `parse` keeps, up to `MAX_ITEMS`. */
const itemsOf = <Item>(value: unknown, parse: (item: unknown) => Item | null) => listOf(value).slice(0, MAX_ITEMS).flatMap((item) => parse(item) ?? []);

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
