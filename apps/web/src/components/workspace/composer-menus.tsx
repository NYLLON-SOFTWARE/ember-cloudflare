import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, AtSign, CheckCircle, Emoji, Laptop, Page, Plus } from "@/components/icons/iconoir";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePhoneLayout } from "@/hooks/use-phone-layout";
import { cn } from "@/lib/utils";
import { ATTACH_BUTTON, ICON_BUTTON, SEND_HALF } from "./composer-buttons";
import { PopoverMenu } from "./popover-menu";
import { ScheduleMenu } from "./schedule-send";
import { preloadRarePages, RarePage, useOpenedRarePage } from "./rare-pages";

// The buttons of the composer's bottom row, each a piece of its own, so a layout can place them as it
// needs: +, Aa, Emoji, @ and Send with its schedule menu. Each keeps focus in the text, so a phone's
// keyboard stays up, and is a fingertip's 44px on touch screens.

/** +, Slack's attach menu: Upload from your computer, which opens the browser's file picker, and Files in Ember. */
export function AttachMenu({ disabled, onUpload, onFilesInEmber, onReturnFocus }: { disabled: boolean; onUpload: () => void; onFilesInEmber: () => void; onReturnFocus: () => void }) {
  return (
    <PopoverMenu
      label="Attach"
      className="min-w-60"
      onCloseFocus={onReturnFocus}
      trigger={
        <button type="button" disabled={disabled} title="Attach" onMouseDown={(event) => event.preventDefault()} className={ATTACH_BUTTON}>
          <Plus className="size-[18px]" />
          <span className="sr-only">Attach</span>
        </button>
      }
      items={[
        { label: "Upload from your computer", icon: <Laptop />, onSelect: onUpload },
        { label: "Files in Ember", icon: <Page />, onSelect: onFilesInEmber },
      ]}
    />
  );
}

// The picker and its emoji, which come with the pages few visits need, loaded while the browser is idle, or as
// it first opens. A chunk of their own would split the app's script (see oneAppScript in vite.config.ts).
const EmojiPicker = lazy(async () => ({ default: (await import("./pages")).EmojiPicker }));

/** The sheet's gutters, 16px on each side, which the picker's own 8px are half of. */
const SHEET_GUTTERS = 32;

/** How many 44px emoji a row of the phone's sheet holds, within its gutters. */
const sheetColumns = () => Math.max(1, Math.floor((window.innerWidth - SHEET_GUTTERS) / 44));

function subscribeToResizes(resized: () => void) {
  window.addEventListener("resize", resized);
  return () => window.removeEventListener("resize", resized);
}

/**
 * Emoji, which opens the emoji picker to write one at the cursor: a popover, or on phones a sheet from the
 * bottom of the screen, as wide as the screen allows, which leaves the keyboard down until the search is tapped.
 */
