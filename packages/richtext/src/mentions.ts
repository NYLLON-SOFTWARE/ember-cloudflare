// Mentions: `<action-text-attachment>` elements whose `sgid` names a user. Ember's sgids are plain
// global ids, `gid://ember/User/<id>`: ember-rust signs them, but any member can list every
// user's, so a signature protects nothing.

import { attachmentNodes, loadContent } from "./content";
import { getAttr, type Element } from "./tree";
import type { MentionUser, ResolveMention } from "./attachments";
import type { HtmlParser } from "./markup";

const USER_GID = /^gid:\/\/ember\/User\/([1-9][0-9]{0,15})$/;
const USER_GIDS = /gid:\/\/ember\/User\/([1-9][0-9]{0,15})/g;

export function userGid(id: number): string {
  return `gid://ember/User/${id}`;
}

/** The id of the user an sgid names, if it names one. */
export function userIdFromGid(sgid: string): number | undefined {
  const id = USER_GID.exec(sgid)?.[1];
  return id === undefined || !Number.isSafeInteger(Number(id)) ? undefined : Number(id);
}

/**
 * Every user id that appears in a user gid anywhere in the markup, once each: the users to look up
 * before resolving the body's mentions, including those inside attributes, which nested content
 * attachments render.
 */
export function userIdsIn(markup: string): number[] {
  const ids = new Set<number>();
  for (const [gid] of markup.matchAll(USER_GIDS)) {
    const id = userIdFromGid(gid);
    if (id !== undefined) ids.add(id);
  }
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
  const users = new Map<number, MentionUser>();
  for (const node of attachments) {
    const sgid = getAttr(node, "sgid");
    const user = sgid === undefined ? undefined : resolve(sgid);
    if (user && !users.has(user.id)) users.set(user.id, user);
  }
  return [...users.values()];
}
