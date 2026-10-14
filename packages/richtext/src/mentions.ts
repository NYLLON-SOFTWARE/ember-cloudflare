// Mentions: `<action-text-attachment>` elements whose `sgid` names a user. Ember's sgid is the
// user's id. ember-rust's are signed global ids, but any member can list every user's, so a
// signature protects nothing; and Lexxy, the composer, drops an sgid that starts like a URL, as
// `gid://` does, since DOMPurify vets every attribute's value as one.

import { attachmentNodes, loadContent, MAX_CONTENT_ATTACHMENT_DEPTH } from "./content";
import { getAttr, type Element } from "./tree";
import type { MentionUser, ResolveMention } from "./attachments";
import { BODY, ParseLimitError, type HtmlParser } from "./markup";

/** An Ember id: 16 lowercase base-36 characters (the Worker's `sortableId`). */
const USER_ID = /^[0-9a-z]{16}$/;

/** The sgid that names a user in a mention. */
export function mentionSgid(userId: string): string {
  return userId;
}

/** The id of the user an sgid names, if it names one. */
export function userIdFromSgid(sgid: string): string | undefined {
  return USER_ID.test(sgid) ? sgid : undefined;
}

/**
 * Every user an attachment's sgid names, in the body or in the content attachments that render
 * inside it, once each: the users to look up before resolving the body's mentions. The sgids are
 * read as parsed, character references and all. Markup past the parser's limits is skipped, since
 * `prepareBody` refuses it anyway.
 */
export function userIdsIn(parse: HtmlParser, markup: string): string[] {
  const ids = new Set<string>();
  const collect = (markup: string, depth: number) => {
    let attachments: Element[];
    try {
      attachments = attachmentNodes(parse(markup, BODY));
    } catch (error) {
      if (error instanceof ParseLimitError) return;
      throw error;
    }
    for (const attachment of attachments) {
      const id = userIdFromSgid(getAttr(attachment, "sgid") ?? "");
      if (id !== undefined) ids.add(id);
      const content = getAttr(attachment, "content");
      if (content !== undefined && depth < MAX_CONTENT_ATTACHMENT_DEPTH) collect(content, depth + 1);
    }
  };
  collect(markup, 0);
  return [...ids];
}

/**
 * `Message::Mentionee#mentioned_users`: the users the body's attachments resolve to, once each, in
 * order. Throws `ParseLimitError` past the parser's limits.
 */
export function mentionedUsers(parse: HtmlParser, markup: string, resolve: ResolveMention): MentionUser[] {
  return usersAttached(attachmentNodes(loadContent(parse, markup)), resolve);
}

/** The users attachments of a loaded body resolve to, once each, in order. */
export function usersAttached(attachments: Element[], resolve: ResolveMention): MentionUser[] {
  const users = new Map<string, MentionUser>();
  for (const node of attachments) {
    const sgid = getAttr(node, "sgid");
    const user = sgid === undefined ? undefined : resolve(sgid);
    if (user && !users.has(user.id)) users.set(user.id, user);
  }
  return [...users.values()];
}
