import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowUp, AtSign, Emoji, Laptop, Page, Plus } from "@/components/icons/iconoir";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ATTACH_BUTTON, ICON_BUTTON, SEND_HALF } from "./composer-buttons";
import { PopoverMenu } from "./popover-menu";
import { ScheduleMenu } from "./schedule-send";

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

/** Emoji, which opens the emoji picker to write one at the cursor. */
export function EmojiButton({ disabled = false, onPick, onReturnFocus }: { disabled?: boolean; onPick: (emoji: string) => void; onReturnFocus: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} title="Emoji" onMouseDown={(event) => event.preventDefault()} className={ICON_BUTTON}>
          <Emoji className="size-[18px]" />
          <span className="sr-only">Emoji</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-auto max-w-[calc(100vw-1rem)] p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <Suspense fallback={<div className="h-[22rem] w-[19rem] touch:w-[23rem]" />}>
          <EmojiPicker
            onPick={(emoji) => {
              setOpen(false);
              onPick(emoji);
            }}
            onClose={() => setOpen(false)}
          />
        </Suspense>
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
}

/**
 * Send, as Slack's: the arrow, which submits the composer's form, and the chevron beside it, which opens
 * Schedule message. Holding the arrow down opens Schedule message too, rather than sending, and keeps the
 * phone's own long-press menu away.
 */
export function SendButton({ disabled, empty = false, cannotSchedule, onSchedule }: SendButtonProps) {
  const [scheduling, setScheduling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Whether the press that's ending was long, so its click doesn't send too.
  const pressedLong = useRef(false);
  const stopTimer = () => clearTimeout(timer.current);
  useEffect(() => stopTimer, []);
  return (
    <div data-empty={empty || undefined} className="group/send ml-auto flex shrink-0 items-center overflow-hidden rounded-[8px]">
      <button
        type="submit"
        disabled={disabled}
        title="Send message"
        // Keep focus in the editor, so a phone's keyboard stays up between messages.
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          pressedLong.current = false;
          if (cannotSchedule || event.button !== 0) return;
          timer.current = setTimeout(() => {
            pressedLong.current = true;
            setScheduling(true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={stopTimer}
        onPointerLeave={stopTimer}
        onPointerCancel={stopTimer}
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => {
          if (!pressedLong.current) return;
          pressedLong.current = false;
          event.preventDefault();
        }}
        className={cn(SEND_HALF, "w-9 touch:w-11")}
      >
        <ArrowUp className="size-[18px]" />
        <span className="sr-only">Send Message</span>
      </button>
      <span aria-hidden="true" className="h-8 w-px bg-background/30 group-data-empty/send:bg-border touch:h-11" />
      <ScheduleMenu disabled={disabled || cannotSchedule} onSchedule={onSchedule} open={scheduling} onOpenChange={setScheduling} />
    </div>
  );
}
