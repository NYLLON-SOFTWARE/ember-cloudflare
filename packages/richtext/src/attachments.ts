// Resolving `<action-text-attachment>` elements to what they attach, as Action Text, Lexxy and
// Ember's extensions do (ember-rust's crates/richtext/src/attachables.rs).

import { htmlEscape, isBlank, presence } from "./ruby";
import { getAttr, type Element } from "./tree";

export const ATTACHMENT_TAG = "action-text-attachment";
export const MENTION_CONTENT_TYPE = "application/vnd.campfire.mention";

/** Who a mention names, as far as plain text needs to know. */
export interface MentionUser {
  id: number;
  name: string;
}

/** Finds the user a mention's `sgid` names, or nothing when it names no one. */
export type ResolveMention = (sgid: string) => MentionUser | undefined;

export type Attachable =
  | { kind: "mention"; user: MentionUser }
  | { kind: "opengraph-embed" }
  /** `ActionText::Attachables::ContentAttachment` */
  | { kind: "content"; content: string }
  /** `ActionText::Attachables::RemoteImage` */
  | { kind: "remote-image"; url: string; width?: string; height?: string }
  /** Lexxy's `ActionText::Attachables::RemoteVideo` */
  | { kind: "remote-video"; url: string; contentType: string; width?: string; height?: string; filename?: string }
  /** `ActionText::Attachables::MissingAttachable` */
  | { kind: "missing" };

export interface Attachment {
  attachable: Attachable;
  caption?: string;
}

const OPENGRAPH_CONTENT_TYPE = /application\/vnd.actiontext.opengraph-embed/;
const IMAGE_CONTENT_TYPE = /^image(\/.+|$)/m;
const VIDEO_CONTENT_TYPE = /^video(\/.+|$)/m;

/**
 * Ember's `ActionText::Attachment.from_node` (reference/lib/rails_ext/action_text_attachables.rb):
 * a link preview, else a mentioned user, else Action Text's own attachables as Lexxy extends them.
 */
export function attachmentFromNode(element: Element, resolve: ResolveMention): Attachment {
  return { attachable: attachableFromNode(element, resolve), caption: presence(getAttr(element, "caption")) };
}

function attachableFromNode(element: Element, resolve: ResolveMention): Attachable {
  const contentType = getAttr(element, "content-type");
  if (contentType !== undefined && OPENGRAPH_CONTENT_TYPE.test(contentType)) return { kind: "opengraph-embed" };
  const sgid = getAttr(element, "sgid");
  const user = sgid === undefined ? undefined : resolve(sgid);
  if (user) return { kind: "mention", user };
  const content = getAttr(element, "content");
  if (content !== undefined && contentType?.includes("html") && !isBlank(content)) return { kind: "content", content };
  const url = getAttr(element, "url");
  if (url !== undefined) {
    const sizes = { width: getAttr(element, "width"), height: getAttr(element, "height") };
    if (IMAGE_CONTENT_TYPE.test(contentType ?? "")) return { kind: "remote-image", url, ...sizes };
    if (VIDEO_CONTENT_TYPE.test(contentType ?? "")) {
      return { kind: "remote-video", url, contentType: contentType ?? "", ...sizes, filename: getAttr(element, "filename") };
    }
  }
  return { kind: "missing" };
}

/**
 * `Attachment#to_plain_text`: markup that replaces the attachment, parsed in its parent, or for a
 * content attachment, its content loaded as rich text.
 */
export function attachmentPlainText({ attachable, caption }: Attachment): string | { content: string } {
  switch (attachable.kind) {
    case "mention":
      return `@${attachable.user.name}`;
    case "opengraph-embed":
      return "";
    case "content":
      return { content: attachable.content };
    case "remote-image":
      return `[${caption ?? "Image"}]`;
    case "remote-video":
      return `[${caption ?? attachable.filename ?? "Video"}]`;
    case "missing":
      return caption ?? "";
  }
}

// --- Partials -----------------------------------------------------------------------------------

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

/** Action Text's `_missing_attachable` partial. */
export const MISSING_ATTACHABLE = "☒";

/** `action_text/attachables/_content_attachment`, around its already rendered content. */
export function contentAttachmentPartial(renderedContent: string): string {
  return `<figure class="attachment attachment--content">\n  ${renderedContent}\n</figure>\n`;
}

/** `action_text/attachables/_remote_image` */
export function remoteImagePartial(attachable: Extract<Attachable, { kind: "remote-image" }>, caption?: string): string {
  let html = `<figure class="attachment attachment--preview">\n  ${imageTag(attachable.url, attachable.width, attachable.height)}\n`;
  if (caption !== undefined) html += figcaption(caption);
  return `${html}</figure>\n`;
}

/** Lexxy's `action_text/attachables/_remote_video` */
export function remoteVideoPartial(attachable: Extract<Attachable, { kind: "remote-video" }>, caption?: string): string {
  let html = `<figure class="attachment attachment--preview attachment--video">\n  <video controls="controls"${sizeAttributes(attachable.width, attachable.height)}>\n    <source src="${htmlEscape(attachable.url)}" type="${htmlEscape(attachable.contentType)}">\n</video>`;
  if (caption !== undefined) html += figcaption(caption);
  return `${html}</figure>\n`;
}

function figcaption(caption: string): string {
  return `    <figcaption class="attachment__caption">\n      ${htmlEscape(caption)}\n    </figcaption>\n`;
}

function sizeAttributes(width?: string, height?: string): string {
  return (width === undefined ? "" : ` width="${htmlEscape(width)}"`) + (height === undefined ? "" : ` height="${htmlEscape(height)}"`);
}

const ASSET_URI = /^[-a-z]+:\/\/|^(?:cid|data):|^\/\//im;

/**
 * `image_tag(url, width:, height:)`. A source that isn't a URL goes through the asset pipeline,
 * which raises for anything it doesn't know; a rooted path passes through.
 */
function imageTag(url: string, width?: string, height?: string): string {
  if (!isBlank(url) && !ASSET_URI.test(url) && !url.startsWith("/")) throw new RenderError(`The asset '${url}' was not found`);
  return `<img${sizeAttributes(width, height)} src="${htmlEscape(isBlank(url) ? "" : url)}" />`;
}
