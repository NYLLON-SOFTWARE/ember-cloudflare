import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import type { Me } from "@ember/protocol";
import { CANVAS_CHANGED, MAX_CANVAS_LENGTH, type OpenedTab } from "@ember/protocol/library";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useNameOf } from "@/hooks/use-directory";
import type { Room } from "@/lib/api";
import { CanvasConflict, openTab, saveCanvas } from "@/lib/library";
import { dateTimeLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";

// A canvas: a document a room's members write together, with Tiptap's StarterKit, through Tiptap's core rather than
// its React package, whose CommonJS dependencies would have Rolldown move React out of the app's script. It saves a second after
// typing stops, over the version it was opened at; a save over an older version is refused, and the canvas
// then shows the one saved since. While nothing's waiting to save, it looks for others' saves every so often.

/** How long typing has to stop for before the canvas saves. */
const SAVE_AFTER_MS = 1000;
/** How often an open canvas looks for others' saves. */
const REFRESH_MS = 10_000;

type Status = "saved" | "saving" | "unsaved" | "conflict" | "too long" | "failed";

const STATUS_LABELS: Record<Status, string> = {
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  conflict: CANVAS_CHANGED,
  "too long": "Too long to save",
  failed: "Couldn’t save. Retrying when you type.",
};

interface Props {
  room: Room;
  me: Me;
  opened: OpenedTab;
  /** Called with the tab and canvas as each save leaves them. */
  onSaved: (opened: OpenedTab) => void;
  onFailed: (error: unknown) => void;
}

/** The document as a canvas keeps it. */
const bodyOf = (editor: Editor) => JSON.stringify(editor.getJSON());

export function CanvasEditor({ room, opened, onSaved, onFailed }: Props) {
  const nameOf = useNameOf();
  const canvas = opened.canvas!;
  const version = useRef(canvas.version);
  const saved = useRef(canvas.body);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<Status>("saved");
  const [lastSaved, setLastSaved] = useState({ by: canvas.updatedBy, at: canvas.updatedAt, version: canvas.version });

  const host = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  // Made once, in the element it edits, when the canvas opens.
  useEffect(() => {
    const made = new Editor({
      element: host.current!,
      extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true } })],
      content: JSON.parse(canvas.body) as object,
      editorProps: { attributes: { "aria-label": opened.tab.title, class: "outline-none" } },
      onUpdate: () => changed(),
    });
    setEditor(made);
    return () => made.destroy();
  }, []);

  /** Takes in a version someone else saved, unless there's something here still to save. */
  const adopt = (body: string, next: number) => {
    version.current = next;
    saved.current = body;
    if (editor && bodyOf(editor) !== body) editor.commands.setContent(JSON.parse(body) as object, { emitUpdate: false });
  };

  const save = useEffectEvent(async () => {
    timer.current = null;
    if (!editor) return;
    const body = bodyOf(editor);
    if (body === saved.current) return setStatus("saved");
    if (body.length > MAX_CANVAS_LENGTH) return setStatus("too long");
    setStatus("saving");
    try {
      const answer = await saveCanvas(room.id, opened.tab.id, body, version.current);
      version.current = answer.canvas!.version;
      saved.current = body;
      setLastSaved({ by: answer.canvas!.updatedBy, at: answer.canvas!.updatedAt, version: answer.canvas!.version });
      setStatus(timer.current === null && bodyOf(editor) === body ? "saved" : "unsaved");
      onSaved(answer);
    } catch (error) {
      if (error instanceof CanvasConflict) {
        adopt(error.canvas.body, error.canvas.version);
        setLastSaved({ by: error.canvas.updatedBy, at: error.canvas.updatedAt, version: error.canvas.version });
        setStatus("conflict");
      } else {
        setStatus("failed");
        onFailed(error);
      }
    }
  });

  const changed = useEffectEvent(() => {
    setStatus("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_AFTER_MS);
  });

  // Whatever's typed is saved when the canvas closes, too.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void save();
      }
    },
    [],
  );

  // Others' saves, while nothing here waits to be saved.
  const refresh = useEffectEvent(async () => {
    if (timer.current || status === "saving" || document.hidden) return;
    const latest = await openTab(room.id, opened.tab.id).catch(() => null);
    if (!latest?.canvas || latest.canvas.version <= version.current || timer.current) return;
    adopt(latest.canvas.body, latest.canvas.version);
    setLastSaved({ by: latest.canvas.updatedBy, at: latest.canvas.updatedAt, version: latest.canvas.version });
  });
  useEffect(() => {
    const interval = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editor && <Toolbar editor={editor} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto w-full max-w-[760px] px-[22px] pt-8 pb-16 max-md:px-4">
          <h1 className="mb-1 text-[28px] leading-tight font-bold">{opened.tab.title}</h1>
          <p className="mb-6 flex flex-wrap gap-x-2 text-[13px] text-muted-foreground">
            {lastSaved.version > 0 && (
              <span>
                Last edited by {nameOf(lastSaved.by)} · <time dateTime={lastSaved.at}>{dateTimeLabel(new Date(lastSaved.at))}</time>
              </span>
            )}
            <span role="status" className={cn(status === "conflict" || status === "failed" || status === "too long" ? "text-destructive" : undefined)}>
              {STATUS_LABELS[status]}
            </span>
          </p>
          <div ref={host} className={DOCUMENT} />
        </article>
      </div>
    </div>
  );
}

