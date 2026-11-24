import type { AppNotification } from "@ember/protocol";

// The desktop app (apps/desktop) opens a site's pages with a bridge of its own, since no push service
// reaches it, and the Badging API gives its pages no icon: a page sends it what a push would show, as the
// workspace socket brings it, and how many conversations are unread, and it calls back with the page of
// each notification the person clicks.

/** What the desktop app gives a site's pages, as its preload has it (apps/desktop/src/preload/site.cts). */
export interface DesktopApp {
  /** Shows a notification, once however many of the site's windows are sent it, by its `id`. */
  notify(notification: { id: string } & AppNotification): void;
  /** Sets how many conversations the site has unread, which the app's icon counts with its other sites'. */
  setBadge(count: number): void;
  /** Calls `open` with the page of each notification the person clicks, until the function it answers is called. */
  onOpen(open: (path: string) => void): () => void;
}

declare global {
  interface Window {
    emberDesktop?: DesktopApp;
  }
}

/** The desktop app's bridge, when the page is open in it, or null in a browser. */
export const desktopApp = (): DesktopApp | null => window.emberDesktop ?? null;
