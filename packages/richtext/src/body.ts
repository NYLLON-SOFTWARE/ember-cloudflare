// What Ember keeps of a message body when it's written: the canonical markup, its plain text and
// whom it mentions (Ember's rich-text design: sanitize on write, render on the client).

import { RenderError, type MentionUser, type ResolveMention } from "./attachments";
import { attachmentNodes, contentToPlainText, loadContent } from "./content";
import { ParseLimitError, type HtmlParser } from "./markup";
import { mentionedUsers, userIdsIn, usersAttached } from "./mentions";
import { canonicalForm, filteredContent } from "./render";
import { isBlank } from "./ruby";

export interface PreparedBody {
  /** The body in the form Ember stores and clients render (`canonicalize`). */
  html: string;
  /** Action Text's plain text of the body: for search, notifications, emoji-only bodies and `/play`. */
  plainText: string;
  /** The users it mentions, once each, in order. */
  mentions: number[];
  /** Nothing to send: no text but whitespace, and no attachments. */
  blank: boolean;
}

/** `message.body.to_plain_text`. Throws `ParseLimitError` past the parser's limits. */
export function plainText(parse: HtmlParser, markup: string, resolve: ResolveMention): string {
  return contentToPlainText(parse, loadContent(parse, markup), resolve);
}

/**
 * Everything Ember keeps of a body a client sent, or null when it can't be shown: past the
 * parser's limits, or with an attachment that raises as Rails renders it. ember-rust stores such a
 * body and shows it as an empty or unrenderable message; Ember refuses it.
 */
export function prepareBody(parse: HtmlParser, markup: string, resolve: ResolveMention): PreparedBody | null {
  try {
    const content = loadContent(parse, markup);
    const attachments = attachmentNodes(content);
    const mentions = usersAttached(attachments, resolve).map((user) => user.id);
    const text = contentToPlainText(parse, content, resolve);
    return {
      html: canonicalForm(parse, filteredContent(parse, markup), resolve),
      plainText: text,
      mentions,
      blank: isBlank(text) && attachments.length === 0,
    };
  } catch (error) {
    if (error instanceof ParseLimitError || error instanceof RenderError) return null;
    throw error;
  }
}

/** The package's functions over one parser: parse5 in the Worker, the DOM's in a browser. */
export function withParser(parse: HtmlParser) {
  return {
    prepareBody: (markup: string, resolve: ResolveMention) => prepareBody(parse, markup, resolve),
    plainText: (markup: string, resolve: ResolveMention) => plainText(parse, markup, resolve),
    mentionedUsers: (markup: string, resolve: ResolveMention): MentionUser[] => mentionedUsers(parse, markup, resolve),
    userIdsIn: (markup: string) => userIdsIn(parse, markup),
  };
}
