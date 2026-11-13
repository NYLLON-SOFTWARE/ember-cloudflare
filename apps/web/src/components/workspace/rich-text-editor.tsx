import { configure, Extension, Lexical, type ElementNode, type LexicalEditor, type LexicalNode } from "@37signals/lexxy";
import { MENTION_CONTENT_TYPE, OPENGRAPH_EMBED_CONTENT_TYPE, writtenBody } from "@ember/richtext/dom";
import { useEffect, useEffectEvent, useImperativeHandle, useRef, type Ref } from "react";
import { HEADING_TAGS, NO_FORMATS, type Block, type Format, type Formats } from "./formatting";
import { $isolateCaretLine, registerQuoteLines } from "./quote-lines";
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
    return this.defineExtension({
      name: "campfire/rich-text",
      nodes: [CiteNode],
      register: (editor: LexicalEditor) => {
        const stopQuoting = registerQuoteLines(editor);
        const stopSpacing = registerSpaceAfterBareAt(editor);
        return () => {
          stopQuoting();
          stopSpacing();
        };
      },
    });
  }
}

/**
 * Has a space typed straight after an @, before any of a name, type a space, which shuts the @ prompt's
 * list, rather than mention whoever it lists first, as Lexxy's space picks the person highlighted.
 * Heard before Lexxy's own, which it registers as its list opens.
 */
function registerSpaceAfterBareAt(editor: LexicalEditor): () => void {
  return editor.registerCommand(
    Lexical.KEY_SPACE_COMMAND,
    (event: KeyboardEvent) => {
      const selection = Lexical.$getSelection();
      if (!Lexical.$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== "text") return false;
      const before = selection.anchor.getNode().getTextContent().slice(0, selection.anchor.offset);
      if (!/(^|\s)@$/.test(before)) return false;
      // Written here, rather than by the browser, whose input Lexxy would take as picking someone too.
      event.preventDefault();
      selection.insertText(" ");
      return true;
    },
    Lexical.COMMAND_PRIORITY_CRITICAL,
  );
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

/** Lexxy's commands for each of the toolbar's formats, which its own toolbar's buttons dispatch. */
const COMMANDS: Record<Exclude<Format, "code" | "codeBlock">, string> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strikethrough: "strikethrough",
  numberedList: "insertOrderedList",
  bulletList: "insertUnorderedList",
  quote: "insertQuoteBlock",
  divider: "insertHorizontalDivider",
};

/** Whether the selection, a cursor too, has `format` on, for what's typed next, inside a read of the editor's state. */
function selectionHasFormat(format: string): boolean {
  const selection = Lexical.$getSelection();
  return Lexical.$isRangeSelection(selection) && selection.hasFormat(format);
}

/**
 * `markup` without the empty paragraphs at its end, as leaving a list with Enter leaves one, which would send
 * a blank line after the message.
 */
const withoutTrailingBlankLines = (markup: string) => markup.replace(/(?:<p>(?:<br>)?<\/p>)+$/, "");

/**
 * Whether `markup` holds nothing to send: no text, no divider and nothing attached, as an empty list that
 * select-all and Delete leave, which Lexxy doesn't count as blank.
 */
const holdsNothing = (markup: string) => !/<(?:hr|img|action-text-attachment)\b/.test(markup) && writtenBody(markup).plainText.trim() === "";

/** Puts the cursor where the selection ends, inside an update. */
function collapseToEnd(): void {
  const selection = Lexical.$getSelection();
  if (!Lexical.$isRangeSelection(selection) || selection.isCollapsed()) return;
  const end = selection.focus.getNode();
  if (Lexical.$isTextNode(end)) end.select(selection.focus.offset, selection.focus.offset);
}

