import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { MAX_BOOST_LENGTH, type Boost, type Me, type Message } from "@ember/protocol";
import { isAllEmoji } from "@ember/richtext/dom";
import { Boost as BoostIcon, Minus } from "@/components/icons/campfire";
import { useNameOf } from "@/hooks/use-directory";
import { pressedAlone } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import type { MessageActions } from "./message-item";
import { UserAvatar } from "./user-avatar";

/** A custom reaction starts with something other than a space (messages/boosts/new.html). */
const CUSTOM_REACTION = String.raw`\S+.*`;

/** The Custom reaction form's buttons (zz-ember.css, `.mb-custom-reaction-actions .btn`), 44px for fingers. */
const FORM_BUTTON =
  "inline-flex min-h-10 cursor-pointer items-center justify-center gap-[0.5em] rounded-[9px] border px-3 py-2 text-[13px] font-medium touch:min-h-11";

interface Props {
  message: Message;
  me: Me;
  threaded: boolean;
  /** What can be done to the message, or null where nothing can, as in a room that's gone. */
  actions: MessageActions | null;
  /** Whether the Custom reaction form shows, in place of Add a boost. */
  customizing: boolean;
  /** Opens the message's bar with More reactions showing, from its Add a boost. */
  onAddBoost: (button: HTMLButtonElement) => void;
  /** Closes the Custom reaction form. */
  onCloseCustom: () => void;
  /** Hands focus to the message's Message options, as a reaction sent or deleted here does. */
  returnFocus: () => void;
}

/**
 * The reactions under a message (messages/boosts/_boosts.html, boosts.css, zz-ember.css): a pill for
 * each, oldest first, then Add a boost, which opens the message's bar with More reactions showing, or the
 * Custom reaction form that New boost opens in its place. Add a boost shows once the message has a
 * reaction, as messages.css shows it.
 */
export function MessageBoosts({ message, me, threaded, actions, customizing, onAddBoost, onCloseCustom, returnFocus }: Props) {
  const hint = useId();
  const deletable = (boost: Boost) => actions !== null && boost.booster.id === me.id;

  // The form closes once its reaction is sent, and stays, keeping what's written, when it can't be.
  const add = (content: string) => {
    if (!actions?.boost(message.id, content)) return;
    onCloseCustom();
    returnFocus();
  };

  const cancel = () => {
    onCloseCustom();
    returnFocus();
  };

  // Focus would go with the reaction, so it goes to Message options, as it does once you react from the bar.
  const remove = (boost: Boost) => {
    const sent = actions!.unboost(boost.id);
    if (sent) returnFocus();
    return sent;
  };

  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-center gap-x-[0.4ch] text-message-ink",
        // Where Message options is 44px, the next message's rises 11px into this one, reaching 38px in from
        // its edge, so reactions stop short of it. A grouped message's body already keeps 32px of that clear.
        // The Custom reaction form's buttons sit higher than that, so it takes the row's whole width.
        !customizing && (threaded ? "touch:pr-1.5" : "touch:pr-[38px]"),
      )}
    >
      <ul aria-label="Reactions" className="flex flex-wrap gap-x-[0.4ch] empty:hidden">
        {message.boosts.map((boost) => (
          <BoostPill key={boost.id} boost={boost} hint={hint} onDelete={deletable(boost) ? () => remove(boost) : null} />
        ))}
      </ul>
      {message.boosts.some(deletable) && (
        <span id={hint} hidden>
          Press enter to delete this boost
        </span>
      )}
      {customizing ? (
        <CustomReaction me={me} onAdd={add} onCancel={cancel} />
      ) : (
        actions &&
        message.boosts.length > 0 && (
          <button
            type="button"
            className="mt-1 grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border bg-background text-[0.66em] text-foreground touch:size-11 hover:not-active:border-muted-foreground"
            onClick={(event) => onAddBoost(event.currentTarget)}
          >
            <BoostIcon className="h-5 w-[1.3em]" />
            <span className="sr-only">Add a boost</span>
          </button>
        )
      )}
    </div>
  );
}

/**
 * One reaction (messages/boosts/_boost.html): its booster's avatar, named "<name> boosted <content>",
 * then the content, larger when it's all emoji. Clicking your own, or pressing Enter on it, reveals Delete
 * this boost and focuses it, as boost_delete_controller.js does, and Delete shrinks it away while it goes.
 * Other people's do nothing.
 */
