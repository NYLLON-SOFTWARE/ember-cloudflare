import { useEffect, useState } from "react";
import type { Room, UserId } from "@ember/protocol";
import { draftCountOf, DRAFTS_CHANGED } from "@/lib/draft-keys";

/**
 * How many drafts `userId` has in this browser that Drafts & sent lists, in `rooms`, those they're in
 * (`draftCountOf`), counted again as the composer keeps or forgets one in this tab, as another tab changes
 * one, as the page is shown again or regains focus, and as their rooms change. It changes only when the
 * count does, so typing re-renders nothing.
 */
export function useDraftCount(userId: UserId, rooms: readonly Room[] | null): number {
  const [count, setCount] = useState(() => draftCountOf(userId, rooms));
  useEffect(() => {
    const recount = () => setCount(draftCountOf(userId, rooms));
    recount();
    window.addEventListener(DRAFTS_CHANGED, recount);
    window.addEventListener("storage", recount);
    window.addEventListener("focus", recount);
    document.addEventListener("visibilitychange", recount);
    return () => {
      window.removeEventListener(DRAFTS_CHANGED, recount);
      window.removeEventListener("storage", recount);
      window.removeEventListener("focus", recount);
      document.removeEventListener("visibilitychange", recount);
    };
  }, [userId, rooms]);
  return count;
}