/** What the text at the cursor is, read inside the editor's state. */
function formatsAt(lexxy: LexxyEditor): Formats {
  const format = lexxy.selection.getFormat();
  if (format.isBold === undefined) return NO_FORMATS;
  const codeBlock = lexxy.selection.isInsideCodeBlock;
  const block: Block = format.headingTag === HEADING_TAGS.heading ? "heading" : format.isInHeading ? "subheading" : "paragraph";
  return {
    bold: format.isBold,
    italic: format.isItalic === true,
    underline: format.isUnderline === true,
    strikethrough: format.isStrikethrough === true,
    // Turned on at the cursor for what's typed next, as well as in code already.
    code: (format.isInCode === true || selectionHasFormat("code")) && !codeBlock,
    link: format.isInLink === true,
    block,
    list: format.isInList ? (format.listType === "number" ? "number" : "bullet") : null,
    quote: format.isInQuote === true,
    codeBlock,
  };
}

/**
 * Starts a code block once a line holds only three backticks, with the cursor after them, as Slack does,
 * taking the backticks out: Lexical's own shortcut waits for a space after them. Watches what's written
 * rather than the keys pressed, since phones' keyboards, and pasting, write without them.
 */
function startCodeBlocks(lexxy: LexxyEditor): () => void {
  const fence = () => {
    const selection = Lexical.$getSelection();
    if (!Lexical.$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== "text") return null;
    const text = selection.anchor.getNode();
    const line = text.getParent();
    // A line of its own, whichever of a paragraph's lines Shift+Enter broke it into.
    const alone = (node: LexicalNode | null) => node === null || Lexical.$isLineBreakNode(node);
    const atEnd = Lexical.$isTextNode(text) && selection.anchor.offset === text.getTextContent().length;
    const fenced =
      atEnd &&
      Lexical.$isParagraphNode(line) &&
      (line.getTextContent() === "```" || (text.getTextContent() === "```" && alone(text.getPreviousSibling()) && alone(text.getNextSibling())));
    return fenced ? text : null;
  };
  return lexxy.editor.registerUpdateListener(({ editorState }) => {
    let fenced = false;
    editorState.read(() => (fenced = fence() !== null));
    if (!fenced) return;
    lexxy.editor.update(() => {
      const text = fence();
      if (!text) return;
      const line = text.getParent()!;
      // Typing can leave the backticks in more than one piece of text, which all go.
      if (line.getTextContent() === "```") {
        for (const node of line.getChildren()) if (node !== text) node.remove();
      } else {
        $isolateCaretLine();
      }
      text.setTextContent("");
      text.select(0, 0);
      lexxy.contents.toggleCodeBlock();
    });
  });
}

/** The link `node` is in, if it's in one, as Lexical's LinkNode has it. */
function linkAround(node: LexicalNode | null): (ElementNode & { getURL(): string }) | null {
  for (let at = node; at; at = at.getParent()) if (at.getType() === "link") return at as ElementNode & { getURL(): string };
  return null;
}

/**
 * Turns off what was on at the cursor as the text is emptied, by deleting all of it, say, as sending it
 * does (`clear`), so what's written next starts plain, rather than in the code or bold that was deleted.
 * Only as it empties: a format turned on in an empty box stays for what's typed.
 */
function forgetFormatsAsEmptied(lexxy: LexxyEditor): () => void {
  let wasEmpty = true;
  return lexxy.editor.registerUpdateListener(({ editorState }) => {
    let empty = false;
    editorState.read(() => (empty = Lexical.$getRoot().getTextContent() === ""));
    const emptied = empty && !wasEmpty;
    wasEmpty = empty;
    if (!emptied) return;
    lexxy.editor.update(() => {
      const selection = Lexical.$getSelection();
      if (!Lexical.$isRangeSelection(selection)) return;
      selection.setFormat(0);
      selection.setStyle("");
    });
  });
}

/**
 * Code turned on at the cursor, with nothing selected, for what's typed there next, which Lexxy would turn
 * off again in a moment: its update listener takes the code a selection carries over text that isn't code
 * for code left behind once deleted (#clearStaleInlineCodeFormat). Until something's typed, the cursor
 * moves or Code goes off, it's turned back on as Lexxy turns it off, in an update Lexxy's listener passes
 * over. Each editor's, for Code to say it was turned on.
 */
const heldCode = new WeakMap<LexxyEditor, () => void>();

