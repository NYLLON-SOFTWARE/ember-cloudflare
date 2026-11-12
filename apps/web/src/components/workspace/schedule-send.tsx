import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ScheduledMessage } from "@ember/protocol";
import { Clock, NavArrowDown } from "@/components/icons/iconoir";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePhoneLayout } from "@/hooks/use-phone-layout";
import type { Scheduled } from "@/hooks/use-scheduled";
import { schedulePresets, sendTimeInSentence, shortSendTime, tomorrowMorning } from "@/lib/schedule-times";
import { SCHEDULE_HALF } from "./composer-buttons";
import { PopoverMenu } from "./popover-menu";
import { RarePage, useOpenedRarePage } from "./rare-pages";
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
  const [deleted, setDeleted] = useState<ListedScheduled | null>(null);
  const phone = useMediaQuery(PHONE);
  const list = useRef<HTMLUListElement>(null);
  // The list loads with the pages the first time it opens, and stays to close as a dialog does.
  const [listed, listFailed] = useOpenedRarePage(open, () => setOpen(false));
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
      {listed && (
        <RarePage
          show={({ ScheduledList }) => (
            <ScheduledList
              open={open && moving === null}
              onOpenChange={setOpen}
              moving={moving !== null}
              onMove={setMoving}
              list={list}
              rows={rows}
              deletedId={deleted?.id}
              undoLine={undoLine}
              now={now}
              phone={phone}
              disabled={disabled}
              scheduled={scheduled}
              onEdit={onEdit && edit}
              onRemove={remove}
              onReturnFocus={onReturnFocus}
            />
          )}
          loading={null}
          onFailed={listFailed}
        />
      )}
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
