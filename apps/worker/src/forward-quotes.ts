import type { Message } from "@ember/protocol";
import { displayBody, displayMarkup, type DisplayNode } from "@ember/richtext";

// What a forward quotes of its original (forwards.ts), as it's posted and again each time the original
// changes (`ChatRoom.originChanged`), so the two always quote it the same way.

/** Whether there's text outside link previews, where a mention is the name it shows. */
const hasText = (nodes: DisplayNode[]): boolean =>
  nodes.some((node) => node.kind === "mention" || (node.kind === "text" ? node.value.trim() !== "" : node.kind === "element" && hasText(node.children)));

/**
 * What a forward quotes of `original`, on the site `host`: what it shows, as Quote quotes it, or for a message
 * that shows no text, only link previews or a bot's cards, its plain text, and for a file message its file's
 * name, under which its file shows.
 */
export function quotedNodes(original: Message, host: string): DisplayNode[] {
  const shown = original.attachment ? [] : displayBody(original.body, original.plainText, host);
  return hasText(shown) ? shown : [{ kind: "element", name: "p", attrs: {}, children: [{ kind: "text", value: original.plainText }] }];
}

/** The name `original` mentions `userId` by, as it named them, for a quote, which mentions nobody. */
export const mentionedName = (original: Message) => (userId: string) => original.mentions.find((person) => person.id === userId)?.name ?? "☒";

/** The markup of what a forward quotes of `original`, which goes in its `<blockquote>`, without link previews. */
export const quotedMarkup = (original: Message, host: string) => displayMarkup(quotedNodes(original, host), ({ userId }) => mentionedName(original)(userId));

/** What a forward without a note reads as outside its conversation: what it quotes of `original`, its text or its file's name. */
export const quotedText = (original: Message) => original.attachment?.name ?? original.plainText;