/** How a canvas's document reads: Ember's ink, headings, lists, quotes and code. */
const DOCUMENT = cn(
  "min-h-[50dvh] text-[16px] leading-[1.6] text-message-ink [&_.ProseMirror]:min-h-[50dvh] [&_.ProseMirror]:outline-none",
  "[&_p]:my-2 [&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-[24px] [&_h1]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-[20px] [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-[17px] [&_h3]:font-semibold",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li_p]:my-0.5",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded [&_code]:bg-hover [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-hover [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_a]:underline [&_hr]:my-6 [&_hr]:border-t",
  "[&_.ProseMirror_p.is-editor-empty:first-child]:before:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child]:before:float-left [&_.ProseMirror_p.is-editor-empty:first-child]:before:h-0",
);

/** The formatting toolbar: marks, headings, lists, a quote, code, and undo and redo. */
function Toolbar({ editor }: { editor: Editor }) {
  const active = useActive(editor, (editor) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      h1: editor.isActive("heading", { level: 1 }),
      h2: editor.isActive("heading", { level: 2 }),
      bullets: editor.isActive("bulletList"),
      numbers: editor.isActive("orderedList"),
      quote: editor.isActive("blockquote"),
      codeBlock: editor.isActive("codeBlock"),
      undo: editor.can().undo(),
      redo: editor.can().redo(),
  }));
  const chain = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-none flex-wrap items-center gap-0.5 border-b px-[18px] py-1.5 max-md:px-2">
      <Mark label="Bold" pressed={active.bold} onClick={() => chain().toggleBold().run()}>
        <b>B</b>
      </Mark>
      <Mark label="Italic" pressed={active.italic} onClick={() => chain().toggleItalic().run()}>
        <i className="font-serif">I</i>
      </Mark>
      <Mark label="Strikethrough" pressed={active.strike} onClick={() => chain().toggleStrike().run()}>
        <s>S</s>
      </Mark>
      <Mark label="Code" pressed={active.code} onClick={() => chain().toggleCode().run()}>
        <span className="font-mono text-[13px]">{"<>"}</span>
      </Mark>
      <span aria-hidden className="mx-1 h-5 w-px bg-border" />
      <Mark label="Heading" pressed={active.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
        H1
      </Mark>
      <Mark label="Subheading" pressed={active.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        H2
      </Mark>
      <Mark label="Bulleted list" pressed={active.bullets} onClick={() => chain().toggleBulletList().run()}>
        •≡
      </Mark>
      <Mark label="Numbered list" pressed={active.numbers} onClick={() => chain().toggleOrderedList().run()}>
        1≡
      </Mark>
      <Mark label="Quote" pressed={active.quote} onClick={() => chain().toggleBlockquote().run()}>
        ❝
      </Mark>
      <Mark label="Code block" pressed={active.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
        <span className="font-mono text-[13px]">{"{}"}</span>
      </Mark>
      <span aria-hidden className="mx-1 h-5 w-px bg-border" />
      <Mark label="Undo" disabled={!active.undo} onClick={() => chain().undo().run()}>
        ↶
      </Mark>
      <Mark label="Redo" disabled={!active.redo} onClick={() => chain().redo().run()}>
        ↷
      </Mark>
    </div>
  );
}

/** What `select` reads of `editor`, read again after each of its transactions. */
function useActive<T>(editor: Editor, select: (editor: Editor) => T): T {
  const [, setTransactions] = useState(0);
  useEffect(() => {
    const changed = () => setTransactions((count) => count + 1);
    editor.on("transaction", changed);
    return () => void editor.off("transaction", changed);
  }, [editor]);
  return select(editor);
}

function Mark({ label, pressed, disabled, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="grid h-8 min-w-8 cursor-pointer place-items-center rounded-md px-1.5 text-[14px] text-muted-foreground hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-40 aria-pressed:bg-hover aria-pressed:text-foreground touch:size-11"
    >
      {children}
    </button>
  );
}