function BoostPill({ boost, hint, onDelete }: { boost: Boost; hint: string; onDelete: (() => boolean) | null }) {
  const nameOf = useNameOf();
  const [expanded, setExpanded] = useState(false);
  // The reaction comes back if the room's copy of it is replaced before it goes, as it is after a
  // reconnect that lost the deletion.
  const [deleted, setDeleted] = useState<Boost | null>(null);
  const deleting = deleted === boost;
  const remove = useRef<HTMLButtonElement>(null);
  const content = cn("min-w-0 leading-normal", isAllEmoji(boost.content) ? "text-base" : "text-[0.8rem]");

  useLayoutEffect(() => {
    if (expanded) remove.current?.focus();
  }, [expanded]);

  const reveal = onDelete && expanded;

  return (
    <li
      className={cn(
        "relative mt-1 flex max-w-full items-center gap-x-[0.4ch] rounded-[4rem] border bg-background pt-[0.1em] pb-[0.1em] pl-[0.1em] hover:not-active:border-muted-foreground",
        // ember-rust's pill keeps the gap before its Delete form while the button in it is hidden.
        reveal ? "pr-[0.2em]" : "pr-[calc(0.2em+0.4ch)]",
        deleting && "pointer-events-none animate-scale-fade-out motion-reduce:animate-none motion-reduce:opacity-0",
      )}
    >
      {/* 2.2ch of the medium weight of ember-rust's avatar button. */}
      <UserAvatar user={boost.booster} label={`${nameOf(boost.booster)} boosted ${boost.content}`} className="size-[2.2ch] font-medium" />
      {onDelete ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-describedby={hint}
          // The whole pill takes the click, so a fingertip can find it.
          className={cn(content, "cursor-pointer after:absolute after:-inset-px after:rounded-[4rem]")}
          onClick={() => setExpanded((shown) => !shown)}
        >
          {boost.content}
        </button>
      ) : (
        <span className={content}>{boost.content}</span>
      )}
      {reveal && (
        <button
          ref={remove}
          type="button"
          className="relative ml-auto grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border border-transparent bg-negative-button text-[0.55rem] touch:size-11 hover:not-active:brightness-70"
          onClick={() => {
            if (onDelete()) setDeleted(boost);
          }}
        >
          <Minus tone="white" className="h-5 w-[1.3em]" />
          <span className="sr-only">Delete this boost</span>
        </button>
      )}
    </li>
  );
}

/**
 * New boost's form (messages/boosts/new.html, zz-ember.css's `.mb-custom-reaction`): your avatar and
 * "Custom reaction", a field for up to 16 characters that can't start with a space, and Cancel and Add
 * reaction. Escape cancels. It scrolls itself into view, as its scroll-into-view controller does.
 */
function CustomReaction({ me, onAdd, onCancel }: { me: Me; onAdd: (content: string) => void; onCancel: () => void }) {
  const form = useRef<HTMLFormElement>(null);
  const field = useId();
  const hint = useId();

  useEffect(() => {
    const frame = requestAnimationFrame(() => form.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAdd(new FormData(event.currentTarget).get("content") as string);
  };

  return (
    <div className="mt-2.5 mb-1.5 w-[340px] max-w-full min-w-0 rounded-[12px] border bg-surface p-3.5">
      <form
        ref={form}
        className="grid w-full min-w-0 gap-2.5"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (!pressedAlone(event.nativeEvent, "Escape")) return;
          event.preventDefault();
          onCancel();
        }}
      >
        <div className="flex items-center gap-[9px]">
          <UserAvatar user={me} className="size-7" />
          <label htmlFor={field} className="text-[13px] font-semibold">
            Custom reaction
          </label>
        </div>
        <input
          id={field}
          name="content"
          type="text"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          maxLength={MAX_BOOST_LENGTH}
          required
          pattern={CUSTOM_REACTION}
          placeholder="Emoji or a short message"
          aria-describedby={hint}
          className="block min-h-[42px] w-full min-w-0 rounded-[8px] border bg-background px-[11px] py-[9px] text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:shadow-[0_0_0_1px_var(--muted-foreground)] focus-visible:outline-none touch:text-base"
        />
        <p id={hint} className="-mt-[3px] mb-0.5 text-[12px] text-muted-foreground">
          Up to 16 characters.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={cn(FORM_BUTTON, "bg-background text-foreground")} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={cn(FORM_BUTTON, "border-transparent bg-foreground text-background hover:not-active:brightness-70")}>
            Add reaction
          </button>
        </div>
      </form>
    </div>
  );
}
