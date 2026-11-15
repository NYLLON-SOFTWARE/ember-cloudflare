import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ScheduledMessage } from "@ember/protocol";
import { Clock, NavArrowDown, Xmark } from "@/components/icons/iconoir";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePhoneLayout } from "@/hooks/use-phone-layout";
import type { Scheduled } from "@/hooks/use-scheduled";
import { schedulePresets, sendTimeInSentence, sendTimeLabel, shortSendTime, tomorrowMorning } from "@/lib/schedule-times";
import { cn } from "@/lib/utils";
import { SCHEDULE_HALF, TEXT_BUTTON } from "./composer-buttons";
import { PopoverMenu } from "./popover-menu";
import { RarePage } from "./rare-pages";
import { DIALOG, DIALOG_BACKDROP, DIALOG_CLOSE, DIALOG_TITLE } from "./unsaved-changes";
import { ActionSheet } from "../mobile/action-sheet";

/** Phones, which get the dialogs as sheets from the bottom of the screen, and the list as a phone's. */
const PHONE = "(width < 48rem)";

/** A dialog as a sheet from the bottom of a phone's screen, as the share warning is. */
export const SHEET =
  "max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:pb-[max(24px,env(safe-area-inset-bottom))] max-md:sm:max-w-none";

/** How long a deleted scheduled message can be brought back. */
export const UNDO_MS = 5000;

interface ScheduleMenuProps {
  disabled: boolean;
  /** Schedules what's written for `at`. */
  onSchedule: (at: Date) => void;
  /** Whether its menu is open, when something besides the chevron opens it, as a long press on Send does. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Where focus goes once the menu or Custom time closes, rather than back to what had it as the menu opened. */
  onReturnFocus?: () => void;
}

/**
 * Send's chevron, as Slack's, beside the arrow that sends now: Schedule message, which offers tomorrow and
 * Monday at 9:00 AM, and a custom time.
 */
export function ScheduleMenu({ disabled, onSchedule, open, onOpenChange, onReturnFocus }: ScheduleMenuProps) {
  const [now, setNow] = useState(() => new Date());
  const [custom, setCustom] = useState(false);
  const [openHere, setOpenHere] = useState(false);
  const shown = open ?? openHere;
  // What had focus as the menu opened: the composer's text, when the chevron, which never takes focus
  // from a pointer, or a long press on Send opened it.
  const focusedBefore = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (shown) focusedBefore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [shown]);
  const returnFocus = () => (onReturnFocus ? onReturnFocus() : focusedBefore.current?.focus());
  const timeDialog = custom && (
    <RarePage
      show={({ TimeDialog }) => (
        <TimeDialog
          title="Schedule message"
          action="Schedule message"
          initial={tomorrowMorning(new Date())}
          onClose={() => setCustom(false)}
          onReturnFocus={returnFocus}
          onPick={(at) => {
            setCustom(false);
            onSchedule(at);
          }}
        />
      )}
      loading={null}
    />
  );
  // A phone has no chevron: holding Send opens Send later as a sheet from the bottom of the screen.
  const phone = usePhoneLayout();
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
        open={shown}
        onOpenChange={(opened) => {
          if (opened) setNow(new Date());
          setOpenHere(opened);
          onOpenChange?.(opened);
        }}
        onCloseFocus={returnFocus}
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
  /** Where focus goes once the list closes: the composer's text. */
  onReturnFocus?: () => void;
  /** Writes what one that couldn't be sent says in the composer, to change and send. */
  onEdit?: (body: string) => void;
}

/** What the notice says of its messages, on one line: how many, when one goes, or why it couldn't. */
function noticeLine(messages: ListedScheduled[], now: Date, phone: boolean) {
  const [only] = messages;
  if (messages.length === 1 && only) {
    if (only.failed !== undefined) {
      return (
        <>
          <span className="text-destructive">Not sent:</span> {only.failed}
        </>
      );
    }
    return phone ? `Scheduled · ${shortSendTime(only.sendAt, now)}` : `1 scheduled message, ${sendTimeInSentence(only.sendAt, now)}`;
  }
  const failed = messages.filter((message) => message.failed !== undefined).length;
  return (
    <>
      {messages.length} scheduled messages
      {failed > 0 && <span className="text-destructive">, {failed} not sent</span>}
    </>
  );
}

/**
 * Slack's notice over the composer while you have messages scheduled here, "1 scheduled message", with
 * See all, which lists them, soonest first, each with when it goes and what it says, to send now, move to
 * another time or delete, which can be undone for a few seconds. One the room couldn't send when it was due
 * says why, to send again, write in the composer again or delete. On a phone, the list is a sheet, and
 * tapping a message offers what can be done with it.
 */