function holdCodeTurnedOn(lexxy: LexxyEditor): () => void {
  let held: { key: string; offset: number } | null = null;
  // Called in the update that turns Code on or off.
  heldCode.set(lexxy, () => {
    const selection = Lexical.$getSelection();
    const on = Lexical.$isRangeSelection(selection) && selection.isCollapsed() && selection.hasFormat("code");
    held = on ? { key: selection.anchor.key, offset: selection.anchor.offset } : null;
  });
  const stop = lexxy.editor.registerUpdateListener(({ editorState }) => {
    if (!held) return;
    let lost = false;
    editorState.read(() => {
      const selection = Lexical.$getSelection();
      const there = held !== null && Lexical.$isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.key === held.key && selection.anchor.offset === held.offset;
      if (!there) held = null;
      else lost = !selection.hasFormat("code");
    });
    if (!lost) return;
    lexxy.editor.update(
      () => {
        const selection = Lexical.$getSelection();
        if (Lexical.$isRangeSelection(selection) && !selection.hasFormat("code")) selection.toggleFormat("code");
      },
      { tag: "history-merge" },
    );
  });
  return () => {
    stop();
    heldCode.delete(lexxy);
  };
}

/** Whether two readings of the text at the cursor differ, so the toolbar redraws only when they do. */
const sameFormats = (a: Formats, b: Formats) => (Object.keys(a) as (keyof Formats)[]).every((key) => a[key] === b[key]);

/** A `<lexxy-editor>`, as far as this uses it. */
type LexxyEditor = HTMLElement & {
  value: string;
  readonly isBlank: boolean;
  readonly hasOpenPrompt: boolean;
  /** Its contenteditable, which Lexxy names after it once it's connected. */
  readonly editorContentElement?: HTMLElement;
  readonly selection: {
    placeCursorAtTheEnd(): void;
    /** What the text at the cursor is, inside an update or a read of the editor's state: empty where there's no cursor. */
    getFormat(): Partial<{
      isBold: boolean;
      isItalic: boolean;
      isUnderline: boolean;
      isStrikethrough: boolean;
      isInLink: boolean;
      isInQuote: boolean;
      isInHeading: boolean;
      isInCode: boolean;
      headingTag: string | null;
      isInList: boolean;
      listType: string | null;
    }>;
    readonly isInsideCodeBlock: boolean;
  };
  /** Turns the lines at the cursor into a code block, or a code block back into lines, inside an update. */
  readonly contents: { textBackUntil(text: string): string; toggleCodeBlock(): void; insertHtml(markup: string): void };
  /** Its Lexical editor. */
  readonly editor: {
    /** `tag` marks the update for listeners, as "history-merge" adds it to the last undo step. */
    update(change: () => void, options?: { discrete?: boolean; tag?: string }): void;
    dispatchCommand(command: unknown, payload?: unknown): boolean;
    registerUpdateListener(listener: (update: { editorState: { read(read: () => void): void } }) => void): () => void;
    getEditorState(): { read<T>(read: () => T): T };
    focus(): void;
  };
};

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
  /** Whether a list it offers, such as the people to mention, is open, which takes Enter for itself. */
  hasOpenPrompt(): boolean;
  focus(): void;
  /** Writes `markup` in place of what's written, then takes focus with the cursor at the end, as Quote does. */
  replace(markup: string): void;
  /** Turns `format` on or off for what's selected, or the lines at the cursor, or adds a divider, keeping focus in the text. */
  format(format: Format): void;
  /** Turns the lines at the cursor into `block`. */
  setBlock(block: Block): void;
  /**
   * Links what's selected to `url`, written as `text` where that's given and differs, or writes `text` or
   * `url` linked at the cursor, or with null unlinks the link at the cursor.
   */
  link(url: string | null, text?: string): void;
  /** What the Link field starts with: the text selected, or of the link at the cursor, and that link's address. */
  linkDraft(): { text: string; url: string };
  /** Writes `text` at the cursor, taking focus. */
  insertText(text: string): void;
  /** Writes `markup` at the cursor, as pasting it would, taking focus. */
  insertHtml(markup: string): void;
  /** Writes an @ at the cursor, after a space if it follows a word, which opens the list of people to mention. */
  startMention(): void;
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
  /**
   * Whether it has Lexxy's toolbar, as it opens: the composer draws its own, and hears what the text at the
   * cursor is from `onFormats`.
   */
  toolbar?: boolean;
  /** Called with what the text at the cursor is whenever that changes. */
  onFormats?: (formats: Formats) => void;
  ref?: Ref<RichTextEditorHandle>;
}

