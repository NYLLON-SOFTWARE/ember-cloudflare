import { MAX_CARDS, MAX_MESSAGE_HTML_LENGTH, parseParts, type Card, type CardButton, type CardField, type CardImage, type CardPart } from "@ember/protocol";
import { cardAddress } from "@ember/richtext";
import { anchor, emojiNamed, escapeText, linkHref, mrkdwnHtml, mrkdwnText, plainTextHtml, plainTextLine, utcTime, type Formatting } from "./mrkdwn";

// What a Slack incoming webhook is sent (https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks),
// read into the message a bot posts: its `text`, or its Block Kit `blocks`, which Slack shows in place of the text,
// and its legacy `attachments`, which alerting tools still send, as cards under it (packages/protocol/src/cards.ts).
// What Slack lets a payload change about who posts and where (`username`, `icon_emoji`, `icon_url`, `channel`,
// `thread_ts`) is left out: the bot posts as itself, to the room whose address the payload was sent to.

/** Why Slack's webhooks post nothing, in their words. */
export type SlackError = "invalid_payload" | "no_text" | "too_many_attachments" | "msg_too_long";

/** A payload, as JSON decodes an object. */
export type SlackPayload = Record<string, unknown>;

/** What a payload posts: the message's markup, and its cards. */
export interface SlackMessage {
  markup: string;
  cards: Card[];
}

/**
 * The payload in the text of a webhook's request: JSON, whatever the request's type says, as tools send it
 * as JSON and as `curl -d` does, or a form's `payload` field. Null when it's neither, or not an object.
 */
export function slackPayloadOf(text: string): SlackPayload | null {
  return payloadOf(text.trimStart().startsWith("{") ? text : new URLSearchParams(text).get("payload"));
}

