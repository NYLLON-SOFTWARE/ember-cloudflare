import { useSheetColumns } from "@/components/emoji-columns";
import { EmojiPicker } from "@/components/emoji-picker";
import { ChatPlusIn } from "@/components/icons/iconoir";
import { BottomSheet, ROW } from "./action-sheet";

/** How wide the sheet gets, as BottomSheet has it. */
const SHEET_WIDTH = 560;

/** A reaction to pick: its emoji in a 48px circle, named by its title. */
export const CHOICE = "grid size-12 cursor-pointer place-items-center rounded-full bg-surface text-[26px] leading-none hover:bg-hover active:bg-hover";

interface PickerProps {
  onReact: (emoji: string) => void;
  /** Opens the message's Custom reaction form, from New boost. */
  onNewBoost: () => void;
}

interface Props extends PickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Add reaction on a phone, and on a touch screen too short for the bar's tray: the emoji picker the
 * composer shares, to search every emoji, in a sheet, then New boost. Picking one, or New boost, closes it.
 */
export function ReactionSheet({ open, onOpenChange, onCloseAutoFocus, onReact, onNewBoost }: Props) {
  const columns = useSheetColumns(SHEET_WIDTH);
  const close = (then: () => void) => {
    onOpenChange(false);
    then();
  };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Add reaction" titleHidden onCloseAutoFocus={onCloseAutoFocus}>
      <EmojiPicker
        columns={columns}
        autoFocus={false}
        onPick={(emoji) => close(() => onReact(emoji))}
        className="h-[min(22rem,calc(100dvh-10rem))] w-full shrink-0"
      />
      <button type="button" className={ROW} onClick={() => close(onNewBoost)}>
        <ChatPlusIn className="size-5 text-muted-foreground" />
        New boost
      </button>
    </BottomSheet>
  );
}