/**
 * A `<lexxy-editor>`. React would set its attributes as properties, and some of Lexxy's can only be
 * read or throw before it's connected, so it's built here, in a `<div>` React leaves alone.
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
  toolbar = true,
  onFormats,
  ref,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<LexxyEditor>(null);

  useImperativeHandle(ref, () => ({
    value: () => withoutTrailingBlankLines(editor.current?.value ?? ""),
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
    isBlank: () => {
      const lexxy = editor.current;
      return !lexxy || lexxy.isBlank || holdsNothing(lexxy.value);
    },
    hasOpenPrompt: () => editor.current?.hasOpenPrompt ?? false,
    focus: () => editor.current?.focus(),
    format: (format) =>
      change((lexxy) => {
        // A list, a quote or a code block takes just the line the caret's on, as Slack's buttons do, rather
        // than every line Shift+Enter broke the paragraph into.
        if (format === "numberedList" || format === "bulletList" || format === "quote" || format === "codeBlock") $isolateCaretLine();
        if (format === "code") {
          lexxy.editor.dispatchCommand(Lexical.FORMAT_TEXT_COMMAND, "code");
          heldCode.get(lexxy)?.();
        }
        else if (format === "codeBlock") lexxy.contents.toggleCodeBlock();
        else lexxy.editor.dispatchCommand(COMMANDS[format]);
      }),
    setBlock: (block) =>
      change((lexxy) => {
        if (block === "paragraph") lexxy.editor.dispatchCommand("setFormatParagraph");
        else lexxy.editor.dispatchCommand("applyHeadingFormat", HEADING_TAGS[block]);
      }),
    link: (url, text) =>
      change((lexxy) => {
        if (url === null) return void lexxy.editor.dispatchCommand("unlink");
        const selection = Lexical.$getSelection();
        if (Lexical.$isRangeSelection(selection)) {
          // A link at the cursor is changed whole, as Slack's Edit link does.
          const link = linkAround(selection.anchor.getNode());
          if (link && selection.isCollapsed()) link.select(0, link.getChildrenSize());
          const selected = Lexical.$getSelection();
          if (text && Lexical.$isRangeSelection(selected) && selected.getTextContent() !== text) {
            selected.insertText(text);
            const { anchor } = selected;
            const written = anchor.getNode();
            if (Lexical.$isTextNode(written)) written.select(anchor.offset - text.length, anchor.offset);
          }
        }
        lexxy.editor.dispatchCommand("link", url);
        // The cursor goes after the link, rather than leaving it selected for the next key to replace, in an
        // update of its own, after the one Lexxy's command queues to make the link.
        lexxy.editor.update(collapseToEnd);
      }),
    linkDraft: () => {
      const lexxy = editor.current;
      if (!lexxy) return { text: "", url: "" };
      return lexxy.editor.getEditorState().read(() => {
        const selection = Lexical.$getSelection();
        if (!Lexical.$isRangeSelection(selection)) return { text: "", url: "" };
        const link = linkAround(selection.anchor.getNode());
        const text = selection.isCollapsed() ? (link?.getTextContent() ?? "") : selection.getTextContent();
        return { text, url: link?.getURL() ?? "" };
      });
    },
    insertText: (text) =>
      change(() => {
        const selection = Lexical.$getSelection();
        if (Lexical.$isRangeSelection(selection)) selection.insertText(text);
      }),
    insertHtml: (markup) => {
      const lexxy = editor.current;
      if (!lexxy) return;
      lexxy.contents.insertHtml(markup);
      lexxy.editor.focus();
    },
    startMention: () => {
      // Focused first: a "@" written while the editor's blurred loses the cursor as focus comes back, so the
      // @ prompt, finding it before the "@", shuts its list as it opens.
      editor.current?.focus();
      change(() => {
        const selection = Lexical.$getSelection();
        if (!Lexical.$isRangeSelection(selection)) return;
        const before = selection.isCollapsed() && selection.anchor.type === "text" ? selection.anchor.getNode().getTextContent().slice(0, selection.anchor.offset) : "";
        selection.insertText(before === "" || /\s$/.test(before) ? "@" : " @");
      });
    },
    // Campfire's composer_controller.js#replaceMessageContent, for what Quote writes.
    replace: (markup) => {
      const lexxy = editor.current;
      if (!lexxy) return;
      lexxy.value = markup;
      lexxy.focus();
      lexxy.selection.placeCursorAtTheEnd();
    },
  }));

  /**
   * Changes the text in an update of the editor's own, as Lexxy's toolbar does, then has it take focus
   * back, with the cursor where it was, for typing on.
   */
  const change = (update: (lexxy: LexxyEditor) => void) => {
    const lexxy = editor.current;
    if (!lexxy) return;
    lexxy.editor.update(() => update(lexxy));
    // Only where the text lost focus: focusing it again can set the selection afresh, which loses a format
    // turned on at the cursor for what's typed next, as Code with nothing selected is.
    if (!lexxy.editorContentElement?.contains(document.activeElement)) lexxy.editor.focus();
  };

  const changed = useEffectEvent(() => onChange?.());
  const formatsChanged = useEffectEvent((formats: Formats) => onFormats?.(formats));
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
    if (!toolbar) lexxy.setAttribute("toolbar", "false");
    // Mentions and link previews, which only the composer adds, but every editor keeps.
    lexxy.setAttribute("permitted-attachment-types", `${MENTION_CONTENT_TYPE} ${OPENGRAPH_EMBED_CONTENT_TYPE}`);
    // Read as the editor connects, without telling anyone it changed.
    if (initialValue) lexxy.setAttribute("value", initialValue);
    lexxy.addEventListener("lexxy:change", (event) => {
      if ((event as CustomEvent).detail !== LOOK_AGAIN) changed();
    });
    let formats = NO_FORMATS;
    let stopReading: (() => void) | undefined;
    let stopFencing: (() => void) | undefined;
    let stopForgetting: (() => void) | undefined;
    let stopHolding: (() => void) | undefined;
    lexxy.addEventListener(
      "lexxy:initialize",
      () => {
        ready(lexxy);
        stopFencing = startCodeBlocks(lexxy);
        stopForgetting = forgetFormatsAsEmptied(lexxy);
        stopHolding = holdCodeTurnedOn(lexxy);
        stopReading = lexxy.editor.registerUpdateListener(({ editorState }) =>
          editorState.read(() => {
            const now = formatsAt(lexxy);
            if (sameFormats(now, formats)) return;
            formats = now;
            formatsChanged(now);
          }),
        );
      },
      { once: true },
    );
    lexxy.addEventListener("lexxy:insert-link", (event) => linkPasted((event as CustomEvent<PastedLink>).detail));
    // Before Lexical's own handlers, which are on the contenteditable inside, and only for the text's
    // keys, not those of the toolbar's buttons and fields.
    const keyDown = (event: KeyboardEvent) => {
      if (lexxy.editorContentElement?.contains(event.target as Node)) keyPressed(event);
    };
    lexxy.addEventListener("keydown", keyDown, { capture: true });
    // Inside the editor, which finds it there as it connects.
    if (mentionsFrom) lexxy.append(mentionPrompt(mentionsFrom, mentionsAbove));
    const prompting = mentionsFrom ? lookAgainAsListShows(lexxy) : undefined;
    editor.current = lexxy;
    host.current!.append(lexxy);
    return () => {
      stopReading?.();
      stopFencing?.();
      stopForgetting?.();
      stopHolding?.();
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

  return <div ref={host} className="contents" />;
}
