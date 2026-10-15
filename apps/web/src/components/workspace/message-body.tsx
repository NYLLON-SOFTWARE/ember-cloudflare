import { createElement, useContext, type ComponentProps, type ReactNode } from "react";
import { isAppPage, type User, type UserId } from "@ember/protocol";
import type { DisplayElement, DisplayNode } from "@ember/richtext/dom";
import { PageLink } from "@/components/page-link";
import { mentionedPerson, PeopleContext } from "@/hooks/use-directory";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";
import { AvatarLink } from "./user-avatar";

/** React's names for the attributes a message keeps, where they aren't HTML's. */
const PROP_NAMES: Record<string, string> = { datetime: "dateTime", "xml:lang": "xmlLang" };

/** Elements whose whitespace the browser doesn't show, which React won't put in them. */
const TABLE_PARTS = new Set(["table", "thead", "tbody", "tfoot", "tr"]);

/** What a mention of someone no one knows shows, as ember-rust's mention of someone deleted does. */
export const UNKNOWN_PERSON = "☒";

interface Props {
  /** The text, as `displayBody` says it shows. */
  nodes: DisplayNode[];
  /** Whom it mentions, as the message named them, for those the people directory doesn't list yet. */
  mentions: User[];
  /** Shows it large, as a message of nothing but emoji shows. */
  emoji?: boolean;
  /** What follows the text: in its last paragraph, when it ends with one. */
  trailing?: ReactNode;
}

/**
 * A message's text, as ember-rust's `messages/_presentation.html` shows it, built from `displayBody`'s
 * nodes rather than set as markup. `.message-content` in index.css styles it.
 */
export function MessageBody({ nodes, mentions, emoji = false, trailing }: Props) {
  const last = nodes.at(-1);
  const inLastParagraph = trailing !== undefined && last?.kind === "element" && last.name === "p";
  const children = nodes.map((node, index) => nodeOf(node, mentions, inLastParagraph && index === nodes.length - 1 ? trailing : undefined));
  if (trailing !== undefined && !inLastParagraph) children.push(trailing);
  return createElement("div", { dir: "auto", className: cn("message-content", emoji && "text-[2.4em] leading-[1.4]") }, ...children);
}

function nodeOf(node: DisplayNode, mentions: User[], trailing?: ReactNode): ReactNode {
  if (node.kind === "text") return node.value;
  if (node.kind === "mention") return createElement(Mention, { userId: node.userId, mentions });
  const shown = TABLE_PARTS.has(node.name) ? node.children.filter((child) => child.kind !== "text" || child.value.trim() !== "") : node.children;
  const children = shown.map((child) => nodeOf(child, mentions));
  if (trailing !== undefined) children.push(" ", trailing);
  const props = Object.fromEntries(Object.entries(node.attrs).map(([name, value]) => [PROP_NAMES[name] ?? name, value]));
  switch (node.name) {
    case "a":
      return createElement(MessageLink, props, ...children);
    case "pre":
      return createElement(CodeBlock, { ...props, block: node }, ...children);
    case "li":
      return createElement("li", { ...props, "data-list": holdsOnlyAList(node) || undefined }, ...children);
    default:
      return createElement(node.name, props, ...children);
  }
}

/**
 * ember-rust's users/_mention.html, styled by Campfire's autocomplete.css: the person's avatar, as tall as
 * the line and linking to their page, then their name as they're named now, in semibold, every time
 * they're mentioned. The avatar is a `.btn`'s weight, which its `ch` is measured in. Unlike Campfire's,
 * the mention isn't lifted over what follows, such as the next message's Message options.
 */
function Mention({ userId, mentions }: { userId: UserId; mentions: User[] }) {
  const person = mentionedPerson(useContext(PeopleContext), mentions, userId);
  if (!person) return UNKNOWN_PERSON;
  return (
    <span className="relative inline-flex items-center ps-[calc(1.1em+1ch/3)] leading-[1.1em] font-semibold">
      <AvatarLink user={person} reach="none" className="absolute inset-y-0 start-[0.1ch] size-[1.1em] font-medium" />
      {person.name}
    </span>
  );
}

/** A list item that holds only a list, as Lexxy nests one list in another, which shows no marker of its own. */
function holdsOnlyAList(item: DisplayElement): boolean {
  const children = item.children.filter((child) => child.kind !== "text" || child.value.trim() !== "");
  return children.length === 1 && children[0]!.kind === "element" && ["ul", "ol"].includes(children[0]!.name);
}

/**
 * A link in a message, which ember-rust's `reply_controller.js` targets: an address on this site
 * opens in place, without a page load for one of the app's pages, and any other in a new tab.
 */
function MessageLink({ href, ...props }: ComponentProps<"a">) {
  if (href === undefined) return <a {...props} />;
  const url = urlOf(href);
  if (url?.origin !== location.origin) return <a href={href} target="_blank" rel="noopener" {...props} />;
  return isAppPage(url.pathname) ? <PageLink href={url.pathname + url.search + url.hash} {...props} /> : <a href={href} {...props} />;
}

function urlOf(href: string): URL | null {
  try {
    return new URL(href, location.href);
  } catch {
    return null;
  }
}
