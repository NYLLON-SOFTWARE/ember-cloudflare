import { Suspense, useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { flushSync } from "react-dom";
import { isWebImage, MAX_FILE_SIZE, type User } from "@ember/protocol";
import { OPENGRAPH_EMBED_CONTENT_TYPE, previewContent, writtenBody } from "@ember/richtext/dom";
import { Page, Xmark } from "@/components/icons/iconoir";
import { useNameOf } from "@/hooks/use-directory";
import type { RoomFrames } from "@/hooks/use-room";
import { useScheduled } from "@/hooks/use-scheduled";
import { fetchLinkPreview, mentionPromptSrc } from "@/lib/api";
import { dropTarget } from "@/lib/drop-target";
import { hasTouchKeyboard, pressedAlone } from "@/lib/keyboard";
import { isEmberFile, sendableFacts, tooLargeToAttach, type EmberFile, type Sendable } from "@/lib/uploads";
import { tellDraftsChanged } from "@/lib/draft-keys";
import { cn } from "@/lib/utils";
import { COMPOSER_CARD } from "./composer-buttons";
import { AttachMenu, EmojiButton, FormattingToggle, MentionButton, SendButton } from "./composer-menus";
import { useFormatting } from "./composer-formatting";
import { RichTextEditor, editorLoaded, type PastedLink, type RichTextEditorHandle } from "./editor";
import { FilesPicker } from "./files-picker";
import { ScheduledNotice } from "./schedule-send";
import { fileSize } from "./upload-card";

/**
 * The typing indicator (Campfire's typing_tracker.js and composer.css): the names of whoever is typing,
 * sorted and comma-separated after a three-dot spinner, fading in above the composer. It isn't a live
 * region: announced on every change, a bare list of names would mean nothing out of context. Names that
 * don't fit end in an ellipsis, rather than wrapping down over the message box.
 */
function TypingIndicator({ typists }: { typists: User[] }) {
  const nameOf = useNameOf();
  const names = typists.map(nameOf).sort().join(", ");
  return (
    <div
      className={cn(
        "absolute -top-[19px] left-0 inline-flex max-w-full items-center text-[11px] transition-opacity duration-300 motion-reduce:transition-none max-md:-top-[15px]",
        !names && "opacity-0",
      )}
    >
      <div className={cn("spinner min-w-0 ps-[1.5em] leading-none", !names && "hidden")}>
        {/* The names clip, and the spinner beside them mustn't; the padding keeps descenders. */}
        <span className="-my-[0.25em] block truncate py-[0.25em]">{names}</span>
      </div>
    </div>
  );
}

/** The composer's place below the messages, which keeps clear of a phone's home bar. */
const FOOTER = "bg-background px-[22px] pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))] narrow:px-4 max-md:px-2.5 max-md:pt-2 max-md:pb-[max(10px,env(safe-area-inset-bottom))]";


/**
 * Where what someone has written in a room, or in one of its threads, and not yet sent is kept in this
 * browser, for each person apart, so whoever signs in here next doesn't see it.
 */
const draftKey = (userId: string, roomId: string, threadId?: string) => `composer-draft-${userId}-${roomId}` + (threadId === undefined ? "" : `/threads/${threadId}`);

// Storage can be unavailable, as in some private windows, which only means drafts aren't kept.
function readDraft(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function keepDraft(key: string, body: string | null) {
  try {
    if (body === null) localStorage.removeItem(key);
    else localStorage.setItem(key, body);
    // For Drafts & sent's count, which storage tells only other tabs of.
    tellDraftsChanged();
  } catch {
    // Not kept, then.
  }
}

/**
 * What the composer shows while the editor loads: its placeholder, as Lexxy draws it, as tall as the
 * editor will be (rich-text-editor.css: 40px, or 30px below 900px wide, and the 4px under the text), so
 * the composer doesn't move as the editor loads.
 */
function LoadingEditor({ placeholder }: { placeholder: string }) {
  return (
    <p aria-hidden="true" className="min-h-11 text-[15px] leading-[22px] opacity-66 max-md:min-h-[34px] touch:text-[16px]">
      {placeholder}
    </p>
  );
}

/**
 * Whether the editor shows: at once if its code has loaded, or else once `deferred` is over and the
 * browser has painted what came with it, which loading the code would hold up.
 */
function useEditorShown(deferred: boolean): boolean {
  const [shown, setShown] = useState(() => !deferred || editorLoaded());
  useEffect(() => {
    if (deferred || shown) return;
    // A timeout set in the next frame runs once that frame is painted.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => (timeout = setTimeout(() => setShown(true))));
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
  }, [deferred, shown]);
  return shown;
}

/**
 * A link pasted in the composer gets the preview of the page it goes to below its paragraph, when the
 * page has one, unless another link is pasted first, or the composer goes. Previews that can't be had
 * are left out without a word.
 */
function useLinkPreviews(): (link: PastedLink) => Promise<void> {
  const pending = useRef<AbortController>(null);
  useEffect(() => () => pending.current?.abort(), []);
  return async ({ url, insertBelowLink }) => {
    pending.current?.abort();
    const request = (pending.current = new AbortController());
    const preview = await fetchLinkPreview(url, request.signal).catch(() => null);
    if (!preview || request.signal.aborted) return;
    const content = previewContent({ href: preview.url, url: preview.image ?? undefined, filename: preview.title, description: preview.description });
    insertBelowLink(content, { attachment: { contentType: OPENGRAPH_EMBED_CONTENT_TYPE } });
  };
}

/** A file picked to send, from the computer or from Files in Ember, keyed, since two can share a name. */
interface PickedFile {
  key: number;
  file: Sendable;
}

/**
 * The files picked to send with the next message: in order of their names, leaving out any over 250 MB,
 * which it says until more are picked.
 */
function usePickedFiles() {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const lastKey = useRef(0);
  // Reads the files as they're given: a field's, a paste's or a drop's are gone once its event is over.
  const add = (picked: Iterable<Sendable>) => {
    const fitting: PickedFile[] = [];
    const refused: string[] = [];
    for (const file of picked) {
      const { name, size } = sendableFacts(file);
      if (size > MAX_FILE_SIZE) refused.push(tooLargeToAttach(name));
      else fitting.push({ key: ++lastKey.current, file });
    }
    setErrors(refused);
    if (fitting.length > 0) setFiles((files) => [...files, ...fitting].sort((a, b) => sendableFacts(a.file).name.localeCompare(sendableFacts(b.file).name)));
  };
  /** Picks a file already in Ember, which the room copies rather than this sending it again. */
  const share = (shared: EmberFile) => add([shared]);
  const remove = (key: number) => setFiles((files) => files.filter((picked) => picked.key !== key));
  return { files, errors, add, share, remove, clear: () => setFiles([]) };
}

/**
 * The address of a picture's thumbnail, which is let go once its chip goes, or for a file in Ember, the
 * preview or picture its message shows.
 */
function useThumbnail(file: Sendable): string | undefined {
  const [thumbnail, setThumbnail] = useState<string>();
  useLayoutEffect(() => {
    // A picture in Ember shows by its preview, or itself if every browser shows it: an SVG, say, is served
    // as a download, which no image shows.
    if (isEmberFile(file)) return setThumbnail(file.file.previewUrl ?? (isWebImage(file.file.contentType) ? file.file.url : undefined));
    if (!isImage(file)) return;
    const url = URL.createObjectURL(file);
    setThumbnail(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return thumbnail;
}

const isImage = (file: Sendable) => (isEmberFile(file) ? file.file.contentType : file.type).startsWith("image/");

/** A file's type as its chip says it: its extension, as Slack's do, or File for a name without one. */
export const fileType = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : "File";
};

/** The × on a chip, a fingertip's 44px on touch screens, which shows as the pointer or focus reaches the chip. */
const REMOVE =
  "absolute -end-2 -top-2 grid size-6 cursor-pointer place-items-center rounded-full bg-foreground text-background opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 touch:size-11 touch:-end-3 touch:-top-3 touch:bg-transparent touch:opacity-100 touch:[&>svg]:size-6 touch:[&>svg]:rounded-full touch:[&>svg]:bg-foreground";

/**
 * A file picked to send, as Slack's composer shows one inside its card: a picture as a 64px thumbnail, and
 * anything else as a 220×56 chip with its icon, its name, cut short at its end, and its type and size. Its
 * ×, which takes the file back out, shows as the pointer or focus reaches it, and always on touch screens.
 */
function FileChip({ file, onRemove }: { file: Sendable; onRemove: () => void }) {
  const thumbnail = useThumbnail(file);
  const { name, size } = sendableFacts(file);
  const remove = (
    <button type="button" aria-label={`Remove ${name}`} title="Remove" onClick={onRemove} className={REMOVE}>
      <Xmark className="size-3.5" />
    </button>
  );
  if (thumbnail !== undefined || (!isEmberFile(file) && isImage(file))) {
    return (
      <li className="group relative size-16 shrink-0">
        <img src={thumbnail} alt={name} className="size-16 rounded-[8px] border object-cover" />
        {remove}
      </li>
    );
  }
  return (
    <li className="group relative flex h-14 w-[220px] max-w-full shrink-0 items-center gap-2.5 rounded-[8px] border bg-background px-2.5">
      <Page className="size-9 shrink-0 rounded-[7px] bg-surface p-[7px]" />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{name}</span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {fileType(name)} · {fileSize(size)}
        </span>
      </span>
      {remove}
    </li>
  );
}

/** Whether `target` is the page itself, as when nothing has focus, rather than anything on it. */
function isPage(target: EventTarget | null): boolean {
  return target === document.body || target === document.getElementById("main-content");
}

/** Whether focus is still on `element`, or on nothing, as when what had it went away. */
function focusStayedOn(element: Element | null): boolean {
  const focused = document.activeElement;
  return !focused || focused === element || focused === document.body;
}

interface Props {
  roomId: string;
  /** The room's name as the writer reads it, which a DM's names the others in it. */
  roomName: string;
  /** Whether the room is a DM, whose name goes without a `#`. */
  direct?: boolean;
  /** Whether the room is private, whose name goes without a `#` too, as its lock in the header says. */
  closed?: boolean;
  /** Who's writing, whose drafts are their own. */
  userId: string;
  typing: User[];
  /**
   * While the room's been away a while: what's written still goes, waiting for the room, as Slack's does,
   * but files, which upload once it's there, and scheduling wait for it.
   */
  disabled: boolean;
  /**
   * Holds back the editor's code while the room's first messages are on their way, and until they're
   * painted, since loading it then would hold them up. Once it's loaded, as for a room opened before,
   * the editor shows anyway.
   */
  deferEditor?: boolean;
  /**
   * The message whose thread the composer writes replies in, which can be sent to the room too: Also send
   * to the room is ticked for that, until they've gone.
   */
  threadId?: string;
  /** The room's socket, which messages scheduled for later go over. Without it, nothing can be scheduled. */
  frames?: RoomFrames;
  /** Sends a message, its body markup, answering whether it went: one that didn't stays to be changed. */
  onSend: (body: string, alsoSend: boolean) => boolean;
  /** Sends files, each as a message of its own, before the message written with them. */
  onSendFiles: (files: Sendable[], alsoSend: boolean) => void;
  onTyping: (active: boolean) => void;
  /** Opens the editor on your newest message, for Up Arrow. */
  onEditLastMessage?: () => void;
  /**
   * Whether the formatting toolbar shows until Aa says otherwise in this browser: by default on screens with
   * a mouse and not on touch screens. A phone's layout can hide it, leaving Aa to show it on demand.
   */
  toolbarByDefault?: boolean;
  /** Buttons after @ in the bottom row, before Send, such as a phone layout's own. */
  extraButtons?: ReactNode;
  /** Whether the editor takes focus as it shows, except on touch screens, as it does unless something else is to have it. */
  autoFocus?: boolean;
  ref?: Ref<ComposerHandle>;
}

export interface ComposerHandle {
  focus(): void;
  /** Writes `markup` in place of what's written, as Quote does, taking focus. */
  replace(markup: string): void;
  /** Adds files to send with the next message, as dropping them on the room's messages does. */
  addFiles(files: Iterable<File>): void;
}

/**
 * The composer, as Slack's: a card with the formatting toolbar on top, which Aa shows and hides, then the
 * text, then + (Upload from your computer, Files in Ember), Aa, Emoji and @, and Send, whose chevron
 * schedules what's written for later. Files picked, pasted or dropped wait above the card to go with the
 * next message, under a notice of the messages you've scheduled here. What's written is kept as a draft
 * until it's sent. A thread's has Also send to the room before Send.
 */
export function Composer({
  roomId,
  roomName,
  direct = false,
  closed = false,
  userId,
  typing,
  disabled,
  deferEditor = false,
  threadId,
  frames,
  toolbarByDefault = !hasTouchKeyboard(),
  extraButtons,
  onSend,
  onSendFiles,
  onTyping,
  onEditLastMessage,
  autoFocus = true,
  ref,
}: Props) {
  const editor = useRef<RichTextEditorHandle>(null);
  const form = useRef<HTMLFormElement>(null);
  const fileField = useRef<HTMLInputElement>(null);
  const [toolbarShown, setToolbarShown] = useToolbarShown(toolbarByDefault);
  const [filesOpen, setFilesOpen] = useState(false);
  const [alsoSend, setAlsoSend] = useState(false);
  const key = draftKey(userId, roomId, threadId);
  const [draft, setDraft] = useState(() => readDraft(key));
  const [blank, setBlank] = useState(() => !draft);
  // Touch screens bring up their keyboard on focus, so there it waits for a tap.
  const [focusOnOpen] = useState(() => !hasTouchKeyboard());
  // Where focus was as the room opened. The editor can be ready a moment later, by when you may have put
  // focus elsewhere, where it's left.
  const [focusAtOpen] = useState(() => document.activeElement);
  const editorShown = useEditorShown(deferEditor);
  const [editorReady, setEditorReady] = useState(false);
  const previewLink = useLinkPreviews();
  const picked = usePickedFiles();
  // What's scheduled and waiting for the room to take it, by the id it went with, so a refusal can put it back.
  const scheduling = useRef(new Map<string, string>());
  const [scheduleRefusal, setScheduleRefusal] = useState<string | null>(null);
  const scheduled = useScheduled(roomId, frames, (clientMessageId, why) => {
    const body = scheduling.current.get(clientMessageId);
    if (body === undefined) return;
    scheduling.current.delete(clientMessageId);
    setScheduleRefusal(why);
    // What was scheduled comes back to be changed, unless something else has been written since.
    if (editor.current?.isBlank()) editor.current.replace(body);
  });
  const scheduledHere = scheduled.messages.filter((message) => message.parentId === threadId).map((message) => ({ ...message, text: writtenBody(message.body).plainText }));
  // Whether the editor was blank when it last changed, so emptying it tells the room you've stopped once.
  const wasBlank = useRef(!draft);
  // Whether Quote wrote what the editor opens with, before it showed, so it takes focus as Quote has it do.
  const replied = useRef(false);
  const placeholder = threadId !== undefined ? "Reply…" : `Message ${direct || closed ? "" : "#"}${roomName}`;

  // What's written changed, to `body`, or to nothing: the room hears whether you're typing, and it's kept.
  const wrote = (body: string | null) => {
    if (body !== null) onTyping(true);
    else if (!wasBlank.current) onTyping(false);
    wasBlank.current = body === null;
    setBlank(body === null);
    keepDraft(key, body);
  };

  useImperativeHandle(ref, () => ({
    focus: () => editor.current?.focus(),
    replace: (markup) => {
      if (editor.current) return editor.current.replace(markup);
      // Before the editor shows, as its code loads, the reply is what it opens with.
      replied.current = true;
      setDraft(markup);
      wrote(markup);
    },
    addFiles: picked.add,
  }));

  // Up Arrow, with nothing written, edits your newest message. It's taken only from the composer or the
  // page itself, not from other fields or the editor of another message.
  const editLastMessage = useEffectEvent((event: KeyboardEvent) => {
    if (!onEditLastMessage || event.defaultPrevented || !pressedAlone(event, "ArrowUp")) return;
    const fromText = form.current?.querySelector(".lexxy-editor__content")?.contains(event.target as Node) ?? false;
    // Before the editor shows, what's written is the draft it will show.
    const blank = editor.current ? editor.current.isBlank() : !draft;
    if (!(fromText || isPage(event.target)) || !blank) return;
    event.preventDefault();
    onEditLastMessage();
  });
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => editLastMessage(event);
    document.addEventListener("keydown", keyDown);
    return () => document.removeEventListener("keydown", keyDown);
  }, []);

  const changed = () => {
    setEditorReady(true);
    wrote(editor.current!.isBlank() ? null : editor.current!.value());
  };

  // What's written is gone, sent or scheduled: the room hears you've stopped typing as the message
  // arrives, and the draft goes, with Also send to the room, as Slack unticks it.
  const written = () => {
    wasBlank.current = true;
    setBlank(true);
    editor.current?.clear();
    keepDraft(key, null);
    setAlsoSend(false);
  };

  // This sends the files picked, then what's written unless it's blank, and focuses the editor, on touch
  // screens too. While the room is away what's written goes, to wait for it, and the files stay. Before the
  // editor shows, as its code loads, only the files go.
  const submit = () => {
    setScheduleRefusal(null);
    // Files picked wait for the room, which they upload to.
    if (picked.files.length > 0 && !disabled) {
      onSendFiles(
        picked.files.map(({ file }) => file),
        alsoSend,
      );
      picked.clear();
      setAlsoSend(false);
    }
    const text = editor.current;
    if (!text) return;
    if (!text.isBlank()) {
      // One the room won't take, as when it's too long, stays to be cut down.
      if (!onSend(text.value(), alsoSend)) return;
      written();
    }
    text.focus();
  };

  // Schedules what's written for `at`, taking it out of the box as Send would.
  const schedule = (at: Date) => {
    const text = editor.current;
    if (disabled || !text || text.isBlank()) return;
    setScheduleRefusal(null);
    const body = text.value();
    const clientMessageId = scheduled.schedule({ body, sendAt: at.getTime(), parentId: threadId, alsoSend });
    if (clientMessageId === null) return;
    scheduling.current.set(clientMessageId, body);
    written();
    text.focus();
  };

  // Focus goes to the × of the file that takes the removed one's place, or the one before it, or the text.
  const removePicked = (key: number, index: number) => {
    flushSync(() => picked.remove(key));
    const removes = form.current?.querySelectorAll<HTMLElement>('[aria-label="Files to send"] button') ?? [];
    (removes[Math.min(index, removes.length - 1)] ?? editor.current)?.focus();
  };

  // The toolbar shows for the Link field, though Aa had hidden it.
  const { onFormats, keyDown: formattingKeyDown, toolbar } = useFormatting(editor, { onShowToolbar: () => flushSync(() => setToolbarShown(true, false)) });
  const keyDown = (event: KeyboardEvent) => formattingKeyDown(event, submit);

  const placeholderToolbar = toolbarShown && !(editorShown && editorReady);

  return (
    // A thread's panel is narrower than its room, and its composer keeps closer to its sides.
    <footer className={cn(FOOTER, threadId !== undefined && "px-4")}>
      <form
        ref={form}
        noValidate
        className="composer relative min-w-0 [contain:inline-size]"
        data-toolbar={toolbarShown || undefined}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        // Pasted files are picked rather than written, which Lexxy leaves them out of, and any paste clears
        // what was said about files too large.
        onPaste={(event) => {
          if (event.clipboardData.files.length > 0) event.preventDefault();
          picked.add(event.clipboardData.files);
        }}
        {...dropTarget(picked.add)}
      >
        <TypingIndicator typists={typing} />
        <ScheduledNotice messages={scheduledHere} scheduled={scheduled} disabled={disabled} onReturnFocus={() => editor.current?.focus()} onEdit={(body) => editor.current?.replace(body)} />
        {scheduleRefusal && (
          <p role="alert" className="mb-1.5 text-[13px] text-negative">
            {scheduleRefusal}
          </p>
        )}
        <div className={cn(COMPOSER_CARD, "min-h-[108px] max-md:min-h-[100px]")}>
          {toolbarShown &&
            // Its place is kept while the editor loads, whose stylesheet paints its icons, so the text doesn't move down as it shows.
            (placeholderToolbar ? (
              <div aria-hidden="true" className="h-[34px] shrink-0 touch:h-[50px]" />
            ) : (
              toolbar
            ))}
          {/* The editor takes the card's padding and fills this, all the card above the buttons (rich-text-editor.css). */}
          <div className="flex min-w-0 flex-1 flex-col">
            <Suspense fallback={<LoadingEditor placeholder={placeholder} />}>
              {editorShown ? (
                <RichTextEditor
                  ref={editor}
                  label={threadId !== undefined ? "Write a reply" : "Write a message"}
                  placeholder={placeholder}
                  rows={2}
                  initialValue={draft}
                  mentionsFrom={mentionPromptSrc(roomId)}
                  // Under the text on touch screens are the keyboard and the home indicator.
                  mentionsAbove={hasTouchKeyboard()}
                  autoFocus={() => {
                    setEditorReady(true);
                    return replied.current || (autoFocus && focusOnOpen && focusStayedOn(focusAtOpen));
                  }}
                  toolbar={false}
                  onFormats={onFormats}
                  onChange={changed}
                  onKeyDown={keyDown}
                  onLinkPasted={previewLink}
                />
              ) : (
                <LoadingEditor placeholder={placeholder} />
              )}
            </Suspense>
          </div>
          {/* The files picked, under the text, as Slack's composer has them, and those too large to send. */}
          {picked.files.length > 0 && (
            <ul aria-label="Files to send" className="flex flex-wrap items-end gap-2.5 pt-2 pb-2.5">
              {picked.files.map(({ key, file }, index) => (
                <FileChip key={key} file={file} onRemove={() => removePicked(key, index)} />
              ))}
            </ul>
          )}
          {picked.errors.length > 0 && (
            <p role="alert" className="w-full pb-2 text-[13px] leading-normal text-negative wrap-anywhere">
              {picked.errors.join(" ")}
            </p>
          )}
          <div className="flex flex-none items-center gap-0.5">
            {/* The browser's file picker, which Upload from your computer opens. */}
            <input
              ref={fileField}
              type="file"
              multiple
              disabled={disabled}
              aria-label="Attach a file"
              tabIndex={-1}
              onChange={(event) => {
                picked.add(event.target.files ?? []);
                // So picking the same file again is a change.
                event.target.value = "";
              }}
              className="sr-only"
            />
            <AttachMenu disabled={disabled} onUpload={() => fileField.current?.click()} onFilesInEmber={() => setFilesOpen(true)} onReturnFocus={() => editor.current?.focus()} />
            <FormattingToggle
              shown={toolbarShown}
              onToggle={() => {
                setToolbarShown(!toolbarShown);
                editor.current?.focus();
              }}
            />
            <EmojiButton onPick={(emoji) => editor.current?.insertText(emoji)} onReturnFocus={() => editor.current?.focus()} />
            <MentionButton onMention={() => editor.current?.startMention()} />
            {extraButtons}
            {/* For fingers, the box sits far enough into its label for a fingertip on it to land on the label. */}
            {threadId !== undefined && (
              <label className="mr-2 ml-2.5 flex min-w-0 cursor-pointer items-center gap-[7px] text-[13px] leading-[18px] text-message-muted touch:ml-0 touch:min-h-11 touch:pl-3.5 touch:text-sm">
                <input
                  type="checkbox"
                  checked={alsoSend}
                  disabled={disabled}
                  onChange={(event) => setAlsoSend(event.target.checked)}
                  className="m-0 size-4 flex-none cursor-pointer accent-foreground"
                />
                <span className="truncate">
                  {direct ? (
                    "Also send as direct message"
                  ) : (
                    <>
                      Also send to <strong className="font-semibold text-message-ink">#{roomName}</strong>
                    </>
                  )}
                </span>
              </label>
            )}
            {/* Files picked go at once, so they can't be scheduled. */}
            <SendButton disabled={false} empty={blank && picked.files.length === 0} cannotSchedule={disabled || !frames || blank || picked.files.length > 0} onSchedule={schedule} />
          </div>
        </div>
      </form>
      {filesOpen && (
        <FilesPicker
          meId={userId}
          roomId={roomId}
          room={{ label: direct ? roomName : `#${roomName}`, direct }}
          onClose={() => setFilesOpen(false)}
          onPick={(shared) => {
            setFilesOpen(false);
            picked.share(shared);
          }}
          onReturnFocus={() => editor.current?.focus()}
        />
      )}
    </footer>
  );
}

/** Where whether the toolbar shows is kept in this browser, which Aa changes. */
const TOOLBAR_KEY = "composer-toolbar";

/**
 * Whether the formatting toolbar shows: as Aa last left it in this browser, or else `byDefault`. Showing
 * it for the Link field doesn't change what's kept.
 */
function useToolbarShown(byDefault: boolean): [boolean, (shown: boolean, keep?: boolean) => void] {
  const [shown, setShown] = useState(() => {
    try {
      const kept = localStorage.getItem(TOOLBAR_KEY);
      if (kept !== null) return kept === "shown";
    } catch {
      // Storage can be unavailable, as in some private windows.
    }
    return byDefault;
  });
  const change = (next: boolean, keep = true) => {
    setShown(next);
    if (!keep) return;
    try {
      localStorage.setItem(TOOLBAR_KEY, next ? "shown" : "hidden");
    } catch {
      // Not kept, then.
    }
  };
  return [shown, change];
}

/** Cmd+Shift+X, or Ctrl+Shift+X, which strikes through, as Slack's does. */

/** Why a room's gone for this person: deleted, or still there with them no longer in it or its parent. */
export type RoomGone = "deleted" | "lost access";

/**
 * What stands in the composer's place in a room that's gone, saying why. Its span is inline, so its
 * width, centering and shake don't take; this has them, as its classes mean.
 */
export function RoomGoneNotice({ gone }: { gone: RoomGone }) {
  return (
    <footer className={FOOTER}>
      <p role="alert" className="rounded-lg border border-negative px-[0.8em] py-[0.5em] text-center text-base text-negative motion-safe:animate-shake">
        {gone === "lost access" ? "You no longer have access to this room." : "This room was deleted."}
      </p>
    </footer>
  );
}
