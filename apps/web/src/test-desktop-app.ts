import { onTestFinished } from "vitest";
import type { DesktopApp } from "@/lib/desktop-app";

/**
 * Opens the page in the desktop app for the test, as its preload gives a site's pages its bridge, and
 * answers what the page hands the app, in order: the notifications it's to show and the badges it's to
 * set. `open` clicks a notification of the page `path`, as the app tells the page that has its window.
 */
export function inTheDesktopApp() {
  const notified: Array<Parameters<DesktopApp["notify"]>[0]> = [];
  const badges: number[] = [];
  const opening = new Set<(path: string) => void>();
  window.emberDesktop = {
    notify: (notification) => void notified.push(notification),
    setBadge: (count) => void badges.push(count),
    onOpen: (open) => {
      opening.add(open);
      return () => void opening.delete(open);
    },
  };
  onTestFinished(() => void delete window.emberDesktop);
  return { notified, badges, open: (path: string) => opening.forEach((open) => open(path)), opening };
}
