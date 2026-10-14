import { useSyncExternalStore } from "react";

// A two-route app (/ and /rooms/:id) doesn't need a router yet.

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

/** Shows `path`, as a new entry in the browser's history unless `replace` says to take the current one's place. */
export function navigate(path: string, { replace = false } = {}): void {
  if (location.pathname === path) return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  listeners.forEach((listener) => listener());
}

/** The room id in a /rooms/:id path, or null. */
export function roomIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/rooms\/([^/]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    // A malformed escape names no room, so the workspace falls back to the first one.
    return null;
  }
}

export function useRoomRoute(): string | null {
  return roomIdFromPath(useSyncExternalStore(subscribe, () => location.pathname));
}
