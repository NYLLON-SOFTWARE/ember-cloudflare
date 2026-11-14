import { useState, type ReactNode, type RefObject } from "react";
import type { ScheduledMessage } from "@ember/protocol";
import { Xmark } from "@/components/icons/iconoir";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Scheduled } from "@/hooks/use-scheduled";
import { sendTimeLabel } from "@/lib/schedule-times";
import { cn } from "@/lib/utils";
import { TEXT_BUTTON } from "./composer-buttons";
import { DIALOG, DIALOG_BACKDROP, DIALOG_CLOSE, DIALOG_TITLE } from "./dialog-styles";
import { SHEET, type ListedScheduled } from "./schedule-send";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether Edit time's dialog is open over it, which keeps focus from going back to the composer. */
  moving: boolean;
  onMove: (message: ListedScheduled) => void;
  list: RefObject<HTMLUListElement | null>;
  rows: ListedScheduled[];
  /** The one deleted, which keeps its place with Undo while it can be brought back. */
  deletedId: string | undefined;
  undoLine: (message: ListedScheduled) => ReactNode;
  now: Date;
  phone: boolean;
  disabled: boolean;
  scheduled: Scheduled;
  onEdit?: (message: ListedScheduled) => void;
  onRemove: (message: ListedScheduled) => void;
  onReturnFocus?: () => void;
}

/** See all's list of the scheduled messages (`ScheduledNotice`), which loads with the pages. */
export function ScheduledList({ open, onOpenChange, moving, onMove, list, rows, deletedId, undoLine, now, phone, disabled, scheduled, onEdit, onRemove, onReturnFocus }: Props) {
  const [acting, setActing] = useState<ListedScheduled | null>(null);
  const listAction = cn(TEXT_BUTTON, "px-2 hover:bg-hover");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        overlayClassName={DIALOG_BACKDROP}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          // A phone's sheet takes focus itself, rather than ringing a row no finger has chosen.
          if (phone) {
            (event.currentTarget as HTMLElement).focus();
            return;
          }
          // On the first message's Edit time, or Edit, rather than Send now, so Enter can't send it.
          const first = list.current?.querySelector("li");
          (first?.querySelector<HTMLElement>("button[data-first]") ?? first?.querySelector<HTMLElement>("button"))?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!onReturnFocus || moving) return;
          event.preventDefault();
          onReturnFocus();
        }}
        className={cn(DIALOG, SHEET, "w-[520px]")}
      >
        <button type="button" aria-label="Close" onClick={() => onOpenChange(false)} className={DIALOG_CLOSE}>
          <Xmark className="size-[18px]" />
        </button>
        <DialogTitle className={cn(DIALOG_TITLE, "mb-1 pe-10")}>Scheduled messages</DialogTitle>
        <ul ref={list} className="flex flex-col divide-y">
          {rows.map((message) => (
            <li key={message.id} className="py-3 last:pb-0 max-md:py-1">
              {message.id === deletedId ? (
                <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground max-md:min-h-12 max-md:text-[15px]">{undoLine(message)}</p>
              ) : phone ? (
                <button type="button" disabled={disabled} onClick={() => setActing(message)} className="w-full cursor-pointer rounded-[9px] py-2 text-start disabled:opacity-50">
                  <span className="line-clamp-2 text-[17px] wrap-anywhere whitespace-pre-wrap text-message-ink">{message.text}</span>
                  <span className="mt-0.5 block text-[15px] text-muted-foreground">{whenLine(message, now)}</span>
                </button>
              ) : (
                <>
                  <p className="text-[13px] font-semibold">{whenLine(message, now)}</p>
                  <p className="mt-0.5 line-clamp-3 text-sm wrap-anywhere whitespace-pre-wrap text-message-ink">{message.text}</p>
                  <div className="mt-1.5 -ms-2 flex flex-wrap gap-1">
                    <button type="button" disabled={disabled} onClick={() => scheduled.sendNow(message.id)} className={listAction}>
                      Send now
                    </button>
                    {message.failed === undefined ? (
                      <button type="button" disabled={disabled} data-first onClick={() => onMove(message)} className={listAction}>
                        Edit time
                      </button>
                    ) : (
                      onEdit && (
                        <button type="button" disabled={disabled} data-first onClick={() => onEdit(message)} className={listAction}>
                          Edit
                        </button>
                      )
                    )}
                    <button type="button" disabled={disabled} onClick={() => onRemove(message)} className={cn(listAction, "text-negative")}>
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
        {acting && (
          <ScheduledSheet
            text={acting.text}
            failed={acting.failed !== undefined}
            onClose={() => setActing(null)}
            onSendNow={() => scheduled.sendNow(acting.id)}
            onMove={() => onMove(acting)}
            onEdit={onEdit && (() => onEdit(acting))}
            onRemove={() => onRemove(acting)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface SheetProps {
  /** What the message says, which the sheet is titled by. */
  text: string;
  /** Whether the room couldn't send it when it was due, which is edited rather than moved. */
  failed: boolean;
  onClose: () => void;
  onSendNow: () => void;
  onMove: () => void;
  /** Writes one that couldn't be sent in the composer, where there's one to write it in. */
  onEdit?: () => void;
  onRemove: () => void;
}

/** A phone's sheet of what can be done with a scheduled message: send it now, move or edit it, or delete it. */
export function ScheduledSheet({ text, failed, onClose, onSendNow, onMove, onEdit, onRemove }: SheetProps) {
  const sheetAction = "flex min-h-12 w-full cursor-pointer items-center rounded-[9px] px-3 text-start text-[17px] hover:bg-hover disabled:pointer-events-none disabled:opacity-50";
  const then = (act: () => void) => () => {
    onClose();
    act();
  };
  return (
    <Dialog open onOpenChange={(opened) => opened || onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        overlayClassName="bg-transparent"
        // A finger opens it, so focus goes to the sheet itself, which shows no ring, rather than ringing Send now,
        // which no key chose. Tab goes on to its actions, ringed then.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
        className={cn(DIALOG, SHEET, "p-3")}
      >
        <DialogTitle className="line-clamp-2 px-3 pt-2 pb-1 text-[15px] font-normal wrap-anywhere text-muted-foreground">{text}</DialogTitle>
        <div className="flex flex-col">
          <button type="button" onClick={then(onSendNow)} className={sheetAction}>
            Send now
          </button>
          {!failed ? (
            <button type="button" onClick={then(onMove)} className={sheetAction}>
              Edit time
            </button>
          ) : (
            onEdit && (
              <button type="button" onClick={then(onEdit)} className={sheetAction}>
                Edit
              </button>
            )
          )}
          <button type="button" onClick={then(onRemove)} className={cn(sheetAction, "text-destructive")}>
            Delete
          </button>
          <button type="button" onClick={onClose} className={cn(sheetAction, "font-semibold")}>
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** When a listed message goes, or that it didn't, and why. */
function whenLine(message: ScheduledMessage, now: Date) {
  if (message.failed === undefined) return sendTimeLabel(message.sendAt, now);
  return (
    <>
      <span className="text-destructive">Not sent:</span> {message.failed}
    </>
  );
}
