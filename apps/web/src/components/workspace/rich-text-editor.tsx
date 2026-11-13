import { configure, Extension, Lexical } from "@37signals/lexxy";
import type { SkinTone } from "@ember/protocol";
import { MENTION_CONTENT_TYPE, OPENGRAPH_EMBED_CONTENT_TYPE } from "@ember/richtext/dom";
import { useEffect, useEffectEvent, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { closedCode, loadedEmoji, loadEmoji, rememberEmoji, typedCode } from "@/lib/emoji";
import { EmojiSuggestions, useEmojiSuggestions } from "./emoji-suggestions";
import { registerQuoteLines } from "./quote-lines";
import "./rich-text-editor.css";

// The editor, Lexxy 0.9.24, set up as Campfire sets it up. This is a chunk of its own, loaded as the
// first editor shows (editor.ts), since it's bigger than the rest of the app.

/** Campfire's CiteNode (app/javascript/lib/rich_text/cite_node.js): the `<cite>` naming whom a reply quotes. */
class CiteNode extends Lexical.ElementNode {
  static getType() {
    return "cite";
  }

  static clone(node: CiteNode) {
    return new CiteNode(node.__key);
  }

  static importJSON(serialized: Record<string, unknown>) {
    return new CiteNode().updateFromJSON(serialized);
  }

  static importDOM() {
    return { cite: () => ({ conversion: () => ({ node: new CiteNode() }), priority: 1 }) };
  }

  exportJSON() {
    return { ...super.exportJSON(), type: "cite" };
  }

  createDOM() {
    return document.createElement("cite");
  }

  updateDOM() {
    return false;
  }

  exportDOM() {
    return { element: document.createElement("cite") };
  }
}

/**
 * Campfire's CampfireRichTextExtension (app/javascript/lib/rich_text/campfire_extension.js):
 * what Campfire's messages hold beyond what Lexxy writes, which the editor keeps rather than strips.
 */
class CampfireRichTextExtension extends Extension {
  get allowedElements() {
    return [
      "cite",
      "figure",
      "figcaption",
      "actiontext-opengraph-embed",
      { tag: "div", attributes: ["sgid"] },
      { tag: "span", attributes: ["sgid"] },
      { tag: "img", attributes: ["alt"] },
      { tag: "a", attributes: ["rel", "target"] },
    ];
  }

  get lexicalExtension() {
    return this.defineExtension({ name: "campfire/rich-text", nodes: [CiteNode], register: registerQuoteLines });
  }
}

// Campfire's settings (app/javascript/initializers/rich_text.js), which have to come before Lexxy
// defines its elements, on the tick after it loads. Mentions keep the content type Campfire has always
// given them, application/vnd.campfire.mention. Files go as messages of their own, from the composer's
// button rather than the editor's, and there's one heading, as Trix had.
configure({
  global: { attachmentContentTypeNamespace: "campfire", extensions: [CampfireRichTextExtension] },
  default: { toolbar: { attachments: false }, headings: ["h1"] },
});

/**
 * The @ prompt: typing @ lists the people `src` answers with as prompt items, those whose names hold
 * what follows the @, which Lexxy adds as `filter`. Lexxy opens the list under the cursor where it fits
 * the window, or else above it, or always above it with `above`.
 */
function mentionPrompt(src: string, above: boolean): HTMLElement {
  const prompt = document.createElement("lexxy-prompt");
  const attributes = { trigger: "@", name: "mention", src, "remote-filtering": "true", "empty-results": "No matches" };
  for (const [name, value] of Object.entries(attributes)) prompt.setAttribute(name, value);
  if (above) prompt.setAttribute("vertical-direction", "top");
  return prompt;
}

/** The class Lexxy gives the @ prompt's list while it shows. */
const LIST_SHOWN = "lexxy-prompt-menu--visible";

/** Marks the `lexxy:change` that has the @ prompt look again at what's typed, which changes nothing written. */
const LOOK_AGAIN = Symbol("look again");

/**
 * Has `lexxy`'s @ prompt list the people for what's typed after the @ as the list shows, when that's
 * changed since the prompt asked for the list. Lexxy (0.9.24, and still 1.0.1) hears what's typed only
 * once the list shows, so a quick "@ka" would list everyone until the next key. Lexxy reads what's typed
 * as it adds the list to the editor, and as it unpins the list (`data-anchored`) to open it again.
 */
function lookAgainAsListShows(lexxy: LexxyEditor): MutationObserver {
  const typed = () => lexxy.contents.textBackUntil("@");
  let asked = "";
  const observer = new MutationObserver((records) => {
    for (const { type, target, addedNodes, attributeName, oldValue } of records) {
      const list = target as Element;
      if (type === "childList") {
        const added = [...addedNodes].find((node) => node instanceof Element && node.classList.contains("lexxy-prompt-menu"));
        if (!added) continue;
        asked = typed();
        observer.observe(added, { attributeFilter: ["class", "data-anchored"], attributeOldValue: true });
      } else if (attributeName === "data-anchored") {
        if (!list.hasAttribute("data-anchored")) asked = typed();
      } else if (list.classList.contains(LIST_SHOWN) && !oldValue?.includes(LIST_SHOWN) && typed() !== asked) {
        lexxy.dispatchEvent(new CustomEvent("lexxy:change", { detail: LOOK_AGAIN }));
      }
    }
  });
  observer.observe(lexxy, { childList: true });
  return observer;
}

/**
 * The text before the cursor in its paragraph's run of plain text, where a :code can be typed, with that
 * run's node, or null where it can't: with text selected, or in code. Read in an update or a read of the
 * editor's state.
 */
function $textBeforeCursor(): { node: string; text: string } | null {
  const selection = Lexical.$getSelection();
  if (!Lexical.$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const node = selection.anchor.getNode();
  if (!Lexical.$isTextNode(node) || node.hasFormat("code") || node.getParent()?.getType() === "code") return null;
  return { node: node.getKey(), text: node.getTextContent().slice(0, selection.anchor.offset) };
}

/** Updates that write what was written before, which a colon in them doesn't close a code in. */
const NOT_TYPED = ["historic", "paste", "collaboration"];

/**
 * Whether `now`, the text before the cursor after an update, is `then`'s with what was just typed after
 * it, ending in a colon, in the same run of text.
 */
const typedColon = (then: { node: string; text: string } | null, now: { node: string; text: string }) =>
  then?.node === now.node && now.text.length > then.text.length && now.text.startsWith(then.text) && now.text.endsWith(":");

/** Writes `text` in place of the `length` characters before the cursor, leaving the cursor after it. */
function replaceBeforeCursor(lexxy: LexxyEditor, length: number, text: string): void {
  lexxy.editor.update(() => {
    const selection = Lexical.$getSelection();
    if (!Lexical.$isRangeSelection(selection) || !selection.isCollapsed()) return;
    const node = selection.anchor.getNode();
    if (Lexical.$isTextNode(node)) node.spliceText(selection.anchor.offset - length, length, text, true);
  });
}

/**
 * Puts the emoji of a code that `colon` closes, typed after the text before the cursor, in the code's
 * place, in `skinTone` if it comes in tones, returning whether there was one. The emoji have to have loaded.
 */
function closeCode(lexxy: LexxyEditor, colon: ":" | "", skinTone: SkinTone): boolean {
  const index = loadedEmoji();
  const before = lexxy.editor.getEditorState().read($textBeforeCursor);
  const closed = index && before !== null ? closedCode(index, before.text + colon, skinTone) : null;
  if (!closed) return false;
  rememberEmoji(closed.base);
  replaceBeforeCursor(lexxy, closed.typed.length - colon.length, closed.emoji);
  return true;
}

/** Where the `length` characters before the cursor are on the page, which the emoji a code finds open by. */
function textBeforeCursorRect(length: number): DOMRect | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset >= length) {
    range.setStart(range.startContainer, range.startOffset - length);
  }
  const rect = range.getBoundingClientRect();
  return rect.height > 0 ? rect : null;
}

