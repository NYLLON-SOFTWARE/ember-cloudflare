import { Suspense, useEffect, useRef, useState } from "react";
import type { User } from "@ember/protocol";
import { ArrowUp, TextOptions } from "@/components/icons/campfire";
import { hasTouchKeyboard, sendsMessage } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { RichTextEditor, editorLoaded, type RichTextEditorHandle } from "./editor";

/**
 * ember-rust's typing indicator (rooms/show/_composer.html, Campfire's typing_tracker.js and
 * composer.css): the names of whoever is typing, sorted and comma-separated after a three-dot spinner,
 * fading in above the composer. Like ember-rust's, it isn't a live region: announced on every change,
 * a bare list of names would mean nothing out of context. Names that don't fit end in an ellipsis,
 * where ember-rust's wrap down over the message box.
 */
function TypingIndicator({ typists }: { typists: User[] }) {
  const names = typists
    .map((u) => u.name)
    .sort()
    .join(", ");
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
 * The buttons under the text: ember-rust's `.mb-composer-toolbar .btn` (zz-ember.css), which darken
 * on hover as Campfire's do (composer.css, buttons.css). A disconnected room disables them, as its
 * fieldset does in ember-rust, though only Send looks it.
 */
const BUTTON = "flex size-8 shrink-0 cursor-pointer items-center justify-center touch:size-11";

/**
 * Where what someone has written in a room and not yet sent is kept in this browser, as ember-rust
 * keeps it, though for each person apart, so whoever signs in here next doesn't see it.
 */
const draftKey = (userId: string, roomId: string) => `composer-draft-${userId}-${roomId}`;

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

/** Whether focus is still on `element`, or on nothing, as when what had it went away. */
function focusStayedOn(element: Element | null): boolean {
  const focused = document.activeElement;
  return !focused || focused === element || focused === document.body;
}

interface Props {
  roomId: string;
  roomName: string;
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
  /** Sends a message, its body markup, answering whether it went: one that didn't stays to be changed. */
  onSend: (body: string) => boolean;
  onTyping: (active: boolean) => void;
}

/**
 * ember-rust's composer (rooms/show/_composer.html, composer_controller.js and zz-ember.css): a card
 * with the editor on top, and below it Formatting options, which shows Lexxy's toolbar under the text,
 * and a round Send button. What's written is kept as a draft until it's sent.
 */
export function Composer({ roomId, roomName, userId, typing, disabled, deferEditor = false, onSend, onTyping }: Props) {
  const editor = useRef<RichTextEditorHandle>(null);
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const key = draftKey(userId, roomId);
  const [draft] = useState(() => readDraft(key));
  // Touch screens bring up their keyboard on focus, so there it waits for a tap.
  const [focusOnOpen] = useState(() => !hasTouchKeyboard());
  // Where focus was as the room opened. The editor can be ready a moment later, by when you may have put
  // focus elsewhere, where it's left.
  const [focusAtOpen] = useState(() => document.activeElement);
  const editorShown = useEditorShown(deferEditor);
  // Whether the editor was blank when it last changed, so emptying it tells the room you've stopped once.
  const wasBlank = useRef(!draft);
  const placeholder = `Message #${roomName}`;

  const changed = () => {
    const blank = editor.current!.isBlank();
    if (!blank) onTyping(true);
    else if (!wasBlank.current) onTyping(false);
    wasBlank.current = blank;
    keepDraft(key, blank ? null : editor.current!.value());
  };

  // As ember-rust's does, this sends nothing while the room is disconnected, and otherwise sends
  // what's written unless it's blank, closes the toolbar and focuses the editor, on touch screens too.
  const submit = () => {
    const written = editor.current;
    if (!written || disabled) return;
    if (!written.isBlank()) {
      // One the room won't take, as when it's too long, stays to be cut down.
      if (!onSend(written.value())) return;
      // Everyone else stops showing you as typing when your message arrives.
      wasBlank.current = true;
      written.setValue("");
      keepDraft(key, null);
    }
    setToolbarOpen(false);
    written.focus();
  };

  const keyDown = (event: KeyboardEvent) => {
    // Enter picks from an open list, such as the people to mention.
    if (editor.current?.hasOpenPrompt() || !sendsMessage(event, { toolbarOpen })) return;
    event.preventDefault();
    event.stopPropagation();
    submit();
  };

  return (
    <footer className={FOOTER}>
      {/* Not validated, since Lexxy checks its Link field itself. An address left unfinished there, or the field
          opened out of sight by Ctrl or Cmd+K, would otherwise stop Send without a word, as it does in ember-rust. */}
      <form
        noValidate
        className="composer relative min-w-0 [contain:inline-size]"
        data-toolbar={toolbarOpen || undefined}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TypingIndicator typists={typing} />
        <div className="flex min-h-[108px] min-w-0 flex-col rounded-[12px] border bg-surface p-3 max-md:min-h-[100px] max-md:p-2.5">
          {/* The editor takes the card's padding and fills this, all the card above the buttons (rich-text-editor.css). */}
          <div className="flex min-w-0 flex-1 flex-col">
            <Suspense fallback={<LoadingEditor placeholder={placeholder} />}>
              {editorShown ? (
                <RichTextEditor
                  ref={editor}
                  label="Write a message"
                  placeholder={placeholder}
                  rows={2}
                  initialValue={draft}
                  autoFocus={() => focusOnOpen && focusStayedOn(focusAtOpen)}
                  onChange={changed}
                  onKeyDown={keyDown}
                />
              ) : (
                <LoadingEditor placeholder={placeholder} />
              )}
            </Suspense>
          </div>
          <div className="flex flex-none items-center gap-0.5">
            <button
              type="button"
              disabled={disabled}
              title="Formatting options"
              aria-pressed={toolbarOpen}
              // Keep focus in the editor, so a phone's keyboard stays up, as Send does.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setToolbarOpen((open) => !open);
                editor.current?.focus();
              }}
              className={cn(BUTTON, "rounded-[7px] hover:not-active:brightness-85 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-hover")}
            >
              <TextOptions className="size-[18px] opacity-70" />
              <span className="sr-only">Rich text</span>
            </button>
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
              <ArrowUp tone="reversed" className="size-[18px]" />
              <span className="sr-only">Send Message</span>
            </button>
          </div>
        </div>
      </form>
    </footer>
  );
}

/**
 * ember-rust's messages/room_not_found.html, in the composer's place in a room that's gone: deleted, or
 * no longer this person's. Its span is inline, so its width, centering and shake don't take; this has
 * them, as its classes mean.
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
