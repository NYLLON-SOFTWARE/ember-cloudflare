import { useRef, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DIALOG_BACKDROP } from "./dialog-styles";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
  /** The emoji picker, as wide as the sheet. */
  picker: ReactNode;
}

/**
 * A phone's Emoji (`EmojiButton`): the picker in a sheet from the bottom of the screen, as wide as the screen
 * allows, which leaves the keyboard down until the search is tapped. It loads with the pages.
 */
export function EmojiSheet({ open, onOpenChange, onCloseAutoFocus, picker }: Props) {
  const sheet = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
        onCloseAutoFocus={onCloseAutoFocus}
        className="top-auto bottom-0 left-0 block w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-t-[18px] rounded-b-none border-x-0 border-b-0 px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] sm:max-w-none"
      >
        <DialogTitle className="sr-only">Emoji</DialogTitle>
        {picker}
      </DialogContent>
    </Dialog>
  );
}
