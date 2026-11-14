import { useEffect, useState } from "react";
import type { UserId } from "@ember/protocol";
import { draftCountOf, DRAFTS_CHANGED } from "@/lib/draft-keys";

/**
 * How many drafts `userId` has in this browser, for Drafts & sent to count, counted again as the composer
 * keeps or forgets one in this tab and as another tab changes one. It changes only when the count does,
 * so typing re-renders nothing.
 */
export function useDraftCount(userId: UserId): number {
  const [count, setCount] = useState(() => draftCountOf(userId));
  useEffect(() => {
    const recount = () => setCount(draftCountOf(userId));
    recount();
    window.addEventListener(DRAFTS_CHANGED, recount);
    window.addEventListener("storage", recount);
    return () => {
      window.removeEventListener(DRAFTS_CHANGED, recount);
      window.removeEventListener("storage", recount);
    };
  }, [userId]);
  return count;
}
