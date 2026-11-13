import { useContext, useId, useLayoutEffect, useRef, useState, type ComponentProps, type Ref } from "react";
import { REACTIONS, type Boost, type Me, type Message } from "@ember/protocol";
import { isAllEmoji } from "@ember/richtext/dom";
import { Emoji, Minus } from "@/components/icons/iconoir";
import { useNameOf } from "@/hooks/use-directory";
import { useMediaQuery } from "@/hooks/use-media-query";
import { RefusedUnboosts, RoomConnection } from "@/hooks/use-room";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { safeAreaBoundary } from "@/lib/safe-area";
import { cn } from "@/lib/utils";
import { OVERLAPPING, PANEL, ReactionChoices } from "./message-actions-menu";
import type { MessageActions } from "./message-item";
import { RarePage } from "./rare-pages";
import { AvatarLink, UserAvatar } from "./user-avatar";

interface Props {
  message: Message;
  me: Me;
  threaded: boolean;
  /** What can be done to the message, or null where nothing can, as in a room that's gone. */
  actions: MessageActions | null;
  /** Whether the Custom reaction form shows, in place of Add reaction. */
  customizing: boolean;
  /** The Custom reaction form's field, while it shows. */
  customField?: Ref<HTMLInputElement>;
  /** Opens the Custom reaction form, from the picker's New boost. */
  onNewBoost: () => void;
  /**
   * Opens a phone's sheet of reactions from Add reaction, given the button, where a phone's messages have
   * sheets in place of Message options. Left out, Add reaction opens its own picker beside it.
   */
  onAddReaction?: (button: HTMLButtonElement) => void;
  /** Closes the Custom reaction form. */
  onCloseCustom: () => void;
  /** Hands focus to the message's Message options, as a reaction sent or deleted here does. */
  returnFocus: () => void;
}

/**
 * The reactions under a message (Campfire's boosts.css): a pill for each, oldest first, then Add reaction,
 * a pill as tall as theirs, which opens a picker of reactions alone, or the Custom reaction form that New
 * boost opens in its place. Add reaction shows once the message has a reaction, as messages.css shows it.
 */
export function MessageBoosts({ message, me, threaded, actions, customizing, customField, onNewBoost, onAddReaction, onCloseCustom, returnFocus }: Props) {
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
        // Under a grouped message's text and time, across both columns.
        "col-span-full flex w-full flex-wrap items-center gap-x-[0.4ch] text-message-ink",
        // Where Message options is 44px, the next message's rises 11px into this one, reaching 38px in from
        // its edge, so reactions, and the Custom reaction form after them, stop short of it. A grouped
        // message's body already keeps 32px of that clear. A phone's sheets leave nothing there.
        !onAddReaction && (threaded ? "touch:pr-1.5" : "touch:pr-[38px]"),
      )}
    >
      <ul aria-label="Reactions" className="flex flex-wrap gap-x-[0.4ch] empty:hidden">
        {message.boosts.map((boost) => (
          <BoostPill key={boost.id} boost={boost} hint={hint} onDelete={deletable(boost) ? () => remove(boost) : null} />
        ))}
        {/* Among the reactions, as Slack's is, so it shares their 24px floor for fingertips, though not one
            of them to screen readers. */}
        {actions && !customizing && message.boosts.length > 0 && (
          <li role="none" className="mt-1 flex">
            {onAddReaction ? (
              <AddReaction onClick={(event) => onAddReaction(event.currentTarget)} />
            ) : (
              <ReactionPicker onReact={(emoji) => actions.boost(message.id, emoji)} onNewBoost={onNewBoost} />
            )}
          </li>
        )}
      </ul>
      {message.boosts.some(deletable) && (
        <span id={hint} hidden>
          Press enter to delete this boost
        </span>
      )}
      {/* Opened from the reactions' picker, which loads with the pages, as it does. */}
      {customizing && <RarePage show={({ CustomReaction }) => <CustomReaction me={me} fieldRef={customField} onAdd={add} onCancel={cancel} />} loading={null} />}
    </div>
  );
}

/**
 * Add reaction: a pill with a smiley, of a reaction pill's height, radius and border, its emoji's line
 * holding the smiley as the pill's holds its emoji. For fingers it's wider, 44px, and takes taps a little
 * above and below it, as far as the reactions and summary around it leave clear.
 */
