import { Suspense, useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { flushSync } from "react-dom";
import { MAX_FILE_SIZE, type User } from "@ember/protocol";
import type { Command } from "@ember/protocol/bots";
import { OPENGRAPH_EMBED_CONTENT_TYPE, previewContent, writtenBody } from "@ember/richtext/dom";
import { ArrowUp, Attachment, Page, Terminal, TextSquare, XmarkCircle } from "@/components/icons/iconoir";
import { useNameOf } from "@/hooks/use-directory";
import { fetchCommands, fetchLinkPreview, mentionPromptSrc } from "@/lib/api";
import { dropTarget } from "@/lib/drop-target";
import { hasTouchKeyboard, opensLink, pressedAlone, sendsMessage } from "@/lib/keyboard";
import { tooLargeToAttach } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { RichTextEditor, editorLoaded, type PastedLink, type RichTextEditorHandle } from "./editor";

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
 * The buttons under the text, which darken on hover as Campfire's do (composer.css, buttons.css). A
 * disconnected room disables them, though only Send looks it.
 */
const BUTTON = "flex size-8 shrink-0 cursor-pointer items-center justify-center touch:size-11";

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
    <p aria-hidden="true" className="min-h-11 text-[14px] opacity-66 max-md:min-h-[34px] touch:text-[16px]">
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

/** A file picked to send, keyed, since two can share a name. */
interface PickedFile {
  key: number;
  file: File;
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
  const add = (picked: Iterable<File>) => {
    const fitting: PickedFile[] = [];
    const refused: string[] = [];
    for (const file of picked) {
      if (file.size > MAX_FILE_SIZE) refused.push(tooLargeToAttach(file.name));
      else fitting.push({ key: ++lastKey.current, file });
    }
    setErrors(refused);
    if (fitting.length > 0) setFiles((files) => [...files, ...fitting].sort((a, b) => a.file.name.localeCompare(b.file.name)));
  };
  const remove = (key: number) => setFiles((files) => files.filter((picked) => picked.key !== key));
  return { files, errors, add, remove, clear: () => setFiles([]) };
}

/**
 * A file's name as its chip shows it: what runs to an ellipsis, up to its last dot, and its extension,
 * which doesn't. A name with no dot shows whole.
 */
function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? [name, ""] : [name.slice(0, dot + 1), name.slice(dot + 1)];
}

/**
 * The address of a picture's thumbnail, which is let go once its chip goes.
 */
