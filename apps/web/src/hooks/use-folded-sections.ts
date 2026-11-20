import { useCallback, useEffect, useState } from "react";
import type { SectionId } from "@ember/protocol";

// The sidebar sections this browser has folded, by id, as their arrows leave them, whoever signs in, as
// the last room is kept (`last-room.ts`). Every tab of the browser folds and unfolds them together.

export const FOLDED_SECTIONS_KEY = "ember:folded-sections";

function storedFolds(): ReadonlySet<SectionId> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(FOLDED_SECTIONS_KEY) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((id): id is SectionId => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function storeFolds(folded: ReadonlySet<SectionId>): void {
  try {
    if (folded.size > 0) localStorage.setItem(FOLDED_SECTIONS_KEY, JSON.stringify([...folded]));
    else localStorage.removeItem(FOLDED_SECTIONS_KEY);
  } catch {
    // Storage can be refused, and then sections stay folded in this tab only.
  }
}

/** The sections this browser has folded, and what folds or unfolds one, in every tab of it. */
export function useFoldedSections() {
  const [folded, setFolded] = useState(storedFolds);
  useEffect(() => {
    const heard = (event: StorageEvent) => {
      // A null key is storage cleared.
      if (event.key === FOLDED_SECTIONS_KEY || event.key === null) setFolded(storedFolds());
    };
    window.addEventListener("storage", heard);
    return () => window.removeEventListener("storage", heard);
  }, []);
  const fold = useCallback((sectionId: SectionId, folding: boolean) => {
    setFolded((folded) => {
      const next = new Set(folded);
      if (folding) next.add(sectionId);
      else next.delete(sectionId);
      // Kept the same each time it's worked out, so working it out twice keeps nothing else.
      storeFolds(next);
      return next;
    });
  }, []);
  return { folded, fold };
}
