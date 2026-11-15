import { useId } from "react";
import { QUICK_REACTION_COUNT, REACTIONS } from "@ember/protocol";
import { ChatPlusIn } from "@/components/icons/iconoir";
import { BottomSheet } from "./action-sheet";

/** A reaction to pick: its emoji in a 48px circle, named by its title. */
export const CHOICE = "grid size-12 cursor-pointer place-items-center rounded-full bg-surface text-[26px] leading-none hover:bg-hover active:bg-hover";

/** A row of the sheet's reactions, laid out evenly across it. */
const ROW = "grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] justify-items-center gap-y-2 px-2";

/** The muted heading over each of the picker's rows of reactions. */
const HEADING = "px-4 pt-1 pb-2 text-[13px] font-semibold text-muted-foreground";

interface PickerProps {
  onReact: (emoji: string) => void;
  /** Opens the message's Custom reaction form, from New boost. */
  onNewBoost: () => void;
}

/**
 * What the sheet picks from: the quick reactions a message's long press offers, then every reaction, then
 * New boost. The emoji picker the composer shares takes its place once it can search.
 */
export function ReactionPicker({ onReact, onNewBoost }: PickerProps) {
  const frequent = useId();
  const all = useId();
  const choice = ([emoji, title]: readonly [string, string]) => (
    <button key={emoji} type="button" aria-label={title} className={CHOICE} onClick={() => onReact(emoji)}>
      <span aria-hidden>{emoji}</span>
    </button>
  );
  return (
    <>
      <div role="group" aria-labelledby={frequent}>
        <h3 id={frequent} className={HEADING}>
          Frequently used
        </h3>
        <div className={ROW}>{REACTIONS.slice(0, QUICK_REACTION_COUNT).map(choice)}</div>
      </div>
      <div role="group" aria-labelledby={all} className="pb-2">
        <h3 id={all} className={HEADING}>
          All reactions
        </h3>
        <div className={ROW}>
          {REACTIONS.map(choice)}
          <button type="button" aria-label="New boost" className={CHOICE} onClick={onNewBoost}>
            <ChatPlusIn className="size-6 text-muted-foreground" />
          </button>
        </div>
      </div>
    </>
  );
}

interface Props extends PickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

/** Add reaction on a phone: a sheet of reactions alone, which picking one, or New boost, closes. */
export function ReactionSheet({ open, onOpenChange, onCloseAutoFocus, onReact, onNewBoost }: Props) {
  const close = (then: () => void) => {
    onOpenChange(false);
    then();
  };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Add reaction" titleHidden onCloseAutoFocus={onCloseAutoFocus}>
      <ReactionPicker onReact={(emoji) => close(() => onReact(emoji))} onNewBoost={() => close(onNewBoost)} />
    </BottomSheet>
  );
}