/** A `<lexxy-editor>`, as far as this uses it. */
type LexxyEditor = HTMLElement & {
  value: string;
  readonly isBlank: boolean;
  readonly hasOpenPrompt: boolean;
  /** Its contenteditable, which Lexxy names after it once it's connected. */
  readonly editorContentElement?: HTMLElement;
  /** What's written, as Lexxy reads it: `textBackUntil` is what follows the last `text` before the cursor, to the end of its word. */
  readonly contents: { textBackUntil(text: string): string };
  readonly selection: { placeCursorAtTheEnd(): void };
  /** Its Lexical editor. */
  readonly editor: {
    update(change: () => void, options?: { discrete: boolean }): void;
    getEditorState(): EditorState;
    /** Whether an input method is composing what's typed. */
    isComposing(): boolean;
    /**
     * Calls `listener` after each change to what's written or where the cursor is, with the nodes whose
     * text it changed and what made it, until the function it returns is called.
     */
    registerUpdateListener(listener: (update: { editorState: EditorState; dirtyLeaves: ReadonlySet<string>; tags: ReadonlySet<string> }) => void): () => void;
  };
};

/** What's written in a Lexical editor, and where the cursor is, at some moment. */
interface EditorState {
  read<T>(reading: () => T): T;
}

/** A link pasted in the editor, as Lexxy tells of it with `lexxy:insert-link`. */
export interface PastedLink {
  url: string;
  /** Adds an attachment of `contentType`, `html` its content, after the paragraph the link is in, if it's still there. */
  insertBelowLink(html: string, options: { attachment: { contentType: string } }): void;
}

