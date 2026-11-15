import { useEffect, useState } from "react";
import type { Shortcut } from "@ember/protocol/bots";
import { fetchShortcuts } from "@/lib/api";

/**
 * The workspace's message shortcuts, as they are when the hook that offers them mounts, which More
 * actions' menu does as it opens: an open menu asks the Worker once, and one opened again asks again,
 * so it offers what the workspace has then. [] until they've come, and when they couldn't be, which the
 * menu shows as none, as it does where none are registered.
 */
export function useShortcuts(): Shortcut[] {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  useEffect(() => {
    let stopped = false;
    Promise.resolve(fetchShortcuts())
      .then((loaded) => {
        if (!stopped) setShortcuts(loaded.shortcuts);
      })
      // The menu works without them, as it does before they've come.
      .catch(() => {});
    return () => void (stopped = true);
  }, []);
  return shortcuts;
}
