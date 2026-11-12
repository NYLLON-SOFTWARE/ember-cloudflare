import { useEffect, useMemo, useState } from "react";
import type { UserId } from "@ember/protocol";
import { draftCountOf } from "@/lib/draft-keys";
import { useVisit } from "./use-route";

/**
 * How many drafts `userId` has in this browser, for Drafts & sent to count: counted again whenever the
 * app goes to a page, as leaving a room keeps what was written there, and whenever another tab changes one.
 */
export function useDraftCount(userId: UserId): number {
  const visit = useVisit();
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    const changed = () => setChanges((changes) => changes + 1);
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  // Counted again on every visit and change, which storage itself doesn't tell of.
  return useMemo(() => draftCountOf(userId), [userId, visit, changes]);
}