export interface RichTextEditorHandle {
  /** What's written, as Lexxy's markup. */
  value(): string;
  /** Empties it, leaving no formatting on for what's typed next. */
  clear(): void;
  /** Whether nothing but white space is written. */
  isBlank(): boolean;
  /** Whether a list it offers, such as the people to mention or emoji, is open, which takes Enter for itself. */
  hasOpenPrompt(): boolean;
  focus(): void;
  /** Writes `markup` in place of what's written, then takes focus with the cursor at the end, as Quote does. */
  replace(markup: string): void;
}

interface Props {
  /** What screen readers call it. */
  label: string;
  placeholder?: string;
  /** How many lines it has room for while empty. */
  rows: number;
  /** What's written in it as it opens, as Lexxy's markup. */
  initialValue?: string;
  /** Where its @ prompt asks for the people it offers (`mentionPromptSrc`), as it opens. Without it, @ is just @. */
  mentionsFrom?: string;
  /** Whether the people @ lists show above the text even where there's room below it, as it opens. */
  mentionsAbove?: boolean;
  /**
   * Whether it takes focus once it's ready, with the cursor after what's written. A function is asked
   * then, since it may be ready only after you've moved on.
   */
  autoFocus?: boolean | (() => boolean);
  /** Called when what's written changes, other than as it opens. */
  onChange?: () => void;
  /** Called for each key pressed in its text before the editor sees it, which stopping the event's propagation keeps from the editor. */
  onKeyDown?: (event: KeyboardEvent) => void;
  /** Called when an address is pasted as a link. */
  onLinkPasted?: (link: PastedLink) => void;
  ref?: Ref<RichTextEditorHandle>;
}

/**
 * A `<lexxy-editor>`. React would set its attributes as properties, and some of Lexxy's can only be
 * read or throw before it's connected, so it's built here, in a `<div>` React leaves alone.
 *
 * Emoji are typed by their :codes, as in Slack: a colon and two letters or more list the emoji they find,
 * Enter or Tab putting the one picked in the code's place, and a code's closing colon puts its emoji there.
 */
