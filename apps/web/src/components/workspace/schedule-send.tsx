import { useState } from "react";
import type { ScheduledMessage } from "@ember/protocol";
import { Clock, NavArrowDown, Xmark } from "@/components/icons/iconoir";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { usePhoneLayout } from "@/hooks/use-phone-layout";
import type { Scheduled } from "@/hooks/use-scheduled";
import { schedulePresets, sendTimeLabel, tomorrowMorning } from "@/lib/schedule-times";
import { cn } from "@/lib/utils";
import { ActionSheet } from "../mobile/action-sheet";
import { SCHEDULE_HALF } from "./composer-buttons";
import { PopoverMenu } from "./popover-menu";
import { RarePage } from "./rare-pages";
import { DIALOG, DIALOG_BACKDROP, DIALOG_CLOSE, DIALOG_TITLE } from "./unsaved-changes";

interface ScheduleMenuProps {
  disabled: boolean;
  /** Schedules what's written for `at`. */
  onSchedule: (at: Date) => void;
  /** Whether its menu is open, when something besides the chevron opens it, as a long press on Send does. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Send's chevron, as Slack's, beside the arrow that sends now: Schedule message, which offers tomorrow and
 * Monday at 9:00 AM, and a custom time. A phone has no chevron: holding Send opens Send later, a sheet
 * from the bottom of the screen with the same.
 */
export function ScheduleMenu({ disabled, onSchedule, open, onOpenChange }: ScheduleMenuProps) {
  const [now, setNow] = useState(() => new Date());
  const [custom, setCustom] = useState(false);
  // A phone has no chevron: holding Send opens Send later as a sheet from the bottom of the screen.
  const phone = usePhoneLayout();
  const timeDialog = custom && (
    <RarePage
      show={({ TimeDialog }) => (
        <TimeDialog
          title="Schedule message"
          action="Schedule message"
          initial={tomorrowMorning(new Date())}
          onClose={() => setCustom(false)}
          onPick={(at) => {
            setCustom(false);
            onSchedule(at);
          }}
        />
      )}
      loading={null}
    />
  );
  if (phone)
    return (
      <>
        <ActionSheet
          open={(open ?? false) && !disabled}
          onOpenChange={(opened) => onOpenChange?.(opened)}
          title="Send later"
          description="Schedule this message"
          actions={schedulePresets(new Date()).map(({ label, at }) => ({ label, icon: <Clock className="size-5" />, onSelect: () => onSchedule(at) }))}
          more={[{ label: "Custom time", onSelect: () => setCustom(true) }]}
        />
        {timeDialog}
      </>
    );
  return (
    <>
      <PopoverMenu
        label="Schedule message"
        heading
        align="end"
        className="min-w-56"
        open={open}
        onOpenChange={(opened) => {
          if (opened) setNow(new Date());
          onOpenChange?.(opened);
        }}
        trigger={
          <button type="button" disabled={disabled} title="Schedule for later" onMouseDown={(event) => event.preventDefault()} className={SCHEDULE_HALF}>
            <NavArrowDown className="size-3.5" />
            <span className="sr-only">Schedule for later</span>
          </button>
        }
        items={schedulePresets(now).map(({ label, at }) => ({ label, onSelect: () => onSchedule(at) }))}
        more={[{ label: "Custom time", onSelect: () => setCustom(true) }]}
      />
      {timeDialog}
    </>
  );
}

/** A scheduled message as the notice lists it, with its plain text, which the composer reads from its body. */
export interface ListedScheduled extends ScheduledMessage {
  text: string;
}

interface NoticeProps {
  /** The scheduled messages this composer shows: the room's, or one thread's. */
  messages: ListedScheduled[];
  scheduled: Scheduled;
  disabled: boolean;
}

/**
 * Slack's notice over the composer while you have messages scheduled here, "1 scheduled message", with
 * See all, which lists them, soonest first, each with when it goes and what it says, to send now, move to
 * another time or delete.
 */
export function ScheduledNotice({ messages, scheduled, disabled }: NoticeProps) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState<ScheduledMessage | null>(null);
  if (messages.length === 0) return null;
  const now = new Date();
  const count = messages.length === 1 ? "1 scheduled message" : `${messages.length} scheduled messages`;
  const listAction = "cursor-pointer rounded-[6px] px-2 py-1 text-[13px] font-medium hover:bg-hover touch:min-h-11 disabled:pointer-events-none disabled:opacity-50";
  return (
    <div className="mb-1.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
      <Clock className="size-[15px] shrink-0" />
      <span className="truncate" role="status">
        {messages.length === 1 ? `${count}, ${sendTimeLabel(messages[0]!.sendAt, now).replace(/^./, (first) => first.toLowerCase())}` : count}
      </span>
      <button type="button" onClick={() => setOpen(true)} className="shrink-0 cursor-pointer text-link hover:underline touch:min-h-11">
        See all
      </button>
      <Dialog open={open && moving === null} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} overlayClassName={DIALOG_BACKDROP} className={cn(DIALOG, "w-[520px]")}>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className={DIALOG_CLOSE}>
            <Xmark className="size-[18px]" />
          </button>
          <DialogTitle className={cn(DIALOG_TITLE, "pe-10")}>Scheduled messages</DialogTitle>
          <DialogDescription className="mb-3 text-sm text-muted-foreground">Each is sent as you at its time, even if Ember isn't open then.</DialogDescription>
          <ul className="flex flex-col divide-y">
            {messages.map((message) => (
              <li key={message.id} className="py-3">
                <p className="text-[13px] font-semibold">{sendTimeLabel(message.sendAt, now)}</p>
                <p className="mt-0.5 line-clamp-3 text-sm wrap-anywhere whitespace-pre-wrap text-message-ink">{message.text}</p>
                <div className="mt-1.5 -ms-2 flex flex-wrap gap-1">
                  <button type="button" disabled={disabled} onClick={() => scheduled.sendNow(message.id)} className={listAction}>
                    Send now
                  </button>
                  <button type="button" disabled={disabled} onClick={() => setMoving(message)} className={listAction}>
                    Edit time
                  </button>
                  <button type="button" disabled={disabled} onClick={() => scheduled.remove(message.id)} className={cn(listAction, "text-negative")}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      {moving && (
        <RarePage
          show={({ TimeDialog }) => (
            <TimeDialog
              title="Edit time"
              action="Save"
              initial={new Date(moving.sendAt)}
              onClose={() => setMoving(null)}
              onPick={(at) => {
                scheduled.move(moving.id, at.getTime());
                setMoving(null);
              }}
            />
          )}
          loading={null}
        />
      )}
    </div>
  );
}