/** The payload `json` writes, or null when there's none, it isn't JSON, or it isn't an object. */
export function payloadOf(json: string | null): SlackPayload | null {
  if (json === null) return null;
  try {
    const payload: unknown = JSON.parse(json.trim());
    return isObject(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * The message `payload` posts, as Slack shows it: its blocks in place of its text, as rich text until cards draw
 * them, or its text when they show nothing yet, with a card for each of its attachments; or why it posts nothing.
 */
export function slackMessage(payload: SlackPayload): SlackMessage | SlackError {
  const attachments = listOf(payload.attachments);
  // Slack takes as many attachments as a message keeps cards.
  if (attachments.length > MAX_CARDS) return "too_many_attachments";
  const formatting: Formatting = payload.mrkdwn === false ? "plain" : "mrkdwn";
  const blocks = listOf(payload.blocks).map(blockHtml).join("");
  const markup = shows(blocks) ? blocks : mrkdwnHtml(stringOf(payload.text), formatting);
  const cards = attachments.flatMap((attachment) => attachmentCard(attachment) ?? []);
  if (!shows(markup) && cards.length === 0) return "no_text";
  const tooLong = markup.length > MAX_MESSAGE_HTML_LENGTH || JSON.stringify(cards).length > MAX_MESSAGE_HTML_LENGTH;
  return tooLong ? "msg_too_long" : { markup, cards };
}

/**
 * A legacy attachment as a card, in its color: its author, linked title, text, fields, image, buttons, blocks
 * and footer, under its pretext and beside its thumbnail, or, when those show nothing, its fallback. Slack formats
 * only the fields its `mrkdwn_in` names, but shows links, mentions, emoji and escapes in all of them, and its blocks
 * are rich text until cards draw them. It keeps only the parts and addresses the room keeps (`parseParts`), so one
 * the room would leave out, such as an image whose address is too long, can't hide the fallback.
 */
function attachmentCard(attachment: unknown): Card | null {
  if (!isObject(attachment)) return null;
  const formatted = new Set(listOf(attachment.mrkdwn_in));
  const formattingOf = (field: string): Formatting => (formatted.has(field) ? "mrkdwn" : "plain");
  const candidates = [
    authorPart(attachment),
    titlePart(attachment),
    textPart(mrkdwnHtml(stringOf(attachment.text), formattingOf("text"))),
    fieldsPart(listOf(attachment.fields), formattingOf("fields")),
    imagePart(attachment.image_url),
    buttonsPart(listOf(attachment.actions)),
    textPart(listOf(attachment.blocks).map(blockHtml).join("")),
    footerPart(attachment),
  ].filter((part) => part !== null);
  const parts = parseParts(candidates, addressOf);
  const fallback = textPart(mrkdwnHtml(stringOf(attachment.fallback), "plain"));
  const shown = parts.length > 0 ? parts : fallback ? [fallback] : [];
  const pretext = mrkdwnHtml(stringOf(attachment.pretext), formattingOf("pretext"));
  if (shown.length === 0 && !shows(pretext)) return null;
  const color = stringOf(attachment.color);
  const thumb = imageOf(attachment.thumb_url);
  return { source: "attachment", ...(color && { color }), ...(shows(pretext) && { pretext }), ...(thumb && { thumb }), parts: shown };
}

function authorPart(attachment: SlackPayload): CardPart | null {
  const name = mrkdwnText(stringOf(attachment.author_name));
  return name === "" ? null : { kind: "author", name, ...linkOf("href", attachment.author_link), ...linkOf("icon", attachment.author_icon) };
}

function titlePart(attachment: SlackPayload): CardPart | null {
  const text = mrkdwnText(stringOf(attachment.title));
  return text === "" ? null : { kind: "title", text, ...linkOf("href", attachment.title_link) };
}

const textPart = (html: string): CardPart | null => (shows(html) ? { kind: "text", html } : null);

function imagePart(url: unknown): CardPart | null {
  const image = imageOf(url);
  return image ? { kind: "image", image } : null;
}

/** An attachment's fields: each one's title, which Slack never formats, and its value. */
function fieldsPart(fields: unknown[], formatting: Formatting): CardPart | null {
  const shown = fields.flatMap((field): CardField[] => {
    if (!isObject(field)) return [];
    const title = mrkdwnText(stringOf(field.title));
    const value = mrkdwnHtml(stringOf(field.value), formatting);
    const html = shows(value) ? value : "";
    return title === "" && html === "" ? [] : [{ ...(title && { title }), html, short: field.short === true }];
  });
  return shown.length === 0 ? null : { kind: "fields", fields: shown };
}

/** An attachment's buttons that link somewhere, each in its style. */
function buttonsPart(actions: unknown[]): CardPart | null {
  const buttons = actions.flatMap((action): CardButton[] => {
    if (!isObject(action)) return [];
    const text = mrkdwnText(stringOf(action.text));
    const href = addressOf(action.url);
    const style = action.style === "primary" || action.style === "danger" ? action.style : undefined;
    return text === "" || href === undefined ? [] : [{ text, href, ...(style && { style }) }];
  });
  return buttons.length === 0 ? null : { kind: "buttons", buttons };
}

/** An attachment's footer: its text, its icon and its time, `ts`, in seconds. */
function footerPart(attachment: SlackPayload): CardPart | null {
  const text = mrkdwnText(stringOf(attachment.footer));
  const at = numberOf(attachment.ts);
  const known = !Number.isNaN(new Date(at * 1000).getTime());
  if (text === "" && !known) return null;
  return { kind: "footer", ...(text && { text }), ...linkOf("icon", attachment.footer_icon), ...(known && { at }) };
}

/** An address in a payload that a card can show, a web address on a named host, or undefined. */
const addressOf = (url: unknown) => (typeof url === "string" ? cardAddress(url, "") : undefined);

/** An image in a payload, which Slack describes with no text, or undefined. */
function imageOf(url: unknown): CardImage | undefined {
  const address = addressOf(url);
  return address === undefined ? undefined : { url: address, alt: "" };
}

/** `{ [key]: address }` for an address in a payload that a card can show, to spread into a part, or nothing. */
function linkOf<Key extends string>(key: Key, link: unknown): { [key in Key]?: string } {
  const address = addressOf(link);
  return address === undefined ? {} : ({ [key]: address } as { [key in Key]?: string });
}

/** The buttons that link somewhere, an attachment's `actions` or an actions block's `elements`, as links on a line. */
function buttonsHtml(buttons: unknown[]): string {
  const links = buttons.flatMap((button) => {
    if (!isObject(button)) return [];
    const href = typeof button.url === "string" ? linkHref(button.url) : null;
    const text = isObject(button.text) ? textLine(button.text) : plainTextLine(stringOf(button.text));
    return href && text ? [anchor(href, text)] : [];
  });
  return links.length === 0 ? "" : `<p>${links.join(" · ")}</p>`;
}

/**
 * A Block Kit block, until cards draw it, as rich text: a header in bold, a section's text and fields, a
 * context's text, a Markdown block's text as it's written, a rich text block, and an actions block's links.
 * Other blocks, and images, show nothing yet.
 */
function blockHtml(block: unknown): string {
  if (!isObject(block)) return "";
  switch (block.type) {
    case "header": {
      const text = isObject(block.text) ? textLine(block.text) : "";
      return text && `<p><strong>${text}</strong></p>`;
    }
    case "section":
      return [block.text, ...listOf(block.fields)].map(textHtml).join("");
    case "context":
      return listOf(block.elements).map(textHtml).join("");
    case "markdown":
      return plainTextHtml(stringOf(block.text), false);
    case "rich_text":
      return listOf(block.elements).map(richTextHtml).join("");
    case "actions":
      return buttonsHtml(listOf(block.elements));
    default:
      return "";
  }
}

/** A text object, as markup: `mrkdwn` formatted, and `plain_text` as it is, with emoji by name unless it says not to. */
function textHtml(text: unknown): string {
  if (!isObject(text)) return "";
  if (text.type === "mrkdwn") return mrkdwnHtml(stringOf(text.text));
  return text.type === "plain_text" ? plainTextHtml(stringOf(text.text), text.emoji !== false) : "";
}

/** A header's or a button's text, a `plain_text` object, as a line of markup. */
const textLine = (text: SlackPayload) => plainTextLine(stringOf(text.text), text.emoji !== false);

/** One of a rich text block's elements: a section, a list of them, a quote, or preformatted text. */
function richTextHtml(element: unknown): string {
  if (!isObject(element)) return "";
  const inline = inlineHtml(listOf(element.elements));
  switch (element.type) {
    case "rich_text_section":
      return inline && `<p>${inline}</p>`;
    case "rich_text_quote":
      return inline && `<blockquote><p>${inline}</p></blockquote>`;
    case "rich_text_preformatted":
      return inline && `<pre>${inline.replace(/<br>/g, "\n")}</pre>`;
    case "rich_text_list": {
      const tag = element.style === "ordered" ? "ol" : "ul";
      const items = listOf(element.elements)
        .map((item) => (isObject(item) ? `<li>${inlineHtml(listOf(item.elements))}</li>` : ""))
        .join("");
      return shows(items) ? `<${tag}>${items}</${tag}>` : "";
    }
    default:
      return "";
  }
}

/** A rich text section's elements as markup, its line breaks `<br>`, without one at its end. */
function inlineHtml(elements: unknown[]): string {
  return elements
    .map(inlineElementHtml)
    .join("")
    .replace(/(?:<br>)+$/, "");
}

/** One of a rich text section's elements: text, a link, an emoji, a mention, a date or a color. */
function inlineElementHtml(element: unknown): string {
  if (!isObject(element)) return "";
  switch (element.type) {
    case "text":
      return styled(escapeText(stringOf(element.text)).replace(/\n/g, "<br>"), element.style);
    case "link": {
      const url = stringOf(element.url);
      const href = linkHref(url);
      const text = styled(escapeText(stringOf(element.text) || url), element.style);
      return href ? anchor(href, text) : text;
    }
    case "emoji":
      return emojiNamed(stringOf(element.name), typeof element.skin_tone === "number" ? element.skin_tone : undefined) ?? escapeText(`:${stringOf(element.name)}:`);
    case "user":
      return escapeText(`@${stringOf(element.user_id)}`);
    case "usergroup":
      return escapeText(`@${stringOf(element.usergroup_id)}`);
    case "channel":
      return escapeText(`#${stringOf(element.channel_id)}`);
    case "broadcast":
      return escapeText(`@${stringOf(element.range)}`);
    case "date": {
      const text = escapeText(stringOf(element.fallback) || utcTime(numberOf(element.timestamp)));
      const href = linkHref(stringOf(element.url));
      return href ? anchor(href, text) : text;
    }
    case "color":
      return escapeText(stringOf(element.value));
    default:
      return "";
  }
}

/** Rich text's `html` in the styles `style` turns on: code, struck through, in italics and in bold. */
function styled(html: string, style: unknown): string {
  if (!isObject(style) || html === "") return html;
  let styledHtml = html;
  if (style.code === true) styledHtml = `<code>${styledHtml}</code>`;
  if (style.strike === true) styledHtml = `<s>${styledHtml}</s>`;
  if (style.italic === true) styledHtml = `<em>${styledHtml}</em>`;
  if (style.bold === true) styledHtml = `<strong>${styledHtml}</strong>`;
  return styledHtml;
}

/** Whether markup shows anything: text beside its tags that isn't all space. */
const shows = (html: string) => html.replace(/<[^>]*>/g, "").trim() !== "";

const isObject = (value: unknown): value is SlackPayload => typeof value === "object" && value !== null && !Array.isArray(value);

const stringOf = (value: unknown) => (typeof value === "string" ? value : "");

/** A number in a payload, written as one or as text, or NaN for anything else. */
const numberOf = (value: unknown) => (typeof value === "number" || typeof value === "string" ? Number(value) : NaN);

/** A list in a payload: an array, or one written as JSON in a string, as Slack's forms take one; or none. */
function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const list: unknown = JSON.parse(value);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
