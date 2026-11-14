import { useEffect, useSyncExternalStore } from "react";
import type { User, UserId } from "@ember/protocol";

// Who's in the room shown now, as its socket says, for what's beside the room rather than in it, such as
// a profile pane saying someone's active. Ember knows presence only room by room, so beside no room
// nobody is known to be here.

const NOBODY: ReadonlySet<UserId> = new Set();
let shown: ReadonlySet<UserId> = NOBODY;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function show(present: ReadonlySet<UserId>) {
  shown = present;
  listeners.forEach((listener) => listener());
}

/** Has the room shown say who's in it, `present`, until it goes. */
export function useShowPresence(present: User[]): void {
  useEffect(() => {
    const ids = new Set(present.map((user) => user.id));
    show(ids);
    return () => {
      if (shown === ids) show(NOBODY);
    };
  }, [present]);
}

/** Who's in the room shown now, by id. */
export function useShownPresence(): ReadonlySet<UserId> {
  return useSyncExternalStore(subscribe, () => shown);
}
