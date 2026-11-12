import { useId, useRef, useState } from "react";
import { Xmark } from "@/components/icons/iconoir";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { hasTouchKeyboard } from "@/lib/keyboard";
import { customTime, dateValue, latestSendTime, SCHEDULE_AHEAD_DAYS, timeValue } from "@/lib/schedule-times";
import { cn } from "@/lib/utils";
import { DIALOG, DIALOG_BACKDROP, DIALOG_CLOSE, DIALOG_TITLE, MAIN_ACTION, OTHER_ACTION } from "./unsaved-changes";
import { SHEET } from "./schedule-send";

// Custom time, for scheduling a message or moving one, which loads with the pages few visits need (pages.ts).

interface TimeDialogProps {
  title: string;
  action: string;
  initial: Date;
  onPick: (at: Date) => void;
  onClose: () => void;
  /** Where focus goes once it closes. */
  onReturnFocus?: () => void;
}

/**
 * Asks for a day and a time, as Slack's Custom time does, refusing one that's passed or further ahead than
 * the room keeps one: a dialog that opens on the Date field, or on a phone, a sheet, with the fields and
 * its action across it.
 */
export function TimeDialog({ title, action, initial, onPick, onClose, onReturnFocus }: TimeDialogProps) {
  const [date, setDate] = useState(() => dateValue(initial));
  const [time, setTime] = useState(() => timeValue(initial));
  const [refusal, setRefusal] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  const dateField = useRef<HTMLInputElement>(null);
  const ids = { date: useId(), time: useId() };
  const field =
    "h-10 w-full rounded-[9px] border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-selected-dark touch:h-11 touch:text-base max-md:h-12";
  return (
    <Dialog open onOpenChange={(open) => open || onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        overlayClassName={DIALOG_BACKDROP}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          // A phone's date picker would open over the sheet before it's seen.
          if (hasTouchKeyboard()) (event.currentTarget as HTMLElement).focus();
          else dateField.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!onReturnFocus) return;
          event.preventDefault();
          onReturnFocus();
        }}
        className={cn(DIALOG, SHEET)}
      >
        <button type="button" aria-label="Close" onClick={onClose} className={cn(DIALOG_CLOSE, "max-md:hidden")}>
          <Xmark className="size-[18px]" />
        </button>
        <DialogTitle className={cn(DIALOG_TITLE, "mb-4 pe-10 max-md:pe-0")}>{title}</DialogTitle>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            // React passes it up its tree, out of the dialog's portal, to the composer's form, which would send.
            event.stopPropagation();
            const at = customTime(date, time);
            if (!at || at.getTime() <= Date.now()) return setRefusal("Pick a time in the future.");
            if (at > latestSendTime(new Date())) return setRefusal(`Pick a time in the next ${SCHEDULE_AHEAD_DAYS} days.`);
            onPick(at);
          }}
        >
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <label htmlFor={ids.date} className="flex flex-col gap-1 text-[13px] font-semibold">
              Date
              <input
                ref={dateField}
                id={ids.date}
                type="date"
                required
                value={date}
                min={dateValue(now)}
                max={dateValue(latestSendTime(now))}
                onChange={(event) => setDate(event.target.value)}
                className={field}
              />
            </label>
            <label htmlFor={ids.time} className="flex flex-col gap-1 text-[13px] font-semibold">
              Time
              <input id={ids.time} type="time" required value={time} onChange={(event) => setTime(event.target.value)} className={field} />
            </label>
          </div>
          {refusal && (
            <p role="alert" className="mt-2 text-[13px] text-negative">
              {refusal}
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2 max-md:flex-col-reverse max-md:flex-nowrap max-md:*:min-h-12 max-md:*:w-full">
            <button type="button" onClick={onClose} className={OTHER_ACTION}>
              Cancel
            </button>
            <button type="submit" className={MAIN_ACTION}>
              {action}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
