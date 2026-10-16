import { useEffect, useRef, useState, type ComponentProps, type MouseEvent } from "react";
import { NotificationBellAlert, NotificationBellLoading, Remove } from "@/components/icons/campfire";
import { usePush } from "@/hooks/use-push";
import type { PushNotice } from "@/lib/push";
import { cn } from "@/lib/utils";
import { InvolvementButton } from "./involvement-button";
import { NotificationHelp } from "./notification-help";
import { HEADER_BUTTON } from "./page-header";

/** A notice the dialog shows, numbered, so the same one again opens the help afresh. */
interface Shown {
  notice: PushNotice;
  count: number;
}

/**
 * ember-rust's bell in a room's header (rooms/involvements/_bell.html): your level in the room once this
 * browser has notifications on, and until then Enable notifications, which turns them on, or says why it
 * can't in the Notification setup dialog. While it's turning them on it's dimmed, as Campfire dims what's
 * disabled (base.css), and ignores presses, keeping focus, where ember-rust's is disabled, and the
 * level's bell takes focus from it once they're on.
 */
export function NotificationBell({ className, ...props }: ComponentProps<typeof InvolvementButton>) {
  const { on, turningOn, turnOn } = usePush();
  const [shown, setShown] = useState<Shown | null>(null);
  // Whether this bell had focus as it turned notifications on.
  const [handingOver, setHandingOver] = useState(false);

  const enable = async (event: MouseEvent<HTMLButtonElement>) => {
    if (turningOn) return;
    setHandingOver(document.activeElement === event.currentTarget);
    const notice = await turnOn();
    if (!notice) return;
    setHandingOver(false);
    setShown((shown) => ({ notice, count: (shown?.count ?? 0) + 1 }));
  };

  if (on) return <InvolvementButton {...props} autoFocus={handingOver} className={className} />;
  return (
    <>
      <button
        type="button"
        title="Enable notifications"
        aria-disabled={turningOn || undefined}
        aria-busy={turningOn || undefined}
        onClick={enable}
        className={cn("cursor-pointer [&[aria-disabled=true]:not(:hover,:active)]:brightness-75", className)}
      >
        <NotificationBellLoading width={20} height={20} />
        <span className="sr-only">Enable notifications</span>
      </button>
      <NotificationSetup shown={shown} />
    </>
  );
}

/**
 * ember-rust's Notification setup dialog, which says why notifications aren't on, with the help for this
 * browser when the notice calls for it. It's Campfire's `.dialog`, over its gradient, and the header's
 * buttons, as ember-rust has it in the header.
 */
function NotificationSetup({ shown }: { shown: Shown | null }) {
  const { platform } = usePush();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!shown) return;
    if (!dialog.current?.open) dialog.current?.showModal();
    // As Close's `autofocus` does as the dialog opens, which React would only do as it first renders.
    close.current?.focus();
  }, [shown]);

  return (
    <dialog
      ref={dialog}
      aria-label="Notification setup"
      className="m-auto w-[50ch] max-w-[calc(100dvw-2rem)] rounded-[1em] border bg-background p-4 text-foreground shadow-[0_8px_24px_var(--color-menu-shadow)] [--inline-space:1rem] backdrop:bg-(image:--setup-backdrop) backdrop:opacity-75"
    >
      <div className="flex flex-col text-center">
        <span className="mx-auto">
          <NotificationBellAlert width={48} height={48} className="size-12" />
          <span className="sr-only">Notifications alert</span>
        </span>
        <section>
          <h1 className="m-0 text-[1.4rem] font-bold">{shown?.notice.title ?? "Enable notifications"}</h1>
          <p role="status" className="my-[1em]">
            {shown?.notice.message}
          </p>
          <div hidden={!shown?.notice.help} className="mt-4 text-start">
            <NotificationHelp key={shown?.count} platform={platform} />
          </div>
        </section>
        <button ref={close} type="button" onClick={() => dialog.current?.close()} className={cn(HEADER_BUTTON, "absolute top-6 right-4 cursor-pointer")}>
          <span className="sr-only">Close</span>
          <Remove width={20} height={20} className="w-[1.3em]" />
        </button>
      </div>
    </dialog>
  );
}
