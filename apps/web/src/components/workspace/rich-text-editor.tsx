import { configure, Extension, Lexical } from "@37signals/lexxy";
import { useEffect, useEffectEvent, useImperativeHandle, useRef, type Ref } from "react";
import "./rich-text-editor.css";

// ember-rust's editor, Lexxy 0.9.24, set up as Campfire sets it up. This is a chunk of its own, loaded
// as the first editor shows (editor.ts), since it's bigger than the rest of the app.

/** Campfire's CiteNode (reference/app/javascript/lib/rich_text/cite_node.js): the `<cite>` naming whom a reply quotes. */
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
 * Campfire's CampfireRichTextExtension (reference/app/javascript/lib/rich_text/campfire_extension.js):
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
    return this.defineExtension({ name: "campfire/rich-text", nodes: [CiteNode] });
  }
}

// Campfire's settings (reference/app/javascript/initializers/rich_text.js), which have to come before
// Lexxy defines its elements, on the tick after it loads. Mentions keep the content type Campfire has
// always given them, application/vnd.campfire.mention. Files go as messages of their own, from the
// composer's button rather than the editor's, and there's one heading, as Trix had.
configure({
  global: { attachmentContentTypeNamespace: "campfire", extensions: [CampfireRichTextExtension] },
  default: { toolbar: { attachments: false }, headings: ["h1"] },
});

/** A `<lexxy-editor>`, as far as this uses it. */
type LexxyEditor = HTMLElement & {
  value: string;
  readonly isBlank: boolean;
  readonly hasOpenPrompt: boolean;
  /** Its contenteditable, which Lexxy names after it once it's connected. */
  readonly editorContentElement?: HTMLElement;
  readonly selection: { placeCursorAtTheEnd(): void };
  /** Its Lexical editor. */
  readonly editor: { update(change: () => void, options: { discrete: boolean }): void };
};

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
}

interface Props {
  /** What screen readers call it. */
  label: string;
  placeholder?: string;
  /** How many lines it has room for while empty. */
  rows: number;
  /** What's written in it as it opens, as Lexxy's markup. */
  initialValue?: string;
  /**
   * Whether it takes focus once it's ready, with the cursor after what's written. A function is asked
   * then, since it may be ready only after you've moved on.
   */
  autoFocus?: boolean | (() => boolean);
  /** Called when what's written changes, other than as it opens. */
  onChange?: () => void;
  /** Called for each key pressed in its text before the editor sees it, which stopping the event's propagation keeps from the editor. */
  onKeyDown?: (event: KeyboardEvent) => void;
  ref?: Ref<RichTextEditorHandle>;
}

/**
 * A `<lexxy-editor>`. React would set its attributes as properties, and some of Lexxy's can only be
 * read or throw before it's connected, so it's built here, in a `<div>` React leaves alone.
 */
export default function RichTextEditor({ label, placeholder, rows, initialValue, autoFocus = false, onChange, onKeyDown, ref }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<LexxyEditor>(null);

  useImperativeHandle(ref, () => ({
    value: () => editor.current?.value ?? "",
    clear: () => {
      const lexxy = editor.current;
      if (!lexxy) return;
      lexxy.value = "";
      // Lexxy keeps the format the cursor had, so in ember-rust a message sent all in bold leaves the next
      // one bold too, with the toolbar that would show it shut.
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
    hasOpenPrompt: () => editor.current?.hasOpenPrompt ?? false,
    focus: () => editor.current?.focus(),
  }));

  const changed = useEffectEvent(() => onChange?.());
  const keyPressed = useEffectEvent((event: KeyboardEvent) => onKeyDown?.(event));
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
    lexxy.setAttribute("permitted-attachment-types", "application/vnd.campfire.mention");
    // Read as the editor connects, without telling anyone it changed.
    if (initialValue) lexxy.setAttribute("value", initialValue);
    lexxy.addEventListener("lexxy:change", () => changed());
    lexxy.addEventListener("lexxy:initialize", () => ready(lexxy), { once: true });
    // Before Lexical's own handlers, which are on the contenteditable inside, and only for the text's
    // keys, not those of the toolbar's buttons and fields.
    const keyDown = (event: KeyboardEvent) => {
      if (lexxy.editorContentElement?.contains(event.target as Node)) keyPressed(event);
    };
    lexxy.addEventListener("keydown", keyDown, { capture: true });
    editor.current = lexxy;
    host.current!.append(lexxy);
    return () => {
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
