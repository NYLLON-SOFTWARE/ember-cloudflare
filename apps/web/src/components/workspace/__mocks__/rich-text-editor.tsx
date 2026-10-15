import { bodyFromPlainText, plainText } from "@ember/richtext/dom";
import { useEffect, useEffectEvent, useImperativeHandle, useRef, type ComponentProps } from "react";
import type Editor from "../rich-text-editor";

/** What Lexxy holds while nothing's written. */
const EMPTY = "<p><br></p>";

const NO_ONE = () => undefined;

/**
 * Lexxy's stand-in in unit tests, which test-setup.ts swaps in because Lexxy doesn't keep what's
 * written under jsdom: a text box whose lines are one paragraph of Lexxy's markup, which tells of
 * changes and keys as the editor does. The browser tests in e2e/ write in Lexxy itself.
 */
export default function RichTextEditor({ label, placeholder, rows, initialValue, autoFocus, onChange, onKeyDown, ref }: ComponentProps<typeof Editor>) {
  const box = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    value: () => (box.current?.value ? bodyFromPlainText(box.current.value) : EMPTY),
    clear: () => {
      if (!box.current?.value) return;
      box.current.value = "";
      onChange?.();
    },
    isBlank: () => !box.current?.value.trim(),
    hasOpenPrompt: () => false,
    focus: () => box.current?.focus(),
    replace: (markup) => {
      const text = box.current!;
      text.value = plainText(markup, NO_ONE);
      onChange?.();
      text.focus();
      text.setSelectionRange(text.value.length, text.value.length);
    },
  }));

  const keyPressed = useEffectEvent((event: KeyboardEvent) => onKeyDown?.(event));

  useEffect(() => {
    const text = box.current!;
    const listener = (event: KeyboardEvent) => keyPressed(event);
    text.addEventListener("keydown", listener, { capture: true });
    if (typeof autoFocus === "function" ? autoFocus() : autoFocus) {
      text.focus();
      text.setSelectionRange(text.value.length, text.value.length);
    }
    return () => text.removeEventListener("keydown", listener, { capture: true });
  }, []);

  return (
    <textarea
      ref={box}
      aria-label={label}
      placeholder={placeholder}
      rows={rows}
      defaultValue={initialValue && plainText(initialValue, NO_ONE)}
      onChange={() => onChange?.()}
    />
  );
}
