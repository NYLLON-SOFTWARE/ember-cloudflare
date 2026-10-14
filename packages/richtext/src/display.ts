// What a message shows (`MessagesHelper#message_presentation`, after ember-rust): its stored form
// with addresses linked as rails_autolink linked them, as a tree of the elements and attributes a
// message can show, which the web app builds the page from rather than from markup.

import { ATTACHMENT_TAG, MENTION_CONTENT_TYPE, MISSING_ATTACHABLE } from "./attachments";
import { autoLink } from "./autolink";
import { BODY, type HtmlParser } from "./markup";
import { userIdFromSgid } from "./mentions";
import { AUTO_LINK, scrub, type SafeList } from "./sanitize";
import { toHtml } from "./serialize";
import { getAttr, isHtmlElement, type Element, type Node } from "./tree";

/** A message as it shows: text, the elements it's formatted with, and the people it mentions. */
export type DisplayNode = DisplayText | DisplayElement | DisplayMention;

export interface DisplayText {
  kind: "text";
  value: string;
}

/** An element a message can show, with the attributes it can keep. */
export interface DisplayElement {
  kind: "element";
  name: string;
  attrs: Readonly<Record<string, string>>;
  children: DisplayNode[];
}

/** A mention of a user, who shows as they are now. */
export interface DisplayMention {
  kind: "mention";
  userId: string;
}

/**
 * What a message can show: auto_link's allowlist, the last Rails sanitizes with, less `img` and the
 * attributes only images have, which a stored body can't hold, and `class`, which it doesn't keep.
 */
const DISPLAYED: SafeList = {
  tags: new Set([...AUTO_LINK.tags].filter((tag) => tag !== "img")),
  attributes: new Set([...AUTO_LINK.attributes].filter((name) => !["alt", "class", "src"].includes(name))),
};

const isMention = (element: Element) => element.name === ATTACHMENT_TAG && getAttr(element, "content-type") === MENTION_CONTENT_TYPE;

/**
 * A stored body as it shows: only what a message can show, which is all a stored body holds unless
 * something stored it without `prepareBody`, and then its addresses linked. Linking comes last, as
 * in Rails, so an address with a scheme sanitizing takes out of links, such as `feed://`, is still
 * linked. Throws `ParseLimitError` past the parser's limits.
 */
export function displayBody(parse: HtmlParser, html: string): DisplayNode[] {
  const stored = parse(html, BODY);
  scrub(stored, DISPLAYED, isMention);
  const linked = parse(autoLink(parse, toHtml(stored, { escapeAttributeBrackets: true })), BODY);
  return linked.children.flatMap(displayed);
}

/** A node as it shows. Elements nothing allows can't come out of linking, but would go as `scrub` takes them out. */
function displayed(node: Node): DisplayNode[] {
  if (node.kind === "text") return [{ kind: "text", value: node.value }];
  if (node.kind === "comment" || !isHtmlElement(node)) return [];
  if (isMention(node)) {
    const userId = userIdFromSgid(getAttr(node, "sgid") ?? "");
    return [userId === undefined ? { kind: "text", value: MISSING_ATTACHABLE } : { kind: "mention", userId }];
  }
  const children = node.children.flatMap(displayed);
  if (!DISPLAYED.tags.has(node.name)) return children;
  const attrs = Object.fromEntries(node.attrs.filter(({ name }) => DISPLAYED.attributes.has(name)).map(({ name, value }) => [name, value]));
  return [{ kind: "element", name: node.name, attrs, children }];
}