export default function RichTextEditor({
  label,
  placeholder,
  rows,
  initialValue,
  mentionsFrom,
  mentionsAbove = false,
  autoFocus = false,
  onChange,
  onKeyDown,
  onLinkPasted,
  ref,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<LexxyEditor>(null);
  const emojiList = useId();
  // What's typed of a :code that ends at the cursor, after its colon.
  const [typed, setTyped] = useState<string | null>(null);
  const emoji = useEmojiSuggestions(typed, (match) => {
    if (editor.current && typed !== null) replaceBeforeCursor(editor.current, typed.length + 1, `${match.emoji} `);
  });
  const emojiOpen = useRef(false);
  useLayoutEffect(() => {
    emojiOpen.current = emoji.open;
  });

  useImperativeHandle(ref, () => ({
    value: () => editor.current?.value ?? "",
    clear: () => {
      const lexxy = editor.current;
      if (!lexxy) return;
      lexxy.value = "";
      // Lexxy keeps the format the cursor had, so a message sent all in bold would leave the next one bold
      // too, with the toolbar that would show it shut.
      lexxy.editor.update(
        () => {
          const selection = Lexical.$getSelection();
          if (!Lexical.$isRangeSelection(selection)) return;
          selection.setFormat(0);
          selection.setStyle("");
        },
        { discrete: true },
      );
    },
    isBlank: () => editor.current?.isBlank ?? true,
    hasOpenPrompt: () => emojiOpen.current || (editor.current?.hasOpenPrompt ?? false),
    focus: () => editor.current?.focus(),
    // Campfire's composer_controller.js#replaceMessageContent, for what Quote writes.
    replace: (markup) => {
      const lexxy = editor.current;
      if (!lexxy) return;
      lexxy.value = markup;
      lexxy.focus();
      lexxy.selection.placeCursorAtTheEnd();
    },
  }));

  // The keys the emoji list takes, and a code's closing colon, are kept from the editor and whoever's
  // listening, the colon going unwritten.
  const emojiKeyDown = useEffectEvent((lexxy: LexxyEditor, event: KeyboardEvent) => {
    if (emoji.keyDown(event)) return true;
    if (event.key !== ":" || event.isComposing || !closeCode(lexxy, ":", emoji.skinTone)) return false;
    event.preventDefault();
    return true;
  });
  // A closing colon the editor wrote anyway closes its code once it's written: one that came before the
  // emoji loaded, once they have, if the cursor's still after it, and one from a keyboard that doesn't
  // say which key it was, as phones' often don't.
  const colonWritten = useEffectEvent((lexxy: LexxyEditor) => {
    if (loadedEmoji()) closeCode(lexxy, "", emoji.skinTone);
    else loadEmoji().then(() => closeCode(lexxy, "", emoji.skinTone), () => {});
  });
  const changed = useEffectEvent(() => onChange?.());
  const keyPressed = useEffectEvent((event: KeyboardEvent) => onKeyDown?.(event));
  const linkPasted = useEffectEvent((link: PastedLink) => onLinkPasted?.(link));
  const ready = useEffectEvent((lexxy: LexxyEditor) => {
    if (!(typeof autoFocus === "function" ? autoFocus() : autoFocus)) return;
    lexxy.focus();
    lexxy.selection.placeCursorAtTheEnd();
  });

  // Built once, as it opens.
  useEffect(() => {
    const lexxy = document.createElement("lexxy-editor") as LexxyEditor;
    lexxy.className = "lexxy-content";
    lexxy.setAttribute("rows", String(rows));
    // Mentions and link previews, which only the composer adds, but every editor keeps.
    lexxy.setAttribute("permitted-attachment-types", `${MENTION_CONTENT_TYPE} ${OPENGRAPH_EMBED_CONTENT_TYPE}`);
    // Read as the editor connects, without telling anyone it changed.
    if (initialValue) lexxy.setAttribute("value", initialValue);
    lexxy.addEventListener("lexxy:change", (event) => {
      if ((event as CustomEvent).detail !== LOOK_AGAIN) changed();
    });
    lexxy.addEventListener("lexxy:initialize", () => ready(lexxy), { once: true });
    let stopReadingCodes = () => {};
    lexxy.addEventListener(
      "lexxy:initialize",
      () => {
        // What was before the cursor last, outside what an input method's composing.
        let then: { node: string; text: string } | null = null;
        stopReadingCodes = lexxy.editor.registerUpdateListener(({ editorState, dirtyLeaves, tags }) => {
          const now = editorState.read($textBeforeCursor);
          setTyped(now === null ? null : typedCode(now.text));
          if (lexxy.editor.isComposing()) return;
          const colon = now !== null && dirtyLeaves.has(now.node) && !NOT_TYPED.some((tag) => tags.has(tag)) && typedColon(then, now);
          then = now;
          // After this update, as one of its own.
          if (colon) queueMicrotask(() => colonWritten(lexxy));
        });
      },
      { once: true },
    );
    // The list goes as the text loses focus, and shows again as you type on.
    lexxy.addEventListener("focusout", (event) => {
      if (!lexxy.contains(event.relatedTarget as Node | null)) setTyped(null);
    });
    lexxy.addEventListener("lexxy:insert-link", (event) => linkPasted((event as CustomEvent<PastedLink>).detail));
    // Before Lexical's own handlers, which are on the contenteditable inside, and only for the text's
    // keys, not those of the toolbar's buttons and fields.
    const keyDown = (event: KeyboardEvent) => {
      if (!lexxy.editorContentElement?.contains(event.target as Node)) return;
      if (emojiKeyDown(lexxy, event)) event.stopPropagation();
      else keyPressed(event);
    };
    lexxy.addEventListener("keydown", keyDown, { capture: true });
    // Inside the editor, which finds it there as it connects.
    if (mentionsFrom) lexxy.append(mentionPrompt(mentionsFrom, mentionsAbove));
    const prompting = mentionsFrom ? lookAgainAsListShows(lexxy) : undefined;
    editor.current = lexxy;
    host.current!.append(lexxy);
    return () => {
      stopReadingCodes();
      prompting?.disconnect();
      lexxy.remove();
      editor.current = null;
    };
  }, []);

  // Lexxy copies its label and placeholder to its contenteditable only as it connects.
  useEffect(() => {
    const lexxy = editor.current!;
    for (const element of [lexxy, lexxy.editorContentElement]) {
      element?.setAttribute("aria-label", label);
      if (placeholder === undefined) element?.removeAttribute("placeholder");
      else element?.setAttribute("placeholder", placeholder);
    }
  }, [label, placeholder]);

  // The text names the emoji list while it's open, and the emoji Enter would pick, as Lexxy's @ prompt does.
  useEffect(() => {
    const text = editor.current?.editorContentElement;
    if (!text || !emoji.open) return;
    text.setAttribute("aria-controls", emojiList);
    text.setAttribute("aria-activedescendant", `${emojiList}-${emoji.active}`);
    return () => {
      text.removeAttribute("aria-controls");
      text.removeAttribute("aria-activedescendant");
    };
  }, [emoji.open, emoji.active, emojiList]);

  return (
    <>
      <div ref={host} className="contents" />
      {typed !== null && (
        <EmojiSuggestions
          id={emojiList}
          state={emoji}
          typed={typed}
          anchor={() => textBeforeCursorRect(typed.length + 1)}
          // A message's editor is in the timeline, and the composer below it.
          within={() => host.current?.closest('[role="log"]') ?? null}
        />
      )}
    </>
  );
}
