import { useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EmojiPicker } from "./emoji-picker";
import { DIALOG_BACKDROP } from "./workspace/unsaved-changes";

interface Props {
  /** How many 44px emoji a row holds, within the sheet's gutters. */
  columns: number;
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Where focus goes once it's closed: the composer's text. */
  onReturnFocus: () => void;
}

/**
 * The emoji picker on phones: a sheet from the bottom of the screen, as wide as the screen allows, which
 * leaves the keyboard down until the search is tapped. It loads with the picker, so its dialog doesn't
 * weigh on the app's script.
 */
export function EmojiSheet({ columns, onPick, onClose, onReturnFocus }: Props) {
  const sheet = useRef<HTMLDivElement>(null);
  return (
    <Dialog open onOpenChange={(open) => open || onClose()}>
      <DialogContent
        ref={sheet}
        showCloseButton={false}
        overlayClassName={DIALOG_BACKDROP}
        aria-describedby={undefined}
        // The sheet takes focus, rather than the search, which would raise the keyboard over it.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          sheet.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
        className="top-auto bottom-0 left-0 block w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-t-[18px] rounded-b-none border-x-0 border-b-0 px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] sm:max-w-none"
      >
        <DialogTitle className="sr-only">Emoji</DialogTitle>
        <EmojiPicker columns={columns} autoFocus={false} onPick={onPick} onClose={onClose} className="h-[min(22rem,calc(100dvh-4rem))] w-full" />
      </DialogContent>
    </Dialog>
  );
}
