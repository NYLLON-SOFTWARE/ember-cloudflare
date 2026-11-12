import { useId, useState } from "react";
import { Xmark } from "@/components/icons/iconoir";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { customTime, dateValue, timeValue } from "@/lib/schedule-times";
import { cn } from "@/lib/utils";
import { DIALOG, DIALOG_BACKDROP, DIALOG_CLOSE, DIALOG_TITLE, MAIN_ACTION, OTHER_ACTION } from "./unsaved-changes";

// Custom time, for scheduling a message or moving one, which loads with the pages few visits need (pages.ts).

interface TimeDialogProps {
  title: string;
  action: string;
  initial: Date;
  onPick: (at: Date) => void;
  onClose: () => void;
}

/** Asks for a day and a time, as Slack's Custom time does, refusing one that's passed. */
export function TimeDialog({ title, action, initial, onPick, onClose }: TimeDialogProps) {
  const [date, setDate] = useState(() => dateValue(initial));
  const [time, setTime] = useState(() => timeValue(initial));
  const [refusal, setRefusal] = useState<string | null>(null);
  const ids = { date: useId(), time: useId() };
  const field = "h-10 w-full rounded-[9px] border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-selected-dark touch:h-11 touch:text-base";
  return (
    <Dialog open onOpenChange={(open) => open || onClose()}>
      <DialogContent showCloseButton={false} overlayClassName={DIALOG_BACKDROP} className={DIALOG}>
        <button type="button" aria-label="Close" onClick={onClose} className={DIALOG_CLOSE}>
          <Xmark className="size-[18px]" />
        </button>
        <DialogTitle className={cn(DIALOG_TITLE, "pe-10")}>{title}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">It's sent as you, even if Ember isn't open then.</DialogDescription>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            // React passes it up its tree, out of the dialog's portal, to the composer's form, which would send.
            event.stopPropagation();
            const at = customTime(date, time);
            if (!at || at.getTime() <= Date.now()) return setRefusal("Pick a time in the future.");
            onPick(at);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <label htmlFor={ids.date} className="flex flex-col gap-1 text-[13px] font-semibold">
              Date
              <input id={ids.date} type="date" required value={date} min={dateValue(new Date())} onChange={(event) => setDate(event.target.value)} className={field} />
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
          <div className="mt-5 flex flex-wrap justify-end gap-2">
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
