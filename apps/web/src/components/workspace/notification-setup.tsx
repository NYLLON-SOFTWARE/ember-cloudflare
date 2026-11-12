import { useEffect, useRef } from "react";
import { BellOff, Xmark } from "@/components/icons/iconoir";
import { usePush } from "@/hooks/use-push";
import { cn } from "@/lib/utils";
import type { Shown } from "./notification-bell";
import { NotificationHelp } from "./notification-help";
import { HEADER_BUTTON } from "./page-header";

/**
 * The Notification setup dialog, which says why notifications aren't on, with the help for this browser
 * when the notice calls for it. It's Campfire's `.dialog`, over its gradient, with buttons styled as the
 * header's.
 */
export function NotificationSetup({ shown }: { shown: Shown | null }) {
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
          <BellOff className="size-12" />
          <span className="sr-only">Notifications alert</span>
        </span>
        <section>
          <h1 className="m-0 text-[1.4rem] font-bold">{shown?.notice.title ?? "Enable notifications"}</h1>
          <p role="status" className="my-[1em]">
            {shown?.notice.message}
          </p>
          <div hidden={!shown?.notice.help} className="mt-4 text-start">
            {shown?.notice.help && <NotificationHelp key={shown.count} platform={platform} />}
          </div>
        </section>
        <button ref={close} type="button" onClick={() => dialog.current?.close()} className={cn(HEADER_BUTTON, "absolute top-6 right-4 cursor-pointer")}>
          <span className="sr-only">Close</span>
          <Xmark className="size-[1.3em]" />
        </button>
      </div>
    </dialog>
  );
}
