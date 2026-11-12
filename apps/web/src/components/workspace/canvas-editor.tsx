import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import type { Me } from "@ember/protocol";
import { MAX_CANVAS_LENGTH, type OpenedTab } from "@ember/protocol/library";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useNameOf } from "@/hooks/use-directory";
import type { Room } from "@/lib/api";
import { mergeCanvas } from "@/lib/canvas-merge";
import { CanvasConflict, openTab, saveCanvas, saveCanvasOnLeaving } from "@/lib/library";
import { dateTimeLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";

// A canvas: a document a room's members write together, with Tiptap's StarterKit, through Tiptap's core rather than
// its React package, whose CommonJS dependencies would have Rolldown move React out of the app's script. It saves a second after
// typing stops, over the version it was opened at; a save over an older version is refused, with the one
// saved since, and the canvas merges that into what's here (canvas-merge.ts), then saves the two together.
// While nothing's waiting to save, it looks for others' saves every so often, and merges them in the same way.
// Nothing written here is ever replaced by someone else's: where you both changed the same part, both stay.

/** How long typing has to stop for before the canvas saves. */
const SAVE_AFTER_MS = 1000;
/** How often an open canvas looks for others' saves. */
const REFRESH_MS = 10_000;
/** Marks the transactions that merge others' saves in, which aren't this person's typing. */
const MERGED = "emberCanvasMerged";

type Status = "saved" | "saving" | "unsaved" | "too long" | "failed" | "unreadable";

const STATUS_LABELS: Record<Status, string> = {
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  "too long": "Too long to save",
  failed: "Couldn’t save. Retrying when you type.",
  unreadable: "This canvas holds something Ember can’t show, so it can’t be edited here.",
};

/** What merging someone else's save in did, said until this person types again. */
type Merged = "merged" | "both kept";

const MERGED_LABELS: Record<Merged, string> = {
  merged: "Merged with someone else’s changes.",
  "both kept": "Someone else changed the same part. Both versions are kept, theirs first.",
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

/**
 * Shows `body` in `editor`, changing only what differs, outside its undo history: Undo can't take back
 * someone else's writing, nor bring back what the merge already holds.
 */
function showMerged(editor: Editor, body: string) {
  const { state } = editor;
  const next = editor.schema.nodeFromJSON(JSON.parse(body));
  const start = state.doc.content.findDiffStart(next.content);
  if (start === null) return;
  let { a: endHere, b: endThere } = state.doc.content.findDiffEnd(next.content)!;
  const overlap = start - Math.min(endHere, endThere);
  if (overlap > 0) {
    endHere += overlap;
    endThere += overlap;
  }
  editor.view.dispatch(state.tr.replace(start, endHere, next.slice(start, endThere)).setMeta("addToHistory", false).setMeta(MERGED, true));
}

export function CanvasEditor({ room, opened, onSaved, onFailed }: Props) {
  const nameOf = useNameOf();
  const canvas = opened.canvas!;
  /** The version last saved, which saves go over, and what it holds: where a merge begins. */
  const version = useRef(canvas.version);
  const saved = useRef(canvas.body);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const [status, setStatus] = useState<Status>("saved");
  const [merged, setMerged] = useState<Merged | null>(null);
  const [lastSaved, setLastSaved] = useState({ by: canvas.updatedBy, at: canvas.updatedAt, version: canvas.version });

  const host = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  // Made once, in the element it edits, when the canvas opens. A canvas holding what the editor can't
  // show would open empty, and saving that would lose it, so it opens read-only.
  useEffect(() => {
    let unreadable = false;
    const made = new Editor({
      element: host.current!,
      extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true } })],
      content: JSON.parse(canvas.body) as object,
      enableContentCheck: true,
      onContentError: () => void (unreadable = true),
      editorProps: { attributes: { "aria-label": opened.tab.title, class: "outline-none" } },
      onUpdate: ({ transaction }) => changed(transaction.getMeta(MERGED) === true),
    });
    if (unreadable) {
      made.setEditable(false);
      setStatus("unreadable");
    }
    setEditor(made);
    return () => made.destroy();
  }, []);

  /** Merges in a version someone else saved, keeping whatever's here that isn't saved yet. */
  const takeIn = (theirs: OpenedTab["canvas"] & {}) => {
    if (!editor) return;
    const mine = bodyOf(editor);
    const merge = mergeCanvas(saved.current, mine, theirs.body);
    version.current = theirs.version;
    saved.current = theirs.body;
    setLastSaved({ by: theirs.updatedBy, at: theirs.updatedAt, version: theirs.version });
    if (merge.body === mine) return;
    showMerged(editor, merge.body);
    if (mine !== theirs.body && merge.body !== theirs.body) setMerged(merge.conflicts > 0 ? "both kept" : "merged");
  };

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_AFTER_MS);
  };

  const save = useEffectEvent(async () => {
    timer.current = null;
    // A save on its way saves what's here once it's back.
    if (!editor || saving.current || status === "unreadable") return;
    const body = bodyOf(editor);
    if (body === saved.current) return setStatus("saved");
    if (body.length > MAX_CANVAS_LENGTH) return setStatus("too long");
    saving.current = true;
    setStatus("saving");
    let more = true;
    try {
      const answer = await saveCanvas(room.id, opened.tab.id, body, version.current);
      version.current = answer.canvas!.version;
      saved.current = body;
      setLastSaved({ by: answer.canvas!.updatedBy, at: answer.canvas!.updatedAt, version: answer.canvas!.version });
      onSaved(answer);
    } catch (error) {
      if (error instanceof CanvasConflict) takeIn(error.canvas);
      else {
        more = false;
        setStatus("failed");
        onFailed(error);
      }
    } finally {
      saving.current = false;
    }
    // Saves what was typed while this one was on its way, or the merge.
    if (!more) return;
    if (bodyOf(editor) === saved.current) setStatus("saved");
    else if (!timer.current) void save();
  });

  const changed = useEffectEvent((byMerge: boolean) => {
    if (!byMerge) setMerged(null);
    setStatus("unsaved");
    schedule();
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

  // And as the page goes: a reload, or the tab closing. Hidden, it saves at once; going away, it sends what's
  // unsaved in a request that outlives the page, and while something's still to save the browser asks first.
  const hidden = useEffectEvent(() => {
    if (document.visibilityState !== "hidden" || !timer.current) return;
    clearTimeout(timer.current);
    void save();
  });
  const leaving = useEffectEvent(() => {
    if (!editor || status === "unreadable") return;
    const body = bodyOf(editor);
    if (body !== saved.current && body.length <= MAX_CANVAS_LENGTH) saveCanvasOnLeaving(room.id, opened.tab.id, body, version.current);
  });
  const unsavedOnLeaving = useEffectEvent((event: BeforeUnloadEvent) => {
    if (timer.current || saving.current) event.preventDefault();
  });
  useEffect(() => {
    const whenHidden = () => hidden();
    const onPageHide = () => leaving();
    const onBeforeUnload = (event: BeforeUnloadEvent) => unsavedOnLeaving(event);
    document.addEventListener("visibilitychange", whenHidden);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", whenHidden);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  // Others' saves, while nothing here waits to be saved.
  const refresh = useEffectEvent(async () => {
    if (timer.current || saving.current || document.hidden || status === "unreadable") return;
    const latest = await openTab(room.id, opened.tab.id).catch(() => null);
    if (!latest?.canvas || latest.canvas.version <= version.current || timer.current || saving.current) return;
    takeIn(latest.canvas);
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
            <span role="status" className={cn(status === "failed" || status === "too long" || status === "unreadable" ? "text-destructive" : undefined)}>
              {STATUS_LABELS[status]}
            </span>
            {merged && (
              <span role="alert" className={cn(merged === "both kept" ? "font-medium text-destructive" : undefined)}>
                {MERGED_LABELS[merged]}
              </span>
            )}
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
