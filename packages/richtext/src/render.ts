// How a message body renders: `MessagesHelper#message_presentation` up to its auto_link
// (ember-rust's crates/richtext/src/lib.rs, content.rs and filters.rs), and the canonical form
// Ember stores, which is that rendering with its mentions left to render live.

import {
  attachmentFromNode,
  ATTACHMENT_TAG,
  contentAttachmentPartial,
  MENTION_CONTENT_TYPE,
  MISSING_ATTACHABLE,
  remoteImagePartial,
  remoteVideoPartial,
  RenderError,
  type Attachable,
  type Attachment,
  type MentionUser,
  type ResolveMention,
} from "./attachments";
import { attachmentGalleryNodes, attachmentNodes, contentToPlainText, loadContent, sanitizeContentAttribute } from "./content";
import { BODY, parseReplacement, setInnerHtml, type HtmlParser } from "./markup";
import { userGid } from "./mentions";
import { chomp, presence, strip } from "./ruby";
import { ACTION_TEXT, ATTACHMENT_ATTRIBUTES, AUTO_LINK, CONTENT_FILTER, sanitize, sanitizeTags, scrub } from "./sanitize";
import { toHtml } from "./serialize";
import {
  createElement,
  createFragment,
  descendants,
  getAttr,
  isElement,
  removeAttr,
  removeChildren,
  replaceEach,
  setAttr,
  type Element,
  type Fragment,
  type Node,
} from "./tree";

/** What a mention renders as: Campfire's `users/_mention` partial, or a stand-in for it. */
export type MentionPartial = (user: MentionUser) => string;

/**
 * `message_presentation`'s rendering, sanitized as its auto_link sanitizes it but not linked, as
 * ember-rust serializes it: `<` and `>` escaped in attribute values. Throws `ParseLimitError` and
 * `RenderError` where Rails raises, which `message_presentation` rescues to show nothing.
 */
export function presentMessage(parse: HtmlParser, body: string, resolve: ResolveMention, mention: MentionPartial): string {
  return toHtml(renderMessage(parse, body, resolve, mention), { escapeAttributeBrackets: true });
}

const MENTION_MARKER = "ember-mention";
const isMentionMarker = (element: Element) => element.name === MENTION_MARKER;

/**
 * The form Ember stores a body in: `presentMessage`'s, out of its layout and stripped, with each
 * mention as an empty `<action-text-attachment content-type="application/vnd.campfire.mention"
 * sgid="gid://ember/User/<id>">` that renders the person as they are now, and without two things:
 * `class` attributes, since a message's Tailwind classes could restyle the page, and the images
 * of remote image attachments, which a stored body can't hold (SanitizeTags removes `<img>`).
 */
export function canonicalize(parse: HtmlParser, body: string, resolve: ResolveMention): string {
  return canonicalForm(parse, filterMessage(parse, body, resolve), resolve);
}

/** `canonicalize`, from what `filterMessage` or `filteredContent` left of the body. */
export function canonicalForm(parse: HtmlParser, filtered: Fragment, resolve: ResolveMention): string {
  const markers: MentionPartial = (user) => `<${MENTION_MARKER} user="${user.id}"></${MENTION_MARKER}>`;
  const content = withoutLayout(renderFiltered(parse, filtered, resolve, markers));
  const replacements = new Map<Node, Node[]>();
  for (const node of descendants(content)) {
    if (!isElement(node)) continue;
    if (isMentionMarker(node)) replacements.set(node, [mentionAttachment(Number(getAttr(node, "user")))]);
    else if (node.name === "img") replacements.set(node, []);
    else removeAttr(node, "class");
  }
  replaceEach(replacements);
  return strip(toHtml(content, { escapeAttributeBrackets: true }));
}

function mentionAttachment(userId: number): Element {
  return createElement(ATTACHMENT_TAG, [
    { name: "content-type", value: MENTION_CONTENT_TYPE },
    { name: "sgid", value: userGid(userId) },
  ]);
}

/**
 * `TextMessagePresentationFilters.apply(message.body.body)`. RemoveSoloUnfurledLinkText only reads
 * the body's plain text, which can raise, since Ember has no link previews for it to remove text in
 * favor of (they render nothing).
 */
export function filterMessage(parse: HtmlParser, body: string, resolve: ResolveMention): Fragment {
  contentToPlainText(parse, loadContent(parse, body), resolve);
  return filteredContent(parse, body);
}

/**
 * What the filters leave of a body once its plain text has been read: SanitizeTags, then
 * SanitizeAttributes.
 */
export function filteredContent(parse: HtmlParser, body: string): Fragment {
  const content = loadContent(parse, body);
  sanitizeTags(content);
  return parse(strip(sanitize(parse, toHtml(content), CONTENT_FILTER)), BODY);
}

function renderMessage(parse: HtmlParser, body: string, resolve: ResolveMention, mention: MentionPartial): Fragment {
  return renderFiltered(parse, filterMessage(parse, body, resolve), resolve, mention);
}

/** The filtered body rendered in its layout, and sanitized as `auto_link` sanitizes it. */
function renderFiltered(parse: HtmlParser, filtered: Fragment, resolve: ResolveMention, mention: MentionPartial): Fragment {
  const rendered = new Renderer(parse, resolve, mention).render(filtered, 0);
  const layout = parse(`<div class="lexxy-content">\n  ${rendered}\n</div>\n`, BODY);
  scrub(layout, AUTO_LINK, isMentionMarker);
  return layout;
}

