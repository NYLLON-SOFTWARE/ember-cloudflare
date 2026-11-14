import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ActivityFrame } from "@ember/protocol";
import { fetchActivity, markActivity } from "@/lib/api";
import { activityReducer, NO_ACTIVITY } from "@/lib/activity-feed";

/**
 * Your Activity, loaded as the workspace socket connects, each time it does, and kept current by what it
 * says (`heard`, which `useSidebar` calls), with ways to load older items and mark them read or unread.
 * Marks show at once, and a mark the server refuses loads Activity again, saying why.
 */
export function useActivity(onFailed: (error: unknown) => void) {
  const [feed, change] = useReducer(activityReducer, NO_ACTIVITY);
  // Each load is numbered, so an older one answering late doesn't undo a newer.
  const loads = useRef(0);
  const failed = useRef(onFailed);
  useEffect(() => {
    failed.current = onFailed;
  }, [onFailed]);

  const reload = useCallback(() => {
    const load = ++loads.current;
    fetchActivity().then(
      (page) => load === loads.current && change({ type: "loaded", page }),
      (error: unknown) => load === loads.current && failed.current(error),
    );
  }, []);

  const heard = useCallback(
    (frame: ActivityFrame | null) => {
      if (frame === null) return reload();
      if (frame.type === "activity.added") change({ type: "added", items: frame.items });
      else if (frame.type === "activity.marked") change({ type: "marked", ids: frame.ids, read: frame.read });
      else if (frame.type === "activity.removed") change({ type: "removed", ids: frame.ids });
      else if (frame.type === "activity.updated") change({ type: "updated", items: frame.items });
    },
    [reload],
  );

  const oldest = feed.items.at(-1)?.id ?? null;
  const loadingOlder = useRef(false);
  const loadOlder = useCallback(() => {
    if (oldest === null || loadingOlder.current) return;
    loadingOlder.current = true;
    fetchActivity(oldest)
      .then((page) => change({ type: "older", page }), failed.current)
      .finally(() => (loadingOlder.current = false));
  }, [oldest]);

  const mark = useCallback(
    (ids: number[], read: boolean) => {
      if (ids.length === 0) return;
      change({ type: "marked", ids, read });
      markActivity({ ids, read }).catch((error: unknown) => {
        failed.current(error);
        reload();
      });
    },
    [reload],
  );

  const markAllRead = useCallback(() => {
    change({ type: "marked", ids: null, read: true });
    markActivity({ all: true, read: true }).catch((error: unknown) => {
      failed.current(error);
      reload();
    });
  }, [reload]);

  return { feed, heard, loadOlder, mark, markAllRead };
}

export type ActivityState = ReturnType<typeof useActivity>;
