import { useContext, useEffect, useState } from "react";
import type { Message, Reminder } from "@ember/protocol";
import { Timer, Xmark } from "@/components/icons/iconoir";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DismissReminder } from "@/hooks/use-reminders";
import { fetchReminders, setReminder } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Campfire's `.btn`, as New direct message draws its buttons. */
const BUTTON = "inline-flex cursor-pointer items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-[1.1em] py-[0.5em] font-medium text-foreground";

/** The presets a reminder can be set for, each with what it says and when it is. */
const PRESETS: Array<{ label: string; at: () => Date }> = [
  { label: "In 20 minutes", at: () => new Date(Date.now() + 20 * 60 * 1000) },
  { label: "In 1 hour", at: () => new Date(Date.now() + 60 * 60 * 1000) },
  { label: "In 3 hours", at: () => new Date(Date.now() + 3 * 60 * 60 * 1000) },
  {
    label: "Tomorrow at 9:00",
    at: () => {
      const morning = new Date();
      morning.setDate(morning.getDate() + 1);
      morning.setHours(9, 0, 0, 0);
      return morning;
    },
  },
];

/** How long from now `remindAt` is, the way the pending list says it: "in 12 minutes", "due now". */
function inHowLong(remindAt: string): string {
  const seconds = Math.round((new Date(remindAt).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return "due now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return `in ${Math.max(seconds, 1)} seconds`;
  if (minutes === 1) return "in a minute";
  if (minutes < 90) return `in ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "in an hour";
  if (hours < 36) return `in ${hours} hours`;
  return `in ${Math.round(hours / 24)} days`;
}

interface Props {
  /** The message the reminder is about, which stays as it reads now, whatever happens to it after. */
  message: Message;
  onClose: () => void;
}

/**
 * The Remind me dialog, which More actions opens on a message: a time to be reminded at, the ones
 * already waiting for this message, and what went wrong if the Worker refused one. The message is kept
 * as it reads now, so it comes back whatever happens to it after.
 */
export function RemindDialog({ message, onClose }: Props) {
  const [waiting, setWaiting] = useState<Reminder[] | null>(null);
  const [picked, setPicked] = useState(0);
  const [custom, setCustom] = useState("");
  const [mistake, setMistake] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const takeBackWith = useContext(DismissReminder);

  // What's already waiting on this message, so a reminder can be taken back here as well as set.
  useEffect(() => {
    let closed = false;
    fetchReminders().then(
      (reminders) => !closed && setWaiting(reminders.filter((reminder) => reminder.messageId === message.id)),
      () => !closed && setWaiting([]),
    );
    return () => {
      closed = true;
    };
  }, [message.id]);

  const chosen = PRESETS[picked]!;
  const customTime = new Date(custom);
  // A custom time is whatever was picked; a preset is what it says from now, so it's read when the
  // reminder is asked for, not when it was drawn — a dialog left open doesn't set a stale time.
  const remindAt = picked === PRESETS.length ? (custom !== "" && !Number.isNaN(customTime.getTime()) ? customTime : null) : chosen.at();

  const ask = async () => {
    if (remindAt === null) return;
    const at = picked === PRESETS.length ? remindAt : chosen.at();
    setMistake(null);
    setAsking(true);
    try {
      await setReminder(message.roomId, message.id, at.toISOString());
      onClose();
    } catch (error) {
      setMistake(error instanceof Error ? error.message : "Ember couldn't set that. Try again.");
    } finally {
      setAsking(false);
    }
  };

  const takeBack = (id: string) => {
    void takeBackWith(id)
      .then(() => setWaiting((current) => current?.filter((reminder) => reminder.id !== id) ?? current))
      .catch(() => setMistake("Ember couldn't take that back. Try again."));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[22rem] p-5">
        <DialogTitle className="flex items-center gap-2 text-base font-medium">
          <Timer className="size-5" />
          Remind me
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          Ember brings this message back to you when you pick, whatever happens to it after.
        </DialogDescription>

        <fieldset className="mt-3">
          <legend className="sr-only">When</legend>
          <div className="flex flex-col items-stretch gap-1">
            {PRESETS.map((preset, index) => (
              <button
                key={preset.label}
                type="button"
                className={cn(
                  "cursor-pointer rounded-[9px] border px-3 py-2 text-left text-sm transition-colors duration-150",
                  picked === index ? "border-foreground bg-hover" : "bg-background hover:bg-hover",
                )}
                onClick={() => setPicked(index)}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className={cn(
                "cursor-pointer rounded-[9px] border px-3 py-2 text-left text-sm transition-colors duration-150",
                picked === PRESETS.length ? "border-foreground bg-hover" : "bg-background hover:bg-hover",
              )}
              onClick={() => setPicked(PRESETS.length)}
            >
              Pick a time…
            </button>
          </div>
          {picked === PRESETS.length && (
            <input
              type="datetime-local"
              aria-label="Time to be reminded at"
              autoFocus
              value={custom}
              onChange={(event) => setCustom(event.currentTarget.value)}
              className="mt-2 block w-full rounded-[9px] border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-selected-dark"
            />
          )}
        </fieldset>

        {mistake !== null && <p className="mt-2 text-xs text-negative">{mistake}</p>}

        {waiting !== null && waiting.length > 0 && (
          <div className="mt-3 border-t border-message-border pt-3">
            <h3 className="text-[11px] font-medium text-muted-foreground">Waiting on this message</h3>
            <ul className="mt-1 flex flex-col gap-1">
              {waiting.map((reminder) => (
                <li key={reminder.id} className="flex items-center justify-between gap-2 rounded-[9px] px-3 py-1.5 text-sm hover:bg-hover">
                  <span>{inHowLong(reminder.remindAt)}</span>
                  <button
                    type="button"
                    className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-hover hover:text-foreground touch:size-10"
                    onClick={() => takeBack(reminder.id)}
                  >
                    <Xmark className="size-4" />
                    <span className="sr-only">Take this reminder back</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" className={cn(BUTTON, "cursor-pointer touch:min-h-11")} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={cn(BUTTON, "cursor-pointer border-transparent bg-foreground text-background hover:brightness-70 touch:min-h-11", (asking || remindAt === null) && "opacity-60")}
            disabled={asking || remindAt === null}
            onClick={() => void ask()}
          >
            {asking ? "Setting…" : "Set reminder"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
