import { useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { MAX_BOOST_LENGTH, type Boost, type Me, type Message } from "@ember/protocol";
import { isAllEmoji } from "@ember/richtext/dom";
import { ArrowUp, Emoji, Xmark } from "@/components/icons/iconoir";
import { useNameOf } from "@/hooks/use-directory";
import { useScrollIntoView } from "@/hooks/use-scroll-into-view";
import { pressedAlone } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import type { MessageActions } from "./message-item";
import { UserAvatar } from "./user-avatar";

/** A custom reaction starts with something other than a space. */
const CUSTOM_REACTION = String.raw`\S+.*`;

/** One reaction and everyone who added it, oldest first. */
export interface BoostGroup {
  content: string;
  boosts: Boost[];
}

/**
 * A message's boosts gathered by what they say, in the order each was first added, so everyone who added
 * the same reaction shares one chip, as Slack shows them. A bot can add the same one more than once.
 */
export function groupBoosts(boosts: readonly Boost[]): BoostGroup[] {
  const groups = new Map<string, BoostGroup>();
  for (const boost of boosts) {
    const group = groups.get(boost.content);
    if (group) group.boosts.push(boost);
    else groups.set(boost.content, { content: boost.content, boosts: [boost] });
  }
  return [...groups.values()];
}

/** How many of a reaction's boosters its chip stacks, so it's no wider for five than for three. */
const STACKED = 3;

const namesOf = new Intl.ListFormat("en-US", { type: "conjunction" });

interface Props {
  message: Message;
  me: Me;
  threaded: boolean;
  /** What can be done to the message, or null where nothing can, as in a room that's gone. */
  actions: MessageActions | null;
  /** Whether the Custom reaction form shows, in place of Add a boost. */
  customizing: boolean;
  /** The Custom reaction form's field, while it shows. */
  customField?: Ref<HTMLInputElement>;
  /** Opens the message's bar with More reactions showing, from its Add a boost. */
  onAddBoost: (button: HTMLButtonElement) => void;
  /** Closes the Custom reaction form. */
  onCloseCustom: () => void;
  /** Hands focus to the message's Message options, as a reaction sent or taken back here does. */
  returnFocus: () => void;
}

/**
 * The reactions under a message: a chip for each reaction, in the order each was first added, then Add a
 * boost, which opens the message's bar with More reactions showing, or the Custom reaction form that New
 * boost opens in its place. Add a boost shows once the message has a reaction, as messages.css shows it.
 */
export function MessageBoosts({ message, me, threaded, actions, customizing, customField, onAddBoost, onCloseCustom, returnFocus }: Props) {
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

  // A tap adds the reaction, or takes back yours, each copy a quick double tap may have stored. Where the chip
  // goes with them, focus goes to Message options, as it would with the chip.
  const toggle = ({ content, boosts }: BoostGroup) => {
    const mine = boosts.filter((boost) => boost.booster.id === me.id);
    if (mine.length === 0) return actions!.boost(message.id, content);
    const sent = mine.map((boost) => actions!.unboost(boost.id)).every(Boolean);
    if (sent && mine.length === boosts.length) returnFocus();
    return sent;
  };

  return (
    <div
      className={cn(
        // Under a grouped message's text and time, across both columns.
        "col-span-full flex w-full flex-wrap items-center gap-x-[0.4ch] text-message-ink",
        // Where Message options is 44px, the next message's rises 11px into this one, reaching 38px in from
        // its edge, so reactions, and the Custom reaction form after them, stop short of it. A grouped
        // message's body already keeps 32px of that clear.
        threaded ? "touch:pr-1.5" : "touch:pr-[38px]",
      )}
    >
      <ul aria-label="Reactions" className="flex flex-wrap gap-x-[0.4ch] empty:hidden">
        {groupBoosts(message.boosts).map((group) => (
          <BoostChip key={group.content} group={group} me={me} onToggle={actions && (() => toggle(group))} />
        ))}
      </ul>
      {customizing ? (
        <CustomReaction me={me} fieldRef={customField} onAdd={add} onCancel={cancel} />
      ) : (
        actions &&
        message.boosts.length > 0 && (
          <button
            type="button"
            className="mt-1 grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border bg-background text-[0.66em] text-foreground touch:size-11 hover:not-active:border-muted-foreground"
            onClick={(event) => onAddBoost(event.currentTarget)}
          >
            <Emoji className="h-5 w-[1.3em]" />
            <span className="sr-only">Add a boost</span>
          </button>
        )
      )}
    </div>
  );
}

/**
 * One reaction: the face of whoever added it first, with a disc stacked behind it for each of the next two,
 * then the reaction, larger when it's all emoji. The whole chip is one button, so a fingertip can't miss it: it adds
 * the reaction for you, or takes yours back once you've added it, which the chip marks. Who added it is in
 * its name, which a mouse shows too. Where nothing can be done to the message, the chip only shows.
 */
function BoostChip({ group, me, onToggle }: { group: BoostGroup; me: Me; onToggle: (() => boolean) | null }) {
  const nameOf = useNameOf();
  const mine = group.boosts.some((boost) => boost.booster.id === me.id);
  // Each booster once, though a bot may have added the reaction more than once.
  const boosters = [...new Map(group.boosts.map((boost) => [boost.booster.id, boost.booster])).values()];
  const names = boosters.map((booster) => (booster.id === me.id ? "you" : nameOf(booster)));
  const label = `${group.content}, ${boosters.length === 1 ? "1 reaction" : `${boosters.length} reactions`}: ${namesOf.format(names)}`;

  return (
    <li className="mt-1 flex max-w-full">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={onToggle ? mine : undefined}
        // Still focusable where nothing can be done, so who reacted can be read there too.
        aria-disabled={!onToggle || undefined}
        onClick={() => onToggle?.()}
        className={cn(
          "flex max-w-full cursor-pointer items-center gap-x-[0.4ch] rounded-[4rem] border bg-background py-[0.1em] pr-[calc(0.2em+0.4ch)] pl-[0.1em] aria-disabled:cursor-default",
          "not-aria-disabled:hover:not-active:border-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground",
          mine && "border-link not-aria-disabled:hover:not-active:border-link",
        )}
      >
        <span aria-hidden="true" className="isolate flex shrink-0">
          <UserAvatar user={boosters[0]!} className="relative z-[2] size-[2.2ch] font-medium" />
          {/* Whoever else added it, as blank discs fanned behind the first face, each behind and paler than the one before. */}
          {boosters.slice(1, STACKED).map((booster, index) => (
            <span key={booster.id} className={cn("relative -ml-[1.7ch] size-[2.2ch] rounded-full", index === 0 ? "z-[1] bg-selected-dark" : "z-0 bg-message-border")} />
          ))}
        </span>
        <span aria-hidden="true" className={cn("min-w-0 leading-normal", isAllEmoji(group.content) ? "text-base" : "text-[0.8rem]")}>
          {group.content}
        </span>
      </button>
    </li>
  );
}

/**
 * New boost's form, a pill in Add a boost's place: your avatar and a field for up to 16 characters that
 * can't start with a space, as wide as what's written, then Add reaction once something is, and an X that
 * cancels, as Escape does. How many characters are left shows once five or fewer are. It scrolls itself
 * into view, as its scroll-into-view controller does.
 */
function CustomReaction({ me, fieldRef, onAdd, onCancel }: { me: Me; fieldRef?: Ref<HTMLInputElement>; onAdd: (content: string) => void; onCancel: () => void }) {
  const form = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const hint = useId();
  const [content, setContent] = useState("");
  const left = MAX_BOOST_LENGTH - content.length;

  useImperativeHandle(fieldRef, () => field.current!);
  useScrollIntoView(form);
  // The field takes focus once the form's laid out, without the browser scrolling to it, since the form scrolls
  // itself into view: Safari's focus on a field it has yet to lay out, or that scrolls to it, stops that scroll.
  useLayoutEffect(() => {
    form.current!.getBoundingClientRect();
    field.current!.focus({ preventScroll: true });
  }, []);

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
          ref={field}
          name="content"
          type="text"
          aria-label="Custom reaction"
          aria-describedby={hint}
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
