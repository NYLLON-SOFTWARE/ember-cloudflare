import type { RoomId, ShareWidening } from "@ember/protocol";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { checkShare } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DIALOG, DIALOG_BACKDROP, DIALOG_TITLE, MAIN_ACTION, OTHER_ACTION } from "./unsaved-changes";

// The warning before sharing what's in one room in another that reaches people who can't see the first,
// as Slack's is: Files in Ember asks it, and Forward can.

/** A room as the warning names it: its label, "#design", or a DM's people, and whether it's a DM. */
export interface SharePlace {
  label: string;
  direct: boolean;
}

/**
 * Whether sharing from `sourceRoomId` in `targetRoomId` needs the warning first, as the Worker counts who'd
 * see it anew: null for the same room, which reaches nobody new.
 */
export async function shareWidening(sourceRoomId: RoomId, targetRoomId: RoomId): Promise<ShareWidening | null> {
  return sourceRoomId === targetRoomId ? null : checkShare(sourceRoomId, targetRoomId);
}

/** The warning's title: outside the room it's from, or the DM. */
export const shareWarningTitle = (source: SharePlace) => (source.direct ? `Share outside your DM with ${source.label}?` : `Share outside ${source.label}?`);

/** Who the warning says can't see the original, in the room it's shared to. */
export const shareWarningLine = (newViewers: number, target: SharePlace) =>
  `${newViewers === 1 ? "1 person" : `${newViewers} people`} in ${target.direct ? `your DM with ${target.label}` : target.label} can't see the original.`;

interface Props {
  source: SharePlace;
  target: SharePlace;
  newViewers: number;
  onShare: () => void;
  /** Cancel, Escape or the backdrop, which share nothing. */
  onCancel: () => void;
  /** Where focus goes once it closes, when not back to what had it as it opened. */
  onReturnFocus?: () => void;
}

/**
 * Asks before sharing beyond who can see the original: an alert dialog, which phones show as a sheet from
 * the bottom of the screen, with Cancel, which has focus, and Share.
 */
export function ShareWarning({ source, target, newViewers, onShare, onCancel, onReturnFocus }: Props) {
  return (
    <Dialog open onOpenChange={(open) => open || onCancel()}>
      <DialogContent
        role="alertdialog"
        showCloseButton={false}
        overlayClassName={DIALOG_BACKDROP}
        onCloseAutoFocus={(event) => {
          if (!onReturnFocus) return;
          event.preventDefault();
          onReturnFocus();
        }}
        className={cn(
          DIALOG,
          "w-[400px] max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:pb-[max(24px,env(safe-area-inset-bottom))] max-md:sm:max-w-none",
        )}
      >
        <DialogTitle className={DIALOG_TITLE}>{shareWarningTitle(source)}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{shareWarningLine(newViewers, target)}</DialogDescription>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className={OTHER_ACTION}>
            Cancel
          </button>
          <button type="button" onClick={onShare} className={MAIN_ACTION}>
            Share
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
