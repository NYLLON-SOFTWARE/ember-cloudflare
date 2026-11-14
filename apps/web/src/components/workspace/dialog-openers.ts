import type { MouseEvent } from "react";

// What opens a dialog and takes focus back from it, kept apart from the dialogs, which load with the pages few
// visits need (pages.ts), so the rail and the sidebar don't bring them into the app's script.

/**
 * A link's click that opens New direct message in place: a plain click on the rail's DMs and the
 * sidebar's New direct message, leaving one with a modifier key to follow the link to
 * `/rooms/directs/new`, as into a new tab.
 */
export function opensNewDirect(open: (opener: HTMLElement) => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open(event.currentTarget);
  };
}

/**
 * Puts focus back on what opened a dialog, or, when that's gone with the drawer it was in, on the
 * drawer's toggle.
 */
export function returnFocus(opener: HTMLElement | null) {
  opener?.focus({ preventScroll: true });
  if (opener && document.activeElement === opener) return;
  document.querySelector<HTMLElement>("[data-ember-sidebar-toggle]")?.focus({ preventScroll: true });
}
