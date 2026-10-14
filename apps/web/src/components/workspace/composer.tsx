import { useRef, useState } from "react";
import type { User } from "@ember/protocol";
import { MAX_MESSAGE_LENGTH } from "@ember/protocol";
import { ArrowUp } from "@/components/icons/campfire";
import { sendsMessage } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

/**
 * ember-rust's typing indicator (rooms/show/_composer.html, Campfire's typing_tracker.js and
 * composer.css): the names of whoever is typing, sorted and comma-separated after a three-dot spinner,
 * fading in above the composer. Like ember-rust's, it isn't a live region: announced on every change,
 * a bare list of names would mean nothing out of context.
 */
function TypingIndicator({ typists }: { typists: User[] }) {
  const names = typists
    .map((u) => u.name)
    .sort()
    .join(", ");
  return (
    <div
      className={cn(
        "absolute -top-[19px] left-0 inline-flex items-center text-[11px] transition-opacity duration-300 motion-reduce:transition-none max-md:-top-[15px]",
        !names && "opacity-0",
      )}
    >
      <div className={cn("spinner ps-[1.5em] leading-none", !names && "hidden")}>{names}</div>
    </div>
  );
}

/** The composer's place below the messages, which keeps clear of a phone's home bar. */
const FOOTER = "bg-background px-[22px] pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))] narrow:px-4 max-md:px-2.5 max-md:pt-2 max-md:pb-[max(10px,env(safe-area-inset-bottom))]";

interface Props {
  roomName: string;
  typing: User[];
  disabled: boolean;
  onSend: (body: string) => void;
  onTyping: (active: boolean) => void;
}

/** ember-rust's two-row composer card: the text on top, actions and a round send button below. */
export function Composer({ roomName, typing, disabled, onSend, onTyping }: Props) {
  const [body, setBody] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = body.trim();
    if (!text || disabled) return;
    onSend(text);
    setBody("");
    input.current?.focus();
  };

  return (
    <footer className={FOOTER}>
      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TypingIndicator typists={typing} />
        {/* The text field takes the card's top and side padding, so all of the card above the
            buttons is one big tap target. */}
        <div className="flex min-h-[108px] flex-col rounded-xl border bg-surface pb-3 focus-within:border-muted-foreground max-md:min-h-[100px] max-md:pb-2.5">
          <label htmlFor="composer" className="sr-only">
            Message #{roomName}
          </label>
          <textarea
            id="composer"
            ref={input}
            rows={1}
            value={body}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder={`Message #${roomName}`}
            onChange={(event) => {
              setBody(event.target.value);
              onTyping(event.target.value.length > 0);
            }}
            onKeyDown={(event) => {
              if (sendsMessage(event)) {
                event.preventDefault();
                submit();
              }
            }}
            className="field-sizing-content max-h-[min(32dvh,300px)] min-h-[52px] flex-1 resize-none bg-transparent px-3 pt-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-none max-md:min-h-10 max-md:px-2.5 max-md:pt-2.5 touch:text-base"
          />
          <div className="mt-1 flex items-center gap-0.5 px-3 max-md:mt-0 max-md:px-2.5">
            <span className="text-xs text-muted-foreground touch:hidden">Shift + Enter for a new line</span>
            <button
              type="submit"
              disabled={disabled || body.trim().length === 0}
              aria-label="Send"
              title="Send"
              // Keep focus in the text field, so a phone's keyboard stays up between messages.
              onMouseDown={(event) => event.preventDefault()}
              className="ml-auto flex size-8 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40 touch:size-11"
            >
              <ArrowUp tone="reversed" className="size-[18px]" />
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
