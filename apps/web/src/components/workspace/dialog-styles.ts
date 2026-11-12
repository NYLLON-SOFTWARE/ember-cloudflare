import { cn } from "@/lib/utils";

// How the app's Radix dialogs look, as Unsaved Changes first drew one (unsaved-changes.tsx), kept apart from it so
// the dialogs in the app's script don't bring it along.

/** The dialog's buttons: Campfire's `.btn`, 42px tall, 44px for fingers, and sharing a phone's width. */
const ACTION = "inline-flex min-h-[42px] cursor-pointer items-center justify-center rounded-[9px] border px-[22px] py-[0.5em] font-semibold touch:min-h-11 disabled:cursor-default upto-480px:flex-1";
/** Save, the dialog's main action, in ink, and Discard, the other, which dialogs styled as this one share. */
export const MAIN_ACTION = cn(ACTION, "border-transparent bg-foreground text-background hover:not-active:brightness-70");
export const OTHER_ACTION = cn(ACTION, "bg-background text-foreground");

/** The dialog: 420px wide, within the screen and its safe areas, scrolling what doesn't fit them. */
export const DIALOG = cn(
  "block w-[420px] max-w-[calc(100dvw-32px-env(safe-area-inset-left)-env(safe-area-inset-right))] sm:max-w-[calc(100dvw-32px-env(safe-area-inset-left)-env(safe-area-inset-right))]",
  "max-h-[calc(100dvh-32px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto rounded-[18px] p-7 text-foreground upto-480px:p-6",
  "shadow-[0_24px_80px_var(--color-dialog-shadow),0_4px_16px_var(--color-dialog-shadow-faint)]",
);
/** What's laid over the page behind the dialog. */
export const DIALOG_BACKDROP = "bg-dialog-backdrop backdrop-blur-[3px]";
export const DIALOG_TITLE = "mb-2.5 text-[22px] leading-[1.25] font-bold";
/**
 * The button in the dialog's corner that closes it: square, 44px for fingers, and centred on the title's
 * first line, which starts at the dialog's padding and is 27.5px tall, with its centre as far in from the
 * side as the padding.
 */
export const DIALOG_CLOSE = cn(
  "absolute end-3 top-[calc(1.75rem+13.75px)] inline-flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[9px] disabled:cursor-default",
  "upto-480px:top-[calc(1.5rem+13.75px)] touch:end-1.5 touch:size-11",
);
