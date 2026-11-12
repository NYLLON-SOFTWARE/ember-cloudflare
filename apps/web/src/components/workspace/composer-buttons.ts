import { cn } from "@/lib/utils";

// How the composer's buttons look, for the composer and for its menus, which load with the editor
// (composer-menus.tsx).

/**
 * The buttons under the text: 32px, or a fingertip's 44px on touch screens. A disconnected room disables
 * them.
 */
export const BUTTON = "flex size-8 shrink-0 cursor-pointer items-center justify-center touch:size-11";

/** The bottom row's icon buttons, faint until they're hovered, or pressed, as Slack's are. */
export const ICON_BUTTON = cn(
  BUTTON,
  "rounded-[7px] text-muted-foreground hover:not-active:brightness-85 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-hover [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground aria-pressed:text-foreground disabled:opacity-50",
);

/** + , a round button on a tint, which turns into × while its menu is open. */
export const ATTACH_BUTTON = cn(BUTTON, "rounded-full bg-hover text-foreground hover:not-active:brightness-90 disabled:opacity-50 data-[state=open]:rotate-45");

/**
 * Send's two halves, as Slack's: 32px tall, or 44px on touch screens, in ink, or both muted together while
 * there's nothing to send (`data-empty` on the pair).
 */
export const SEND_HALF = cn(
  "flex h-8 shrink-0 cursor-pointer items-center justify-center bg-foreground text-background touch:h-11 hover:not-active:brightness-70 disabled:pointer-events-none disabled:opacity-50 disabled:grayscale disabled:contrast-50",
  "group-data-empty/send:bg-muted group-data-empty/send:text-muted-foreground group-data-empty/send:disabled:opacity-100 group-data-empty/send:disabled:grayscale-0 group-data-empty/send:disabled:contrast-100",
);

/** Send's chevron, which opens Schedule message. */
export const SCHEDULE_HALF = cn(SEND_HALF, "w-6 touch:w-11");
