import { createElement, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import type { DisplayElement } from "@ember/richtext/dom";
import type { Token } from "@/lib/highlight";

type Highlighter = typeof import("@/lib/highlight");

let highlighter: Highlighter | undefined;
let loading: Promise<Highlighter> | undefined;

/** highlight.js and its languages, loaded the first time a message has code to highlight. */
function loadHighlighter(): Promise<Highlighter> {
  loading ??= import("@/lib/highlight").then(
    (module) => (highlighter = module),
    (error: unknown) => {
      // The next code block tries again.
      loading = undefined;
      throw error;
    },
  );
  return loading;
}

/** The highlighter once it's loaded, which it loads when `wanted`. */
function useHighlighter(wanted: boolean): Highlighter | undefined {
  const [loaded, setLoaded] = useState(highlighter);
  useEffect(() => {
    if (!wanted || loaded) return;
    let current = true;
    loadHighlighter().then(
      (module) => current && setLoaded(module),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [wanted, loaded]);
  return loaded;
}

/** A code block's code when it holds only text, its `<br>`s read as newlines; null when it holds anything else. */
function codeOf(block: DisplayElement): string | null {
  let code = "";
  for (const child of block.children) {
    if (child.kind === "text") code += child.value;
    else if (child.kind === "element" && child.name === "br") code += "\n";
    else return null;
  }
  return code;
}

const tokenNode = (token: Token): ReactNode =>
  typeof token === "string" ? token : createElement("span", { className: token.className }, ...token.children.map(tokenNode));

/**
 * A message's code block, highlighted once highlight.js has loaded, as Campfire's `MessageFormatter`
 * highlights one (reference/app/javascript/models/message_formatter.js): only when it holds nothing
 * but text, so not when an address in it is linked.
 */
export function CodeBlock({ block, children, ...props }: ComponentProps<"pre"> & { block: DisplayElement }) {
  const code = codeOf(block);
  const language = block.attrs["data-language"];
  const highlighter = useHighlighter(code !== null);
  const tokens = useMemo(() => (highlighter && code !== null ? highlighter.highlight(code, language) : null), [highlighter, code, language]);
  return createElement("pre", props, ...(tokens ? tokens.map(tokenNode) : [children]));
}
