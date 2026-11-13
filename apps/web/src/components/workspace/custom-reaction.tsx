import { useId, useRef, useState, type Ref } from "react";
import { MAX_BOOST_LENGTH, type Me } from "@ember/protocol";
import { ArrowUp, Xmark } from "@/components/icons/iconoir";
import { useScrollIntoView } from "@/hooks/use-scroll-into-view";
import { pressedAlone } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./user-avatar";

/** A custom reaction starts with something other than a space. */
const CUSTOM_REACTION = String.raw`\S+.*`;

/**
 * New boost's form, a pill in Add reaction's place: your avatar and a field for up to 16 characters that
 * can't start with a space, as wide as what's written, then Add reaction once something is, and an X that
 * cancels, as Escape does. How many characters are left shows once five or fewer are. It scrolls itself
 * into view, as its scroll-into-view controller does.
 */
export function CustomReaction({ me, fieldRef, onAdd, onCancel }: { me: Me; fieldRef?: Ref<HTMLInputElement>; onAdd: (content: string) => void; onCancel: () => void }) {
  const form = useRef<HTMLFormElement>(null);
  const hint = useId();
  const [content, setContent] = useState("");
  const left = MAX_BOOST_LENGTH - content.length;

  useScrollIntoView(form);

  return (
    <form
      ref={form}
      className="mt-1 flex h-8 max-w-full min-w-0 items-center gap-[0.4ch] rounded-[4rem] border bg-background pr-0.5 transition-shadow duration-150 focus-within:ring-2 focus-within:ring-selected-dark touch:h-11 touch:pr-0"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(content);
      }}
      onKeyDown={(event) => {
        if (!pressedAlone(event.nativeEvent, "Escape")) return;
        event.preventDefault();
        onCancel();
      }}
    >
      {/* Your avatar, and the pill's height round the field, take the field's taps too. */}
      <label className="flex min-w-0 cursor-text items-center gap-[0.4ch] self-stretch pl-[0.2em] touch:-my-px touch:pl-1.5">
        <UserAvatar user={me} className="size-[22px] touch:size-7" />
        <input
          ref={fieldRef}
          name="content"
          type="text"
          aria-label="Custom reaction"
          aria-describedby={hint}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="send"
          maxLength={MAX_BOOST_LENGTH}
          required
          pattern={CUSTOM_REACTION}
          // The field is as wide as what's written, which its placeholder would keep it wider than.
          placeholder={content === "" ? "Emoji or a word" : ""}
          value={content}
          onChange={(event) => setContent(event.currentTarget.value)}
          className="block min-w-[5ch] field-sizing-content bg-transparent text-[0.8rem] text-foreground outline-none placeholder:text-muted-foreground touch:text-base"
        />
      </label>
      <span id={hint} hidden>
        Up to 16 characters.
      </span>
      {left <= 5 && (
        <span className={cn("shrink-0 text-[11px] leading-none whitespace-nowrap text-muted-foreground tabular-nums", left === 0 && "text-negative")}>{left} left</span>
      )}
      {content.trim() !== "" && (
        <button type="submit" className="group/add grid size-6 shrink-0 cursor-pointer place-items-center touch:size-11">
          <span className="grid size-6 place-items-center rounded-full bg-foreground text-background group-hover/add:brightness-70 touch:size-7">
            <ArrowUp className="size-3.5" />
          </span>
          <span className="sr-only">Add reaction</span>
        </button>
      )}
      <button
        type="button"
        className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground touch:size-11"
        onClick={onCancel}
      >
        <Xmark className="size-4" />
        <span className="sr-only">Cancel</span>
      </button>
    </form>
  );
}
