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

export function navigate(path: string): void {
  if (location.pathname === path) return;
  history.pushState(null, "", path);
  listeners.forEach((listener) => listener());
}

/** The room id in /rooms/:id, or null. */
export function useRoomRoute(): string | null {
  const pathname = useSyncExternalStore(subscribe, () => location.pathname);
  const match = pathname.match(/^\/rooms\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}