export function EmojiButton({ disabled = false, onPick, onReturnFocus }: { disabled?: boolean; onPick: (emoji: string) => void; onReturnFocus: () => void }) {
  const [open, setOpen] = useState(false);
  const phone = usePhoneLayout();
  const columns = useSyncExternalStore(subscribeToResizes, sheetColumns);
  const [sheetOpened, sheetFailed] = useOpenedRarePage(phone && open, () => setOpen(false));
  const button = (
    <button type="button" disabled={disabled} title="Emoji" onMouseDown={(event) => event.preventDefault()} className={ICON_BUTTON}>
      <Emoji className="size-[18px]" />
      <span className="sr-only">Emoji</span>
    </button>
  );
  const returnFocus = (event: Event) => {
    event.preventDefault();
    onReturnFocus();
  };
  const picker = (props: { columns?: number; autoFocus?: boolean; className?: string }) => (
    <Suspense fallback={<div className={props.className ?? "h-[22rem] w-[19rem] touch:w-[23rem]"} />}>
      <EmojiPicker
        {...props}
        onPick={(emoji) => {
          setOpen(false);
          onPick(emoji);
        }}
        onClose={() => setOpen(false)}
      />
    </Suspense>
  );

  if (phone) {
    return (
      <>
        <button
          type="button"
          disabled={disabled}
          title="Emoji"
          aria-haspopup="dialog"
          aria-expanded={open}
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={preloadRarePages}
          onClick={() => setOpen(true)}
          className={ICON_BUTTON}
        >
          <Emoji className="size-[18px]" />
          <span className="sr-only">Emoji</span>
        </button>
        {/* The sheet loads with the pages, as the picker does. */}
        {sheetOpened && (
          <RarePage
            show={({ EmojiSheet }) => <EmojiSheet open={open} onOpenChange={setOpen} onCloseAutoFocus={returnFocus} picker={picker({ columns, autoFocus: false, className: "h-[min(22rem,calc(100dvh-4rem))] w-full" })} />}
            loading={null}
            onFailed={sheetFailed}
          />
        )}
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-auto max-w-[calc(100vw-1rem)] p-0" onCloseAutoFocus={returnFocus}>
        {picker({})}
      </PopoverContent>
    </Popover>
  );
}

/** Aa, which shows and hides the formatting toolbar, as Slack's does. */
export function FormattingToggle({ disabled = false, shown, onToggle }: { disabled?: boolean; shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={shown ? "Hide formatting" : "Show formatting"}
      aria-pressed={shown}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
      className={cn(ICON_BUTTON, "text-[15px] leading-none font-semibold underline underline-offset-2")}
    >
      <span aria-hidden="true">Aa</span>
      <span className="sr-only">Formatting</span>
    </button>
  );
}

/** @, which writes an @ at the cursor, opening the list of people to mention. */
export function MentionButton({ disabled = false, onMention }: { disabled?: boolean; onMention: () => void }) {
  return (
    <button type="button" disabled={disabled} title="Mention someone" onMouseDown={(event) => event.preventDefault()} onClick={onMention} className={ICON_BUTTON}>
      <AtSign className="size-[18px]" />
      <span className="sr-only">Mention someone</span>
    </button>
  );
}

/** How long Send is held to open Schedule message instead of sending, as a long press on a phone does. */
export const LONG_PRESS_MS = 500;

interface SendButtonProps {
  disabled: boolean;
  /** Whether there's nothing to send, which mutes both halves. */
  empty?: boolean;
  /** Whether there's nothing to schedule: nothing written, or files picked, which go at once. */
  cannotSchedule: boolean;
  /** Schedules what's written for `at`. */
  onSchedule: (at: Date) => void;
  /** Whether it saves a message being edited, which it says, with a check, rather than send. */
  saves?: boolean;
}

/**
 * Send, as Slack's: the arrow, which submits the composer's form, and the chevron beside it, which opens
 * Schedule message. Holding the arrow down opens Schedule message too, rather than sending, and keeps the
 * phone's own long-press menu away.
 */
export function SendButton({ disabled, empty = false, cannotSchedule, onSchedule, saves = false }: SendButtonProps) {
  const [scheduling, setScheduling] = useState(false);
  // A phone's Send is one circle, which holding opens Send later, as Slack's does.
  const phone = usePhoneLayout();
  const holdToSchedule = () => {
    pressedLong.current = true;
    navigator.vibrate?.(10);
    setScheduling(true);
  };
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Whether the press that's ending was long, so its click doesn't send too.
  const pressedLong = useRef(false);
  const stopTimer = () => clearTimeout(timer.current);
  useEffect(() => stopTimer, []);
  return (
    <div data-empty={empty || undefined} data-sendable={(!empty && !disabled) || undefined} className={cn("group/send ml-auto flex shrink-0 items-center overflow-hidden rounded-[8px]", phone && "overflow-visible rounded-full")}>
      <button
        type="submit"
        disabled={disabled}
        title={saves ? "Save" : "Send message"}
        // Keep focus in the editor, so a phone's keyboard stays up between messages.
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          pressedLong.current = false;
          if (cannotSchedule || event.button !== 0) return;
          timer.current = setTimeout(holdToSchedule, LONG_PRESS_MS);
        }}
        onPointerUp={stopTimer}
        onPointerLeave={stopTimer}
        onPointerCancel={stopTimer}
        // A phone's own long-press, where it comes before the timer, opens Send later too.
        onContextMenu={(event) => {
          event.preventDefault();
          if (phone && !cannotSchedule && !scheduling) holdToSchedule();
        }}
        onClick={(event) => {
          if (!pressedLong.current) return;
          pressedLong.current = false;
          event.preventDefault();
        }}
        className={cn(SEND_HALF, "w-9 touch:w-11", phone && "rounded-full active:brightness-75")}
      >
        {saves ? <CheckCircle className="size-[18px]" /> : <ArrowUp className="size-[18px]" />}
        <span className="sr-only">{saves ? "Save" : "Send Message"}</span>
      </button>
      {!phone && <span aria-hidden="true" className="h-8 w-px bg-background/30 group-data-empty/send:bg-border touch:h-11" />}
      <ScheduleMenu disabled={disabled || cannotSchedule} onSchedule={onSchedule} open={scheduling} onOpenChange={setScheduling} />
    </div>
  );
}
