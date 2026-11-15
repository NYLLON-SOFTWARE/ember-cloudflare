import { useEffect, useState } from "react";
import type { UserId } from "@ember/protocol";
import { draftsOf } from "@/lib/drafts";

/**
 * How many drafts of `userId`'s this browser keeps. The composer writes them to storage without a word, so
 * they're counted again whenever the page could have missed one: as it's shown again or regains focus, and
 * when another tab writes one.
 */
export function useDraftCount(userId: UserId): number {
  const [count, setCount] = useState(() => draftsOf(userId).length);
  useEffect(() => {
    const recount = () => setCount(draftsOf(userId).length);
    recount();
    window.addEventListener("storage", recount);
    window.addEventListener("focus", recount);
    document.addEventListener("visibilitychange", recount);
    return () => {
      window.removeEventListener("storage", recount);
      window.removeEventListener("focus", recount);
      document.removeEventListener("visibilitychange", recount);
    };
  }, [userId]);
  return count;
}

/** A count as a card has room for: up to 99, then "99+". */
export const cappedCount = (count: number): string => (count > 99 ? "99+" : String(count));
