import { useCallback, useEffect, useRef, useState, type ComponentProps, type MouseEvent } from "react";
import type { Involvement } from "@ember/protocol";
import { Bell } from "@/components/icons/iconoir";
import { useFlashIfAny } from "@/components/flash";
import { usePush } from "@/hooks/use-push";
import { isSignedOut } from "@/lib/api";
import { INVOLVEMENT_LABELS } from "@/lib/involvement";
import type { PushNotice } from "@/lib/push";
import { cn } from "@/lib/utils";
import { InvolvementButton } from "./involvement-button";
import { NOT_LOADED, RarePage } from "./rare-pages";

/** A notice the dialog shows, numbered, so the same one again opens the help afresh. */
export interface Shown {
  notice: PushNotice;
  count: number;
}

/** What the bell says under itself when a press couldn't save a level. */
export const INVOLVEMENT_NOT_SAVED = "Couldn’t update notifications. Try again.";
/** How long it says what a press did. */
export const FEEDBACK_MS = 3200;

/** What the bell said last, numbered, so screen readers hear the same thing again. */
interface Feedback {
  message: string;
  /** Whether it shows at once, as for a key's press, rather than sliding in. */
  instant: boolean;
  visible: boolean;
  count: number;
}

/**
 * The bell in a room's header: your level in the room once this browser has notifications on, and until
 * then Enable notifications, which turns them on, or says why it can't in the Notification setup dialog.
 * While it's turning them on it's dimmed, as Campfire dims what's disabled (base.css), and ignores
 * presses, keeping focus, and the level's bell takes focus from it once they're on. It confirms each
 * level a press saves, or says it couldn't, under itself for a few seconds (`useFeedback`).
 */
export function NotificationBell({ className, onFailed, ...props }: ComponentProps<typeof InvolvementButton>) {
  const { on, turningOn, turnOn } = usePush();
  const [shown, setShown] = useState<Shown | null>(null);
  // Whether this bell had focus as it turned notifications on.
  const [handingOver, setHandingOver] = useState(false);
  const { feedback, show } = useFeedback();
  const flash = useFlashIfAny();
  const setupFailed = useCallback(() => flash?.("alert", NOT_LOADED), [flash]);

  const saved = (involvement: Involvement, keyboard: boolean) => show(INVOLVEMENT_LABELS[involvement], keyboard);
  // An ended session still goes to sign in.
  const failed = (error: unknown, keyboard: boolean) => (isSignedOut(error) ? onFailed(error, keyboard) : show(INVOLVEMENT_NOT_SAVED, keyboard));

  const enable = async (event: MouseEvent<HTMLButtonElement>) => {
    if (turningOn) return;
    setHandingOver(document.activeElement === event.currentTarget);
    const notice = await turnOn();
    if (!notice) return;
    setHandingOver(false);
    setShown((shown) => ({ notice, count: (shown?.count ?? 0) + 1 }));
  };

  return (
    <span className="relative inline-flex">
      {on ? (
        <InvolvementButton {...props} onSaved={saved} onFailed={failed} autoFocus={handingOver} className={className} />
      ) : (
        <>
          <button
            type="button"
            title="Enable notifications"
            aria-disabled={turningOn || undefined}
            aria-busy={turningOn || undefined}
            onClick={enable}
            className={cn("cursor-pointer [&[aria-disabled=true]:not(:hover,:active)]:brightness-75", className)}
          >
            <Bell className="size-5" />
            <span className="sr-only">Enable notifications</span>
          </button>
          {/* Loads with the pages, as few ever need it. */}
          {/* Each notice tries again, should the pages not have loaded for the last. */}
          {shown && <RarePage key={shown.count} show={({ NotificationSetup }) => <NotificationSetup shown={shown} />} loading={null} onFailed={setupFailed} />}
        </>
      )}
      {/* The tooltip, for the eye only, as the status says the same. */}
      <span
        data-notification-tooltip
        aria-hidden="true"
        className={cn(
          "pointer-events-none invisible absolute top-[calc(100%+10px)] right-0 z-30 w-max max-w-[min(280px,calc(100vw-80px))] -translate-y-[3px] rounded-[8px] bg-foreground px-3 py-[9px] text-start text-[12px] leading-[1.45] font-medium text-pretty text-background opacity-0 shadow-[0_4px_14px_var(--color-tooltip-shadow)] transition-[opacity,translate,visibility] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] before:absolute before:-top-[3px] before:right-[14px] before:size-1.5 before:rotate-45 before:bg-inherit motion-reduce:translate-none motion-reduce:transition-none",
          feedback?.visible && "visible translate-y-0 opacity-100",
          feedback?.instant && "transition-none",
        )}
      >
        {feedback?.message}
      </span>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {feedback && <span key={feedback.count}>{feedback.message}</span>}
      </span>
    </span>
  );
}

/**
 * What the bell says it did, for 3.2 seconds or until Escape, at once when a key pressed it, and sliding
 * in otherwise.
 */
function useFeedback() {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const dismiss = useCallback(() => {
    clearTimeout(timeout.current);
    setFeedback((feedback) => (feedback?.visible ? { ...feedback, visible: false } : feedback));
  }, []);
  const show = useCallback(
    (message: string, instant: boolean) => {
      clearTimeout(timeout.current);
      setFeedback((feedback) => ({ message, instant, visible: true, count: (feedback?.count ?? 0) + 1 }));
      timeout.current = setTimeout(dismiss, FEEDBACK_MS);
    },
    [dismiss],
  );

  const visible = feedback?.visible ?? false;
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, dismiss]);
  useEffect(() => () => clearTimeout(timeout.current), []);

  return { feedback, show };
}