function AddReaction(props: ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label="Add reaction"
      className={cn(
        "relative flex cursor-pointer items-center rounded-[4rem] border bg-background px-2.5 py-[0.1em] text-muted-foreground hover:not-active:border-muted-foreground hover:not-active:text-foreground aria-expanded:border-muted-foreground aria-expanded:text-foreground",
        "touch:px-3 touch:after:absolute touch:after:-inset-x-px touch:after:-inset-y-1 touch:after:rounded-[4rem]",
      )}
      {...props}
    >
      <span className="grid h-6 place-items-center">
        <Emoji className="size-[18px]" />
      </span>
    </button>
  );
}

/**
 * The picker Add reaction opens beside itself, where messages have Message options: every reaction, then
 * New boost, without the rest of the message's actions. Choosing one closes it, handing focus back to Add
 * reaction, as Escape does.
 */
function ReactionPicker({ onReact, onNewBoost }: { onReact: (emoji: string) => void; onNewBoost: () => void }) {
  const [open, setOpen] = useState(false);
  // A finger's tap outside it only closes it, so what it covers can't be pressed by mistake.
  const fingers = !useMediaQuery(OVERLAPPING);
  const choose = (then: () => void) => {
    setOpen(false);
    then();
  };
  return (
    <Popover open={open} onOpenChange={setOpen} modal={fingers}>
      <PopoverTrigger asChild>
        <AddReaction />
      </PopoverTrigger>
      {/* Over the timeline rather than the composer under the message, and clear of a notch. */}
      <PopoverContent
        aria-label="Add reaction"
        side="top"
        align="start"
        collisionPadding={8}
        collisionBoundary={safeAreaBoundary()}
        className={cn(PANEL, "w-max max-w-(--radix-popover-content-available-width) p-2 text-foreground")}
      >
        <ReactionChoices reactions={REACTIONS} onReact={(emoji) => choose(() => onReact(emoji))} onNewBoost={() => choose(onNewBoost)} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * One reaction: its booster's avatar, named "<name> boosted <content>", then the content, larger when
 * it's all emoji. Clicking your own, or pressing Enter on it, reveals Delete this boost and focuses it,
 * as boost_delete_controller.js does, and Delete shrinks it away while it goes. Other people's do
 * nothing.
 */
function BoostPill({ boost, hint, onDelete }: { boost: Boost; hint: string; onDelete: (() => boolean) | null }) {
  const nameOf = useNameOf();
  const [expanded, setExpanded] = useState(false);
  // The connection the deletion went on, and the room's refusals to delete a reaction by then. The reaction
  // comes back if the page reconnects before it goes, since the deletion may have been lost with the
  // connection it went on, or if the room refuses to delete one, since it doesn't say which.
  const connection = useContext(RoomConnection);
  const refusals = useContext(RefusedUnboosts);
  const [deletedAt, setDeletedAt] = useState<{ connection: number; refusals: number } | null>(null);
  const deleting = deletedAt?.connection === connection && deletedAt.refusals === refusals;
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
        // The pill keeps the gap before its Delete button while that's hidden.
        reveal ? "pr-[0.2em]" : "pr-[calc(0.2em+0.4ch)]",
        deleting && "pointer-events-none animate-scale-fade-out motion-reduce:animate-none motion-reduce:opacity-0",
      )}
    >
      {/*
       * 2.2ch of the medium weight of the avatar button, over the button that takes the rest of the
       * pill's clicks. A pill has no room for two targets a fingertip can find, so on touch screens your own
       * is all that button.
       */}
      <AvatarLink
        user={boost.booster}
        reach="dense"
        label={`${nameOf(boost.booster)} boosted ${boost.content}`}
        className={cn("z-[1] size-[2.2ch] font-medium", onDelete && "touch:pointer-events-none")}
      />
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
          className="relative ml-auto grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border border-transparent bg-negative-button text-[0.55rem] text-white touch:size-11 hover:not-active:brightness-70"
          onClick={() => {
            if (onDelete()) setDeletedAt({ connection, refusals });
          }}
        >
          <Minus className="h-5 w-[1.3em]" />
          <span className="sr-only">Delete this boost</span>
        </button>
      )}
    </li>
  );
}