export function ScheduledNotice({ messages, scheduled, disabled, onReturnFocus, onEdit }: NoticeProps) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState<ScheduledMessage | null>(null);
  const [acting, setActing] = useState<ListedScheduled | null>(null);
  const [deleted, setDeleted] = useState<ListedScheduled | null>(null);
  const phone = useMediaQuery(PHONE);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => setDeleted(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [deleted]);
  // Focus stays in the list, on Undo, where the message's Delete was.
  useEffect(() => {
    if (deleted) list.current?.querySelector<HTMLElement>("[data-undo]")?.focus();
  }, [deleted]);

  // The deleted one keeps its place in the list while it can be brought back.
  const rows = deleted && !messages.some(({ id }) => id === deleted.id) ? [...messages, deleted].sort((a, b) => a.sendAt - b.sendAt) : messages;
  if (rows.length === 0) return null;
  const now = new Date();

  const remove = (message: ListedScheduled) => {
    if (!scheduled.remove(message.id)) return;
    if (message.failed === undefined) setDeleted(message);
  };
  const undo = (message: ListedScheduled) => {
    setDeleted(null);
    scheduled.schedule({ body: message.body, sendAt: message.sendAt, parentId: message.parentId, alsoSend: message.alsoSend });
  };
  const edit = (message: ListedScheduled) => {
    if (!scheduled.remove(message.id)) return;
    setOpen(false);
    onEdit?.(message.body);
  };
  const listAction = cn(TEXT_BUTTON, "px-2 hover:bg-hover");
  const sheetAction = "flex min-h-12 w-full cursor-pointer items-center rounded-[9px] px-3 text-start text-[17px] hover:bg-hover disabled:pointer-events-none disabled:opacity-50";
  const undoLine = (message: ListedScheduled) => (
    <>
      <span role="status">Scheduled message deleted</span>
      <button
        type="button"
        data-undo
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => undo(message)}
        className="inline-flex shrink-0 cursor-pointer items-center justify-center font-medium text-link hover:underline touch:min-h-11 touch:min-w-11"
      >
        Undo
      </button>
    </>
  );

  return (
    <div className="mb-1.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
      <Clock className="size-[15px] shrink-0" />
      {deleted ? (
        undoLine(deleted)
      ) : (
        <>
          <span className="truncate" role="status">
            {noticeLine(messages, now, phone)}
          </span>
          <button
            type="button"
            // Keeps focus in the composer, so one tap opens the list in WebKit, as Send keeps it.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => setOpen(true)}
            className="inline-flex shrink-0 cursor-pointer items-center justify-center text-link hover:underline touch:min-h-11 touch:min-w-11"
          >
            See all
          </button>
        </>
      )}
      <Dialog open={open && moving === null} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          overlayClassName={DIALOG_BACKDROP}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            // On the first message's Edit time, or Edit, rather than Send now, so Enter can't send it.
            const first = list.current?.querySelector("li");
            (first?.querySelector<HTMLElement>("button[data-first]") ?? first?.querySelector<HTMLElement>("button"))?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (!onReturnFocus || moving !== null) return;
            event.preventDefault();
            onReturnFocus();
          }}
          className={cn(DIALOG, SHEET, "w-[520px]")}
        >
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className={DIALOG_CLOSE}>
            <Xmark className="size-[18px]" />
          </button>
          <DialogTitle className={cn(DIALOG_TITLE, "mb-1 pe-10")}>Scheduled messages</DialogTitle>
          <ul ref={list} className="flex flex-col divide-y">
            {rows.map((message) => (
              <li key={message.id} className="py-3 last:pb-0 max-md:py-1">
                {message.id === deleted?.id ? (
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
                        <button type="button" disabled={disabled} data-first onClick={() => setMoving(message)} className={listAction}>
                          Edit time
                        </button>
                      ) : (
                        onEdit && (
                          <button type="button" disabled={disabled} data-first onClick={() => edit(message)} className={listAction}>
                            Edit
                          </button>
                        )
                      )}
                      <button type="button" disabled={disabled} onClick={() => remove(message)} className={cn(listAction, "text-negative")}>
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          {acting && (
            <Dialog open onOpenChange={(opened) => opened || setActing(null)}>
              <DialogContent showCloseButton={false} aria-describedby={undefined} overlayClassName="bg-transparent" className={cn(DIALOG, SHEET, "p-3")}>
                <DialogTitle className="line-clamp-2 px-3 pt-2 pb-1 text-[15px] font-normal wrap-anywhere text-muted-foreground">{acting.text}</DialogTitle>
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => {
                      setActing(null);
                      scheduled.sendNow(acting.id);
                    }}
                    className={sheetAction}
                  >
                    Send now
                  </button>
                  {acting.failed === undefined ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActing(null);
                        setMoving(acting);
                      }}
                      className={sheetAction}
                    >
                      Edit time
                    </button>
                  ) : (
                    onEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          setActing(null);
                          edit(acting);
                        }}
                        className={sheetAction}
                      >
                        Edit
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setActing(null);
                      remove(acting);
                    }}
                    className={cn(sheetAction, "text-destructive")}
                  >
                    Delete
                  </button>
                  <button type="button" onClick={() => setActing(null)} className={cn(sheetAction, "font-semibold")}>
                    Cancel
                  </button>
                </div>
              </DialogContent>
            </Dialog>
          )}
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

/** When a listed message goes, or that it didn't, and why. */
function whenLine(message: ScheduledMessage, now: Date) {
  if (message.failed === undefined) return sendTimeLabel(message.sendAt, now);
  return (
    <>
      <span className="text-destructive">Not sent:</span> {message.failed}
    </>
  );
}
