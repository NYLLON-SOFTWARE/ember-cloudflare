import { useEffect, useState } from "react";
import { SEND_AT_IN_THE_PAST, type ScheduledMessage } from "@ember/protocol";
import { Clock, Trash } from "@/components/icons/iconoir";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dateTimeLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");

/** `date` as a `datetime-local` field writes it, in the reader's time zone. */
export function localInputFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The UTC instant a `datetime-local` value names in the reader's time zone, or null if it isn't one. */
export function utcIsoFromLocalInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const inAnHour = () => {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return date;
};

interface Props {
  disabled: boolean;
  scheduled: ScheduledMessage[];
  /** Whether the composer has anything to schedule. */
  canSchedule: boolean;
  /** Schedules what's written for `sendAt`, answering whether it went. */
  onSchedule: (sendAt: string) => boolean;
  onCancel: (scheduledId: string) => void;
}

const BUTTON = "flex size-8 shrink-0 cursor-pointer items-center justify-center touch:size-11";

/**
 * The composer's clock: pick a future send time in the reader's zone, see waiting messages, and
 * cancel one. Times go to the room as UTC.
 */
export function ScheduleSend({ disabled, scheduled, canSchedule, onSchedule, onCancel }: Props) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(() => localInputFromDate(inAnHour()));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setWhen(localInputFromDate(inAnHour()));
      setError(null);
    }
  }, [open]);

  const submit = () => {
    const sendAt = utcIsoFromLocalInput(when);
    if (sendAt === null) {
      setError(SEND_AT_IN_THE_PAST);
      return;
    }
    if (Date.parse(sendAt) <= Date.now()) {
      setError(SEND_AT_IN_THE_PAST);
      return;
    }
    if (!onSchedule(sendAt)) return;
    setError(null);
    setWhen(localInputFromDate(inAnHour()));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        title="Schedule send"
        aria-label="Schedule send"
        onMouseDown={(event) => event.preventDefault()}
        className={cn(BUTTON, "rounded-[7px] hover:not-active:brightness-85 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-hover")}
      >
        <Clock className="size-[18px] opacity-70" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-[320px] rounded-[12px] bg-background p-3 text-foreground shadow-md"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <p className="px-1 pb-2 text-xs font-semibold text-muted-foreground">Send later</p>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Time</span>
            <input
              type="datetime-local"
              value={when}
              min={localInputFromDate(new Date())}
              onChange={(event) => {
                setWhen(event.target.value);
                setError(null);
              }}
              className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={disabled || !canSchedule}
            onClick={submit}
            className="flex h-9 cursor-pointer items-center justify-center rounded-md bg-foreground px-3 text-sm font-medium text-background hover:not-active:brightness-70 disabled:pointer-events-none disabled:opacity-50"
          >
            Schedule
          </button>
        </div>
        {scheduled.length > 0 && (
          <ul className="mt-3 max-h-48 overflow-y-auto border-t border-border pt-2">
            {scheduled.map((item) => (
              <li key={item.id} className="flex items-start gap-2 rounded-[7px] px-1 py-1.5 hover:bg-hover">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-message-ink">{item.plainText}</p>
                  <time dateTime={item.sendAt} className="text-xs text-muted-foreground">
                    {dateTimeLabel(new Date(item.sendAt))}
                  </time>
                </div>
                <button
                  type="button"
                  aria-label="Cancel scheduled message"
                  title="Cancel"
                  onClick={() => onCancel(item.id)}
                  className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-muted-foreground hover:bg-hover hover:text-foreground touch:size-11"
                >
                  <Trash className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