function useThumbnail(file: File): string | undefined {
  const [thumbnail, setThumbnail] = useState<string>();
  useLayoutEffect(() => {
    if (!isImage(file)) return;
    const url = URL.createObjectURL(file);
    setThumbnail(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return thumbnail;
}

const isImage = (file: File) => file.type.startsWith("image/");

/**
 * A file picked to send, styled by Campfire's composer.css: a picture's thumbnail, or a file icon, over
 * its name and a circled ×. Pressing it takes the file back out, which it says to screen readers too.
 */
function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const thumbnail = useThumbnail(file);
  const [name, extension] = splitName(file.name);
  const tile = "aspect-[5/4] w-full shrink-0 rounded-[1em] border border-muted-foreground";
  return (
    <button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove} className="flex w-[100px] cursor-pointer flex-col items-center rounded-[1em]">
      {isImage(file) ? (
        <img src={thumbnail} alt="" className={cn(tile, "object-cover")} />
      ) : (
        <span className={cn(tile, "flex items-center justify-center")}>
          <Page className="h-auto w-[55%]" />
        </span>
      )}
      <span className="flex max-w-full items-center px-[1ch] text-[0.8rem]">
        <span className="truncate">{name}</span>
        <span className="shrink-0">{extension}</span>
        <XmarkCircle className="ms-[0.5em] -me-[0.5em] size-[1.3em] shrink-0" />
      </span>
    </button>
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

/**
 * The name of the command being typed, when a line of `text` begins with "/": the word after it, without
 * its case, or "" while there's nothing after yet. Null for anything else, whose slash is someone's text.
 */
export const commandFragmentOf = (text: string): string | null => {
  const line = text.split("\n", 1)[0] ?? "";
  if (!line.startsWith("/")) return null;
  const after = line.slice(1);
  const space = after.search(/\s/);
  return (space === -1 ? after : after.slice(0, space)).toLowerCase();
};

/**
 * The commands `commands` offers for `fragment`: those whose names it starts, all of them for "" — but
 * none once it's one command's name whole, longer names that start with it included, since the menu is
 * there to find one, and Enter sends one found rather than completing it over what's typed after.
 */
export const commandsMatching = (commands: Command[], fragment: string): Command[] => {
  const matching = commands.filter(({ name }) => name.startsWith(fragment));
  return commands.some(({ name }) => name === fragment) ? [] : matching;
};

/**
 * The command `text` invokes, when it begins with one of `commands`: the one its first word names, by one
 * case, and whatever was typed after it, its spaces at either end spared.
 */
export const commandInvocationOf = (text: string, commands: Command[]): { command: Command; text: string } | null => {
  const fragment = commandFragmentOf(text);
  const command = fragment !== null ? commands.find(({ name }) => name === fragment) : undefined;
  if (!command) return null;
  const after = text.slice(text.indexOf("/") + 1 + command.name.length);
  return { command, text: after.trim() };
};

interface Props {
  roomId: string;
  /** The room's name as the writer reads it, which a DM's names the others in it. */
  roomName: string;
  /** Whether the room is a DM, whose name goes without a `#`. */
  direct?: boolean;
  /** Who's writing, whose drafts are their own. */
  userId: string;
  typing: User[];
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
  /** Sends a message, its body markup, answering whether it went: one that didn't stays to be changed. */
  onSend: (body: string, alsoSend: boolean) => boolean;
  /** Sends files, each as a message of its own, before the message written with them. */
  onSendFiles: (files: File[], alsoSend: boolean) => void;
  onTyping: (active: boolean) => void;
  /** Opens the editor on your newest message, for Up Arrow. */
  onEditLastMessage?: () => void;
  /**
   * Runs `/name text` as an invocation, answering once the bot has heard it, while the room says why one
   * it refused. Without one, as in a thread, what's typed goes as a message, whatever it starts with.
   */
  onRunCommand?: (name: string, text: string) => Promise<boolean>;
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
 * The composer: a card with the editor on top, and below it Attach files, Formatting options, which
 * shows Lexxy's toolbar under the text, and a round Send button. @ offers the room's people to mention,
 * and a first "/" offers the workspace's commands to run. Files picked, pasted or dropped wait above the
 * card to go with the next message. What's written is kept as a draft until it's sent. A thread's has
 * Also send to the room before Send.
 */
export function Composer({ roomId, roomName, direct = false, userId, typing, disabled, deferEditor = false, threadId, onSend, onSendFiles, onTyping, onEditLastMessage, onRunCommand, autoFocus = true, ref }: Props) {
  const editor = useRef<RichTextEditorHandle>(null);
  const form = useRef<HTMLFormElement>(null);
  const [toolbarOpen, setToolbarOpen] = useState(false);
  // Whether the toolbar shows only for its Link field, which Ctrl or Cmd+K opened while it was shut.
  const [toolbarForLink, setToolbarForLink] = useState(false);
  const [alsoSend, setAlsoSend] = useState(false);
  const key = draftKey(userId, roomId, threadId);
  const [draft, setDraft] = useState(() => readDraft(key));
  // Touch screens bring up their keyboard on focus, so there it waits for a tap.
  const [focusOnOpen] = useState(() => !hasTouchKeyboard());
  // Where focus was as the room opened. The editor can be ready a moment later, by when you may have put
  // focus elsewhere, where it's left.
  const [focusAtOpen] = useState(() => document.activeElement);
  const editorShown = useEditorShown(deferEditor);
  const previewLink = useLinkPreviews();
  const picked = usePickedFiles();
  // Whether the editor was blank when it last changed, so emptying it tells the room you've stopped once.
  const wasBlank = useRef(!draft);
  // Whether Quote wrote what the editor opens with, before it showed, so it takes focus as Quote has it do.
  const replied = useRef(false);
  const placeholder = threadId !== undefined ? "Reply…" : `Message ${direct ? "" : "#"}${roomName}`;

  // The workspace's commands, fetched once what's written first begins with a "/": until then, the
  // composer of every room and thread has no use for them. One that couldn't be had is asked for again
  // at the next slash.
  const [commands, setCommands] = useState<Command[] | null>(null);
  // The ask for them on its way, which whoever is waiting on it joins, and which one that failed leaves
  // to be asked again.
  const asking = useRef<Promise<Command[] | null> | null>(null);
  const needCommands = (): Promise<Command[] | null> => {
    if (commands) return Promise.resolve(commands);
    asking.current ??= fetchCommands().then(
      (loaded) => {
        setCommands(loaded.commands);
        return loaded.commands;
      },
      () => {
        asking.current = null;
        return null;
      },
    );
    return asking.current;
  };
  // What the menu of commands shows: those `fragment` starts, and the one it highlights, which Enter and
  // the arrows move among. Empty once nothing matches, so a slash that's no command is sent as written.
  const [offered, setOffered] = useState<Command[]>([]);
  const [highlighted, setHighlighted] = useState(0);

  // What's written changed, to `body`, or to nothing: the room hears whether you're typing, and it's kept,
  // and a command being typed, if the workspace has commands, is looked for.
  const wrote = (body: string | null) => {
    if (body !== null) onTyping(true);
    else if (!wasBlank.current) onTyping(false);
    wasBlank.current = body === null;
    keepDraft(key, body);
    const fragment = body !== null && onRunCommand !== undefined ? commandFragmentOf(writtenBody(body).plainText) : null;
    if (fragment === null) return setOffered([]);
    needCommands();
    setOffered(commands ? commandsMatching(commands, fragment) : []);
    setHighlighted(0);
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

  // What's written when the commands arrive was typed before there were any to match, so the menu is
  // looked for once more, as the next keystroke would.
  useEffect(() => {
    if (commands === null || !editor.current || editor.current.isBlank()) return;
    const fragment = commandFragmentOf(writtenBody(editor.current.value()).plainText);
    if (fragment !== null) setOffered(commandsMatching(commands, fragment));
  }, [commands]);

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

  const changed = () => wrote(editor.current!.isBlank() ? null : editor.current!.value());

  // One submit of the composer's at a time, that Enter and Send pressed while the commands are asked
  // for don't start a second one over what's still written, one command run twice, or newer writing
  // lost.
  const submitting = useRef(false);

  // Writes back what the room wouldn't run as a command, for it to be sent again, so long as nothing
  // else has been written by then, as a message the room wouldn't take stays written where it was.
  const giveBack = useEffectEvent((written: RichTextEditorHandle, markup: string) => {
    if (!written.isBlank()) return;
    written.replace(markup);
    written.focus();
  });

  // This sends nothing while the room is disconnected, and otherwise sends the files picked, then what's
  // written unless it's blank, closes the toolbar and focuses the editor, on touch screens too. Before
  // the editor shows, as its code loads, only the files go. Also send to the room is unticked once
  // anything's gone, as Slack unticks it. What's written that begins with one of the workspace's
  // commands goes as an invocation, which the room answers, and not as a message — and what begins with
  // a slash waits for the commands to be had first, that a registered one isn't posted to the room while
  // they're on their way. One that couldn't be had keeps what's written to be sent again, and what's
  // written by the time they arrive is what goes, so writing that waited with it is kept.
  const submit = async () => {
    if (disabled || submitting.current) return;
    submitting.current = true;
    try {
      if (picked.files.length > 0) {
        onSendFiles(picked.files.map(({ file }) => file), alsoSend);
        picked.clear();
        setAlsoSend(false);
      }
      const written = editor.current;
      if (!written) return;
      if (!written.isBlank()) {
        const asWritten = () => writtenBody(written.value()).plainText;
        const wantsCommands = onRunCommand !== undefined && commandFragmentOf(asWritten()) !== null && commands === null;
        const had = wantsCommands ? await needCommands() : commands;
        if (wantsCommands && !had) return;
        // Emptied while the commands were on their way is nothing to send.
        if (written.isBlank()) return;
        const markup = written.value();
        const invocation = had && onRunCommand ? commandInvocationOf(asWritten(), had) : null;
        if (invocation && onRunCommand) {
          // What the room wouldn't run, as when its queue is full or the bot refused it, comes back to
          // be sent again.
          onRunCommand(invocation.command.name, invocation.text)
            .catch(() => false)
            .then((went) => {
              if (!went) giveBack(written, markup);
            });
        }
        // One the room won't take, as when it's too long, stays to be cut down.
        else if (!onSend(markup, alsoSend)) return;
        // Everyone else stops showing you as typing when your message arrives.
        wasBlank.current = true;
        written.clear();
        keepDraft(key, null);
        setAlsoSend(false);
      }
      setToolbarOpen(false);
      setToolbarForLink(false);
      written.focus();
    } finally {
      submitting.current = false;
    }
  };

  // Completes the command picked from the menu, as the people to mention are completed: what's written
  // becomes it, with a space after it for what it's to be told, and the change closes the menu, since
  // its name is typed whole then.
  const pickedCommand = (command: Command) => editor.current?.replace(`<p>/${command.name} </p>`);

  const keyDown = (event: KeyboardEvent) => {
    if (opensLink(event) && !toolbarOpen) {
      // Lexxy opens its Link field on this even while its toolbar is hidden, so nothing would seem to
      // happen, and the address you typed next would replace what you'd selected. Here the toolbar shows
      // first, so the field can take focus, and shuts again when the field closes.
      flushSync(() => {
        setToolbarOpen(true);
        setToolbarForLink(true);
      });
      return;
    }
    // Enter picks from an open list, such as the people to mention, and so does the menu of commands,
    // which the arrows move in and Escape shuts.
    if (!editor.current?.hasOpenPrompt() && offered.length > 0) {
      if (pressedAlone(event, "ArrowDown")) {
        event.preventDefault();
        return void setHighlighted((at) => (at + 1) % offered.length);
      }
      if (pressedAlone(event, "ArrowUp")) {
        event.preventDefault();
        return void setHighlighted((at) => (at + offered.length - 1) % offered.length);
      }
      if (pressedAlone(event, "Escape")) {
        event.preventDefault();
        return setOffered([]);
      }
      if (pressedAlone(event, "Tab") || sendsMessage(event, { toolbarOpen })) {
        event.preventDefault();
        event.stopPropagation();
        return pickedCommand(offered[highlighted]!);
      }
    }
    if (editor.current?.hasOpenPrompt() || !sendsMessage(event, { toolbarOpen })) return;
    event.preventDefault();
    event.stopPropagation();
    submit();
  };

  // Shuts the toolbar Ctrl or Cmd+K showed once its Link field closes, returning focus to the text if it
  // was in the toolbar.
  useEffect(() => {
    const link = form.current?.querySelector("lexxy-link-dropdown [data-dropdown-trigger]");
    if (!toolbarForLink || !link) return;
    const observer = new MutationObserver(() => {
      if (link.getAttribute("aria-expanded") === "true") return;
      if (link.closest("lexxy-toolbar")?.contains(document.activeElement)) editor.current?.focus();
      setToolbarForLink(false);
      setToolbarOpen(false);
    });
    observer.observe(link, { attributeFilter: ["aria-expanded"] });
    return () => observer.disconnect();
  }, [toolbarForLink]);

  return (
    // A thread's panel is narrower than its room, and its composer keeps closer to its sides.
    <footer className={cn(FOOTER, threadId !== undefined && "px-4")}>
      {/* Not validated, since Lexxy checks its Link field itself. An address left unfinished there, or the field
          left open and empty, would otherwise stop Send without a word. */}
      <form
        ref={form}
        noValidate
        className="composer relative min-w-0 [contain:inline-size]"
        data-toolbar={toolbarOpen || undefined}
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
        {/* The commands what's written begins with, each with its bot's name, what it's for, and the
            picture of a prompt its kind uses. In the flow, where the files picked wait, since covering
            the room's messages would hide what a command's answer replies to. */}
        {offered.length > 0 && (
          <div role="listbox" aria-label="Commands" className="flex max-h-[50vh] flex-col overflow-y-auto rounded-[12px] border bg-surface pb-1">
            {offered.map((command, at) => (
              <button
                key={command.id}
                type="button"
                role="option"
                aria-selected={at === highlighted}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickedCommand(command)}
                className={cn(
                  "flex w-full cursor-pointer items-baseline gap-x-[1ch] px-4 py-1.5 text-start text-[14px] leading-5 touch:min-h-11 touch:items-center touch:py-0",
                  at === highlighted ? "bg-hover" : "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-hover",
                )}
              >
                <Terminal className="size-5 shrink-0 self-center opacity-70" />
                <span className="shrink-0 font-semibold text-message-ink">/{command.name}</span>
                {command.description !== null && <span className="truncate text-muted-foreground">{command.description}</span>}
                <span className="ms-auto shrink-0 text-muted-foreground">{command.bot.name}</span>
              </button>
            ))}
          </div>
        )}
        {/* The files picked, and those too large to send. */}
        <div className={cn("flex flex-wrap items-center gap-x-[1ch] gap-y-2", (picked.files.length > 0 || picked.errors.length > 0) && "pb-2")}>
          {picked.files.map(({ key, file }) => (
            <FileChip key={key} file={file} onRemove={() => picked.remove(key)} />
          ))}
          {picked.errors.length > 0 && (
            <p role="alert" className="w-full px-3 py-2.5 text-[13px] leading-normal text-negative wrap-anywhere">
              {picked.errors.join(" ")}
            </p>
          )}
        </div>
        <div className="flex min-h-[108px] min-w-0 flex-col rounded-[12px] border bg-surface p-3 max-md:min-h-[100px] max-md:p-2.5">
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
                  autoFocus={() => replied.current || (autoFocus && focusOnOpen && focusStayedOn(focusAtOpen))}
                  onChange={changed}
                  onKeyDown={keyDown}
                  onLinkPasted={previewLink}
                />
              ) : (
                <LoadingEditor placeholder={placeholder} />
              )}
            </Suspense>
          </div>
          <div className="flex flex-none items-center gap-0.5">
            {/* Campfire's `.input--file` (inputs.css): the file field fills the button, unseen, so pressing it
                anywhere opens the browser's file picker, and the button shows when the field has focus. */}
            <label
              title="Attach files"
              className={cn(
                BUTTON,
                "relative rounded-[7px] hover:not-active:brightness-85 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-hover",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-foreground",
              )}
            >
              <Attachment className="size-[18px] opacity-70" />
              <input
                type="file"
                multiple
                disabled={disabled}
                onChange={(event) => {
                  picked.add(event.target.files ?? []);
                  // So picking the same file again is a change.
                  event.target.value = "";
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              <span className="sr-only">Attach a file</span>
            </label>
            <button
              type="button"
              disabled={disabled}
              title="Formatting options"
              aria-pressed={toolbarOpen}
              // Keep focus in the editor, so a phone's keyboard stays up, as Send does.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setToolbarOpen((open) => !open);
                setToolbarForLink(false);
                editor.current?.focus();
              }}
              className={cn(BUTTON, "rounded-[7px] hover:not-active:brightness-85 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-hover")}
            >
              <TextSquare className="size-[18px] opacity-70" />
              <span className="sr-only">Rich text</span>
            </button>
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
            <button
              type="submit"
              disabled={disabled}
              title="Send message"
              // Keep focus in the editor, so a phone's keyboard stays up between messages.
              onMouseDown={(event) => event.preventDefault()}
              className={cn(
                BUTTON,
                "ml-auto rounded-full bg-foreground text-background hover:not-active:brightness-70",
                "disabled:pointer-events-none disabled:opacity-50 disabled:grayscale disabled:contrast-50",
              )}
            >
              <ArrowUp className="size-[18px]" />
              <span className="sr-only">Send Message</span>
            </button>
          </div>
        </div>
      </form>
    </footer>
  );
}

/**
 * What stands in the composer's place in a room that's gone: deleted, or no longer this person's. Its
 * span is inline, so its width, centering and shake don't take; this has them, as its classes mean.
 */
export function RoomDeleted() {
  return (
    <footer className={FOOTER}>
      <p role="alert" className="rounded-lg border border-negative px-[0.8em] py-[0.5em] text-center text-base text-negative motion-safe:animate-shake">
        This room was deleted.
      </p>
    </footer>
  );
}
