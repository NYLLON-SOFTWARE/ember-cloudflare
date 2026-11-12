import { bodyFromPlainText, writtenBody } from "@ember/richtext/dom";
import { createElement, useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { NO_FORMATS, type Formats } from "../formatting";
import type Editor from "../rich-text-editor";

/** What Lexxy holds while nothing's written. */
const EMPTY = "<p><br></p>";

/** What Lexxy takes for an address, pasted alone. */
const ADDRESS = /^(?:[a-z0-9]+:\/\/|www\.)\S+$/i;

/** An attachment added below a pasted link, which Lexxy shows with its content and writes after the text. */
interface Attachment {
  contentType: string;
  html: string;
}

const attachmentMarkup = ({ contentType, html }: Attachment) =>
  `<action-text-attachment content="${html.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}" content-type="${contentType}"></action-text-attachment>`;

/**
 * Lexxy's stand-in in unit tests, which test-setup.ts swaps in because Lexxy doesn't keep what's
 * written under jsdom: a text box whose lines are one paragraph of Lexxy's markup, which tells of
 * changes and keys as the editor does, and of addresses pasted in it, below which it shows what's
 * added. Formatting turns on and off as the toolbar asks, for the whole text, which it tells `onFormats` of,
 * and links are kept as `links`. The browser tests in e2e/ write in Lexxy itself.
 */
export default function RichTextEditor({ label, placeholder, rows, initialValue, autoFocus, onChange, onKeyDown, onLinkPasted, onFormats, ref }: ComponentProps<typeof Editor>) {
  const box = useRef<HTMLTextAreaElement>(null);
  // Read as soon as they change, as Lexxy's are, and shown once React renders them.
  const attachments = useRef<Attachment[]>([]);
  const [shown, show] = useState<Attachment[]>([]);
  const attach = (added: Attachment[]) => {
    attachments.current = added;
    show(added);
  };

  const formats = useRef<Formats>(NO_FORMATS);
  const reformat = (changes: Partial<Formats>) => {
    formats.current = { ...formats.current, ...changes };
    onFormats?.(formats.current);
  };
  /** Writes `text` where the cursor is, as typing it would. */
  const insert = (text: string) => {
    const field = box.current!;
    field.focus();
    field.setRangeText(text, field.selectionStart, field.selectionEnd, "end");
    onChange?.();
  };

  useImperativeHandle(ref, () => ({
    value: () => (box.current?.value ? bodyFromPlainText(box.current.value) : EMPTY) + attachments.current.map(attachmentMarkup).join(""),
    clear: () => {
      if (!box.current?.value && attachments.current.length === 0) return;
      box.current!.value = "";
      attach([]);
      onChange?.();
    },
    isBlank: () => !box.current?.value.trim(),
    hasOpenPrompt: () => false,
    focus: () => box.current?.focus(),
    replace: (markup) => {
      const text = box.current!;
      text.value = writtenBody(markup).plainText;
      attach([]);
      onChange?.();
      text.focus();
      text.setSelectionRange(text.value.length, text.value.length);
    },
    format: (format) => {
      const now = formats.current;
      if (format === "numberedList" || format === "bulletList") {
        const list = format === "numberedList" ? "number" : "bullet";
        reformat({ list: now.list === list ? null : list });
      } else if (format !== "divider") reformat({ [format]: !now[format] });
      box.current?.focus();
    },
    setBlock: (block) => reformat({ block }),
    link: (url) => {
      box.current!.dataset.link = url ?? "";
      reformat({ link: url !== null });
    },
    insertText: insert,
    insertHtml: (markup) => insert(writtenBody(markup).plainText),
    startMention: () => insert("@"),
  }));

  const keyPressed = useEffectEvent((event: KeyboardEvent) => onKeyDown?.(event));

  useEffect(() => {
    const text = box.current!;
    const listener = (event: KeyboardEvent) => keyPressed(event);
    text.addEventListener("keydown", listener, { capture: true });
    return () => text.removeEventListener("keydown", listener, { capture: true });
  }, []);

  // As it shows, rather than once React gets round to effects, so a test finds it focused when it finds it.
  useLayoutEffect(() => {
    if (!(typeof autoFocus === "function" ? autoFocus() : autoFocus)) return;
    const text = box.current!;
    text.focus();
    text.setSelectionRange(text.value.length, text.value.length);
  }, []);

  const pasted = (text: string) => {
    const url = text.trim();
    if (!ADDRESS.test(url)) return;
    onLinkPasted?.({
      url,
      insertBelowLink: (html, { attachment }) => {
        attach([...attachments.current, { contentType: attachment.contentType, html }]);
        onChange?.();
      },
    });
  };

  return (
    <>
      <textarea
        ref={box}
        aria-label={label}
        placeholder={placeholder}
        rows={rows}
        defaultValue={initialValue && writtenBody(initialValue).plainText}
        onChange={() => onChange?.()}
        onPaste={(event) => pasted(event.clipboardData.getData("text/plain"))}
      />
      {shown.map(({ contentType, html }, index) =>
        createElement("action-text-attachment", { key: index, "content-type": contentType, dangerouslySetInnerHTML: { __html: html } }),
      )}
    </>
  );
}
