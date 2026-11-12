import type { ReactNode } from "react";
import { NAMED_NEW_VIEWERS, type RoomId, type ShareWidening } from "@ember/protocol";
import { Lock } from "@/components/icons/iconoir";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { checkShare } from "@/lib/api";
import { toSentence } from "@/lib/directs";
import { cn } from "@/lib/utils";
import { DIALOG, DIALOG_BACKDROP, DIALOG_TITLE, MAIN_ACTION, OTHER_ACTION } from "./unsaved-changes";

// The warning before sharing what's in one room in another that reaches people who can't see the first,
// as Slack's is: Files in Ember asks it, and Forward can.

/**
 * A room as the warning names it: its label, "#design", or a DM's people, whether it's a DM, and whether
 * it's private, which shows a lock in place of the #.
 */
export interface SharePlace {
  label: string;
  direct: boolean;
  closed?: boolean;
}

/**
 * Whether sharing from `sourceRoomId` in `targetRoomId` needs the warning first, as the Worker counts who'd
 * see it anew: null for the same room, which reaches nobody new.
 */
export async function shareWidening(sourceRoomId: RoomId, targetRoomId: RoomId): Promise<ShareWidening | null> {
  return sourceRoomId === targetRoomId ? null : checkShare(sourceRoomId, targetRoomId);
}

/** A room's name in the warning: a private room's after a lock, rather than a #. */
function placeName({ label, closed }: SharePlace): ReactNode {
  if (!closed) return label;
  return (
    <span className="whitespace-nowrap">
      <Lock className="me-0.5 inline size-[0.8em] align-baseline" />
      <span className="sr-only">private </span>
      {label.replace(/^#/, "")}
    </span>
  );
}

/** The warning's title, for what sharing is called, "Share" or "Forward": outside the room it's from, or the DM. */
export function shareWarningTitle(source: SharePlace, verb = "Share"): ReactNode {
  return source.direct ? `${verb} outside your DM with ${source.label}?` : <>{verb} outside {placeName(source)}?</>;
}

/** What's shared, as the warning says what they'll do with it. */
export type ShareSubject = "file" | "message";

/**
 * What sharing does, as the warning says it: who'll be able to open the file, or see the message, by name for
 * up to three of them, or else how many, who aren’t where it's from.
 */
export function shareWarningLine({ newViewers, names }: ShareWidening, source: SharePlace, target: SharePlace, subject: ShareSubject = "file"): ReactNode {
  const action = subject === "file" ? "open this file" : "see this message";
  const where = target.direct ? `your DM with ${target.label}` : placeName(target);
  if (newViewers <= NAMED_NEW_VIEWERS && names.length === newViewers) {
    return (
      <>
        {toSentence(names)} will be able to {action} in {where}.
      </>
    );
  }
  const from = source.direct ? `your DM with ${source.label}` : placeName(source);
  return (
    <>
      {newViewers} people in {where} aren’t in {from} and will be able to {action}.
    </>
  );
}

interface Props {
  source: SharePlace;
  target: SharePlace;
  widening: ShareWidening;
  subject?: ShareSubject;
  /** What the button that goes ahead says: Share, or Attach where that only adds the file to what's written. */
  confirm?: string;
  /** What its title calls sharing: Share, or Forward for Forward message. */
  verb?: string;
  onShare: () => void;
  /** Cancel, Escape or the backdrop, which share nothing. */
  onCancel: () => void;
  /** Where focus goes once it closes, when not back to what had it as it opened. */
  onReturnFocus?: () => void;
  /** What's laid over the page behind it: nothing more, over another dialog, which has its own. */
  overlayClassName?: string;
}

/**
 * Asks before sharing beyond who can see the original: an alert dialog, which phones show as a sheet from
 * the bottom of the screen, with Cancel, which has focus, and the button that goes ahead.
 */
export function ShareWarning({ source, target, widening, subject = "file", confirm = "Share", verb = "Share", onShare, onCancel, onReturnFocus, overlayClassName = DIALOG_BACKDROP }: Props) {
  return (
    <Dialog open onOpenChange={(open) => open || onCancel()}>
      <DialogContent
        role="alertdialog"
        showCloseButton={false}
        overlayClassName={overlayClassName}
        onCloseAutoFocus={(event) => {
          if (!onReturnFocus) return;
          event.preventDefault();
          onReturnFocus();
        }}
        className={cn(
          DIALOG,
          "max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:pb-[max(24px,env(safe-area-inset-bottom))] max-md:sm:max-w-none",
        )}
      >
        <DialogTitle className={DIALOG_TITLE}>{shareWarningTitle(source, verb)}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground max-md:text-[15px]">{shareWarningLine(widening, source, target, subject)}</DialogDescription>
        <div className="mt-5 flex flex-wrap justify-end gap-2 max-md:text-[17px]">
          <button type="button" onClick={onCancel} className={OTHER_ACTION}>
            Cancel
          </button>
          <button type="button" onClick={onShare} className={MAIN_ACTION}>
            {confirm}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
