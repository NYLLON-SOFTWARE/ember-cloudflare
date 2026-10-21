import { MAX_MESSAGE_HTML_LENGTH } from "@ember/protocol";
import { anchor, emojiNamed, escapeText, linkHref, mrkdwnHtml, mrkdwnLine, plainTextHtml, plainTextLine, utcTime, type Formatting } from "./mrkdwn";

// What a Slack incoming webhook is sent (https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks),
// read into the message a bot posts: its `text`, or its Block Kit `blocks`, which Slack shows in place of the text,
// then its legacy `attachments`, which alerting tools still send. What Slack lets a payload change about who posts
// and where (`username`, `icon_emoji`, `icon_url`, `channel`, `thread_ts`) is left out: the bot posts as itself,
// to the room whose address the payload was sent to.

/** Why Slack's webhooks post nothing, in their words. */
export type SlackError = "invalid_payload" | "no_text" | "too_many_attachments" | "msg_too_long";

/** A payload, as JSON decodes an object. */
export type SlackPayload = Record<string, unknown>;

/** What a payload posts: the message's markup. */
export interface SlackMessage {
  markup: string;
}

/** The most attachments Slack takes in a message. */
const MAX_ATTACHMENTS = 100;

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
 * them, or its text when they show nothing yet, then its attachments; or why it posts nothing.
 */
export function slackMessage(payload: SlackPayload): SlackMessage | SlackError {
  const attachments = listOf(payload.attachments);
  if (attachments.length > MAX_ATTACHMENTS) return "too_many_attachments";
  const formatting: Formatting = payload.mrkdwn === false ? "plain" : "mrkdwn";
  const blocks = listOf(payload.blocks).map(blockHtml).join("");
  const markup = (shows(blocks) ? blocks : mrkdwnHtml(stringOf(payload.text), formatting)) + attachments.map(attachmentHtml).join("");
  if (!shows(markup)) return "no_text";
  return markup.length > MAX_MESSAGE_HTML_LENGTH ? "msg_too_long" : { markup };
}

/**
 * A legacy attachment, until cards draw it, as a quote, whose bar stands in for its color: its author, linked
 * title, text, fields, buttons, blocks and footer, after its pretext, or, when those show nothing, its fallback.
 * Slack formats only the fields its `mrkdwn_in` names, but shows links, mentions, emoji and escapes in all of them.
 */
function attachmentHtml(attachment: unknown): string {
  if (!isObject(attachment)) return "";
  const formatted = new Set(listOf(attachment.mrkdwn_in));
  const textOf = (field: string) => mrkdwnHtml(stringOf(attachment[field]), formatted.has(field) ? "mrkdwn" : "plain");
  const quoted = [
    linkedParagraph(attachment.author_name, attachment.author_link),
    linkedParagraph(attachment.title, attachment.title_link, "strong"),
    textOf("text"),
    ...listOf(attachment.fields).map((field) => fieldHtml(field, formatted.has("fields") ? "mrkdwn" : "plain")),
    buttonsHtml(listOf(attachment.actions)),
    ...listOf(attachment.blocks).map(blockHtml),
    mrkdwnHtml(stringOf(attachment.footer), "plain"),
  ].join("");
  const shown = shows(quoted) ? quoted : mrkdwnHtml(stringOf(attachment.fallback), "plain");
  return textOf("pretext") + (shown && `<blockquote>${shown}</blockquote>`);
}

/** An attachment's author or title, linked to `link` if it's a web address, and in `tag` if it's given. */
function linkedParagraph(text: unknown, link: unknown, tag?: string): string {
  const html = mrkdwnLine(stringOf(text));
  if (html === "") return "";
  const href = typeof link === "string" ? linkHref(link) : null;
  const linked = href ? anchor(href, html) : html;
  return `<p>${tag ? `<${tag}>${linked}</${tag}>` : linked}</p>`;
}

/** An attachment's field: its title in bold, which Slack never formats, then its value. */
function fieldHtml(field: unknown, formatting: Formatting): string {
  if (!isObject(field)) return "";
  const title = mrkdwnLine(stringOf(field.title));
  return (title && `<p><strong>${title}</strong></p>`) + mrkdwnHtml(stringOf(field.value), formatting);
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