/** The rendered body, out of the `lexxy-content` layout `renderMessage` wraps it in. */
function withoutLayout(fragment: Fragment): Fragment {
  const [layout, ...after] = removeChildren(fragment);
  return createFragment([...(layout?.kind === "element" ? removeChildren(layout) : []), ...after]);
}

class Renderer {
  /** The `content` attributes of rendered attachments, by the stand-ins that replace them. */
  private readonly contents = new Map<string, string>();

  constructor(
    private readonly parse: HtmlParser,
    private readonly resolve: ResolveMention,
    private readonly mention: MentionPartial,
  ) {}

  /**
   * `render_action_text_content(content)` for content `depth` content attachments down: its
   * attachments and galleries rendered, then sanitized with Action Text's allowlist, which leaves
   * mention stand-ins as they are.
   */
  render(content: Fragment, depth: number): string {
    const parse = this.parse;
    const attachments = new Map<Node, Node[]>();
    for (const node of attachmentNodes(content)) {
      sanitizeContentAttribute(parse, node);
      const { attachable } = attachmentFromNode(node, this.resolve);
      const full = this.withFullAttributes(node, attachable);
      setInnerHtml(parse, full, this.renderAttachment({ attachable, caption: presence(getAttr(full, "caption")) }, depth));
      attachments.set(node, parseReplacement(parse, node, toHtml(full)));
    }
    replaceEach(attachments);
    const galleries = new Map<Node, Node[]>();
    for (const gallery of attachmentGalleryNodes(content)) {
      const members = descendants(gallery).filter(
        (node): node is Element => isElement(node, ATTACHMENT_TAG) && getAttr(node, "presentation") === "gallery",
      );
      let rendered = "";
      for (const member of members) {
        const node = this.withContent(member);
        const attachment = attachmentFromNode(node, this.resolve);
        const full = this.withFullAttributes(node, attachment.attachable);
        setInnerHtml(parse, full, this.renderAttachment(attachment, depth));
        rendered += toHtml(full);
      }
      const html = `<div class="attachment-gallery attachment-gallery--${members.length}">\n  ${rendered}\n</div>`;
      galleries.set(gallery, parseReplacement(parse, gallery, html));
    }
    replaceEach(galleries);
    return sanitize(parse, toHtml(content), ACTION_TEXT, isMentionMarker);
  }

  /** `render_action_text_attachment(attachment)`: the attachable's partial, chomped. */
  private renderAttachment({ attachable, caption }: Attachment, depth: number): string {
    switch (attachable.kind) {
      case "mention":
        return chomp(this.mention(attachable.user));
      case "opengraph-embed":
        return "";
      // Rails asks a missing record's model for its partial, which User doesn't have, so a mention
      // of someone deleted raised and blanked the message: ember-rust shows ☒ for every one
      case "missing":
        return MISSING_ATTACHABLE;
      case "content":
        return chomp(contentAttachmentPartial(this.renderContent(attachable.content, depth)));
      case "remote-image":
        return chomp(remoteImagePartial(attachable, caption));
      case "remote-video":
        return chomp(remoteVideoPartial(attachable, caption));
    }
  }

  /**
   * A content attachment's content, rendered without a layout. Each level parses and sanitizes
   * everything below it again, so ember-rust stops at `MAX_CONTENT_ATTACHMENT_DEPTH` (8) levels,
   * where Rails' unbounded nesting makes rendering quadratic in the body's size.
   */
  private renderContent(content: string, depth: number): string {
    return depth < 8 ? `${this.render(loadContent(this.parse, content), depth + 1)}\n` : "";
  }

  /**
   * `Attachment#with_full_attributes`'s node, its `content` replaced by a stand-in. Rails carries
   * each rendered attachment's content through the markup of every level above it, parsing and
   * serializing it again at each, until auto_link's sanitizing drops it with the attachment: with
   * the stand-in, a level of nested content attachments costs only its own markup. Galleries
   * resolve their members again, which `withContent` makes possible.
   */
  private withFullAttributes(node: Element, attachable: Attachable): Element {
    const full = withFullAttributes(node, attachable);
    const content = getAttr(full, "content");
    if (content !== undefined) {
      const standIn = `ember-content-${this.contents.size}`;
      this.contents.set(standIn, content);
      setAttr(full, "content", standIn);
    }
    return full;
  }

  /** A copy of a rendered attachment with its `content` back in place of the stand-in. */
  private withContent(rendered: Element): Element {
    const content = this.contents.get(getAttr(rendered, "content") ?? "");
    if (content === undefined) return rendered;
    const attrs = rendered.attrs.map((attr) => (attr.name === "content" ? { name: "content", value: content } : attr));
    return createElement(rendered.name, attrs, rendered.namespace);
  }
}

/**
 * `Attachment#with_full_attributes`'s node: the node's attachment attributes, in Action Text's
 * order, with a mentioned user's content type.
 */
function withFullAttributes(node: Element, attachable: Attachable): Element {
  const attrs = [];
  for (const name of ATTACHMENT_ATTRIBUTES) {
    const value = name === "content-type" && attachable.kind === "mention" ? MENTION_CONTENT_TYPE : getAttr(node, name);
    if (value !== undefined) attrs.push({ name, value });
  }
  // Rails makes no node of no attributes, then calls #node on the nil
  if (attrs.length === 0) throw new RenderError("undefined method 'node' for nil");
  return createElement(ATTACHMENT_TAG, attrs);
}
