import type { Reminder } from "@ember/protocol";
import { Timer, Xmark } from "@/components/icons/iconoir";
import { cn } from "@/lib/utils";

interface Props {
  reminder: Reminder;
  /** The room the message is in, by name, or null where it isn't theirs any more or it's a DM. */
  roomName: string | null;
  /** Opens the message the reminder is of. */
  onOpen: () => void;
  /** Dismisses the reminder, which takes it away for good. */
  onDone: () => void;
}

/**
 * A reminder that has come due, in the corner of the page: what the message read when it was set, whose
 * it was and where it lives, with Open to go there and Done to be done with it. It's the in-app half of
 * the delivery; the push, when the person wasn't near Ember, says the same.
 */
export function ReminderNotice({ reminder, roomName, onOpen, onDone }: Props) {
  return (
    <div
      role="alert"
      className={cn(
        "fixed bottom-3 z-30 flex w-max max-w-[calc(100dvw-24px)] items-stretch gap-3 rounded-[11px] border bg-background p-3 shadow-[0_8px_24px_#0000001a]",
        "right-3 max-md:inset-x-3 max-md:w-auto",
      )}
    >
      <div className="grid size-9 shrink-0 place-items-center rounded-full bg-hover">
        <Timer className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] leading-normal font-medium text-muted-foreground">Reminder</p>
        <p className="mt-0.5 text-sm text-message-ink">
          {reminder.creator.name}
          {roomName === null ? "" : ` in ${roomName}`}
        </p>
        {reminder.excerpt !== "" && <p className="mt-0.5 line-clamp-2 text-sm text-message-muted">{reminder.excerpt}</p>}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="cursor-pointer rounded-[9px] border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover touch:min-h-11"
            onClick={onOpen}
          >
            Open
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-[9px] px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-hover hover:text-foreground touch:min-h-11"
            onClick={onDone}
          >
            Done
          </button>
        </div>
      </div>
      <button
        type="button"
        className="grid size-7 shrink-0 cursor-pointer place-items-center self-start rounded-[6px] text-muted-foreground hover:bg-hover hover:text-foreground touch:size-10"
        onClick={onDone}
      >
        <Xmark className="size-4" />
        <span className="sr-only">Dismiss this reminder</span>
      </button>
    </div>
  );
}
