import { useState, type RefObject } from "react";
import { opensLink, sendsMessage } from "@/lib/keyboard";
import { ComposerToolbar } from "./composer-toolbar";
import type { RichTextEditorHandle } from "./editor";
import { isDisabled, NO_FORMATS, type Format, type Formats } from "./formatting";

// The formatting a message is written with, as the composer has it and the message editor too, so that
// writing a message and editing one look and work alike, as in Slack: the same toolbar, which shows what's
// on at the cursor, and the same keys.

/** What Lexical's Ctrl or Cmd+B, I and U turn on. */
const SHORTCUT_FORMATS: Partial<Record<string, Format>> = { b: "bold", i: "italic", u: "underline" };

/** The format a key pressed turns on, if it's one of those. */
const formatShortcut = (event: KeyboardEvent): Format | null =>
  event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey ? (SHORTCUT_FORMATS[event.key.toLowerCase()] ?? null) : null;

/** Ctrl or Cmd+Shift+X, Slack's Strikethrough. */
const strikesThrough = (event: KeyboardEvent) => event.key.toLowerCase() === "x" && event.shiftKey && event.ctrlKey !== event.metaKey && !event.altKey;

/**
 * What's on at `editor`'s cursor, which its `onFormats` tells, its toolbar, and what its keys do: Ctrl or
 * Cmd+K opens Link, as `onShowToolbar` shows the toolbar for, Ctrl or Cmd+Shift+X strikes through, and
 * Enter does `submit`, sending or saving, except in a list, a code block or one the editor has open, such
 * as the people to mention, as `sendsMessage` decides.
 */
export function useFormatting(editor: RefObject<RichTextEditorHandle | null>, { onShowToolbar }: { onShowToolbar?: () => void } = {}) {
  const [formats, setFormats] = useState<Formats>(NO_FORMATS);
  const [linkOpen, setLinkOpen] = useState(false);

  const keyDown = (event: KeyboardEvent, submit: () => void) => {
    if (opensLink(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (isDisabled("link", formats)) return;
      onShowToolbar?.();
      setLinkOpen(true);
      return;
    }
    // Lexical's own Ctrl or Cmd+B, I and U, which the toolbar's disabled buttons don't stop, inside code.
    const shortcut = formatShortcut(event);
    if (shortcut && isDisabled(shortcut, formats)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (strikesThrough(event)) {
      event.preventDefault();
      if (!isDisabled("strikethrough", formats)) editor.current?.format("strikethrough");
      return;
    }
    if (editor.current?.hasOpenPrompt() || !sendsMessage(event, { inCodeBlock: formats.codeBlock, inList: formats.list !== null })) return;
    event.preventDefault();
    event.stopPropagation();
    submit();
  };

  const toolbar = (
    <ComposerToolbar
      formats={formats}
      onFormat={(format) => editor.current?.format(format)}
      onBlock={(block) => editor.current?.setBlock(block)}
      onLink={(url, text) => editor.current?.link(url, text)}
      linkDraft={() => editor.current?.linkDraft() ?? { text: "", url: "" }}
      linkOpen={linkOpen}
      onLinkOpenChange={setLinkOpen}
      onReturnFocus={() => editor.current?.focus()}
    />
  );

  return { formats, onFormats: setFormats, keyDown, toolbar };
}
