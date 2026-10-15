// Mentions: `<action-text-attachment>` elements whose `sgid` names a user. Ember's sgid is the
// user's id. ember-rust's are signed global ids, but any member can list every user's, so a
// signature protects nothing; and Lexxy, the composer, drops an sgid that starts like a URL, as
// `gid://` does, since DOMPurify vets every attribute's value as one.

import { attachmentNodes, loadContent, MAX_CONTENT_ATTACHMENT_DEPTH } from "./content";
import { detach, getAttr, setAttr, textContent, type Element } from "./tree";
import type { MentionUser, ResolveMention } from "./attachments";
import { BODY, ParseLimitError, type HtmlParser } from "./markup";
import { isPlainParagraph } from "./plain-paragraph";
import { htmlEscape } from "./ruby";
import { toHtml } from "./serialize";

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

/** Someone as a mention shows them, by their avatar too. */
export interface MentionCard extends MentionUser {
  /** Their avatar's address. */
  avatarUrl: string;
}

/**
 * Campfire's users/_mention.html: a mention as the editor shows it, the content of its attachment. The
 * avatar isn't a link, as none is until people's pages are built (`users.avatar-links`).
 */
export function mentionContent({ id, name, avatarUrl }: MentionCard): string {
  return `<span class="mention" sgid="${htmlEscape(mentionSgid(id))}">${avatarTag(avatarUrl)} ${htmlEscape(name)}</span>`;
}

/**
 * autocompletable/users/_prompt_item.html: someone as Lexxy's mentions prompt offers them, by their
 * avatar and name, and the mention picking them writes.
 */
export function mentionPromptItem(person: MentionCard): string {
  const name = htmlEscape(person.name);
  return `<lexxy-prompt-item search="${name}" sgid="${htmlEscape(mentionSgid(person.id))}">
  <template type="menu"><span class="autocomplete__item">${avatarTag(person.avatarUrl)}<span class="autocompletable__name">${name}</span></span></template>
  <template type="editor">${mentionContent(person)}</template>
</lexxy-prompt-item>
`;
}

/**
 * ember-rust's `editable_value` (lib.rs) for a body Ember stored: the markup the editor opens with,
 * each mention given the content Lexxy shows it by, since Lexxy drops an attachment without content. A
 * mention of someone `card` doesn't know goes, as one of someone deleted does there.
 */
export function editableBody(parse: HtmlParser, stored: string, card: (userId: string) => MentionCard | undefined): string {
  if (isPlainParagraph(stored)) return stored;
  const content = parse(stored, BODY);
  for (const attachment of attachmentNodes(content)) {
    const userId = userIdFromSgid(getAttr(attachment, "sgid") ?? "");
    const person = userId === undefined ? undefined : card(userId);
    if (person) setAttr(attachment, "content", mentionContent(person));
    else detach(attachment);
  }
  return toHtml(content, { escapeAttributeBrackets: true });
}

/**
 * Whom markup the editor wrote mentions, once each, in order, named as their mentions show them: by the
 * text of each one's content, as the people search wrote it (`mentionContent`). Throws `ParseLimitError`
 * past the parser's limits.
 */
export function writtenMentions(parse: HtmlParser, markup: string): MentionUser[] {
  if (isPlainParagraph(markup)) return [];
  const people = new Map<string, MentionUser>();
  for (const attachment of attachmentNodes(parse(markup, BODY))) {
    const id = userIdFromSgid(getAttr(attachment, "sgid") ?? "");
    if (id === undefined || people.has(id)) continue;
    people.set(id, { id, name: textContent(parse(getAttr(attachment, "content") ?? "", BODY)).trim() });
  }
  return [...people.values()];
}

/** `avatar_tag` (helpers/users.rs), without its link: an image screen readers skip. */
const avatarTag = (url: string) => `<img class="avatar" aria-hidden="true" src="${htmlEscape(url)}" width="48" height="48">`;

/**
 * Every user an attachment's sgid names, in the body or in the content attachments that render
 * inside it, once each: the users to look up before resolving the body's mentions. The sgids are
 * read as parsed, character references and all. Markup past the parser's limits is skipped, since
 * `prepareBody` refuses it anyway.
 */
export function userIdsIn(parse: HtmlParser, markup: string): string[] {
  if (isPlainParagraph(markup)) return [];
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
