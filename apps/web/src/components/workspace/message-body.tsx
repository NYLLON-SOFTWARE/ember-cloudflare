import { createElement, type ComponentProps, type ReactNode } from "react";
import { isAppPage } from "@ember/protocol";
import type { DisplayElement, DisplayNode } from "@ember/richtext/dom";
import { PageLink } from "@/components/page-link";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";

/** React's names for the attributes a message keeps, where they aren't HTML's. */
const PROP_NAMES: Record<string, string> = { datetime: "dateTime", "xml:lang": "xmlLang" };

/** Elements whose whitespace the browser doesn't show, which React won't put in them. */
const TABLE_PARTS = new Set(["table", "thead", "tbody", "tfoot", "tr"]);

/** What a mention shows until the web app can look people up: ember-rust's mention of someone who's gone. */
const UNKNOWN_PERSON = "☒";

interface Props {
  /** The text, as `displayBody` says it shows. */
  nodes: DisplayNode[];
  /** Shows it large, as a message of nothing but emoji shows. */
  emoji?: boolean;
  /** What follows the text: in its last paragraph, when it ends with one. */
  trailing?: ReactNode;
}

/**
 * A message's text, as ember-rust's `messages/_presentation.html` shows it, built from `displayBody`'s
 * nodes rather than set as markup. `.message-content` in index.css styles it.
 */
export function MessageBody({ nodes, emoji = false, trailing }: Props) {
  const last = nodes.at(-1);
  const inLastParagraph = trailing !== undefined && last?.kind === "element" && last.name === "p";
  const children = nodes.map((node, index) => nodeOf(node, inLastParagraph && index === nodes.length - 1 ? trailing : undefined));
  if (trailing !== undefined && !inLastParagraph) children.push(trailing);
  return createElement("div", { dir: "auto", className: cn("message-content", emoji && "text-[2.4em] leading-[1.4]") }, ...children);
}

function nodeOf(node: DisplayNode, trailing?: ReactNode): ReactNode {
  if (node.kind === "text") return node.value;
  if (node.kind === "mention") return UNKNOWN_PERSON;
  const shown = TABLE_PARTS.has(node.name) ? node.children.filter((child) => child.kind !== "text" || child.value.trim() !== "") : node.children;
  const children = shown.map((child) => nodeOf(child));
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
