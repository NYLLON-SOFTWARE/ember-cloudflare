import { useEffect, useState, type ReactNode } from "react";

// The pages few visits need, and the dialogs and panels few visits open, which load together in a chunk of
// their own (pages.ts), apart from the rest of the app: once the rooms have, while the browser is idle, or as
// one of them is first wanted, whichever comes first.

export type RarePages = typeof import("./pages");

let rarePages: RarePages | undefined;
let loadingRarePages: Promise<RarePages> | undefined;

/** Loads the pages few visits need (pages.ts), once, answering them. */
export function loadRarePages(): Promise<RarePages> {
  loadingRarePages ??= import("./pages").then(
    (pages) => (rarePages = pages),
    (error: unknown) => {
      // The next page that needs them tries again.
      loadingRarePages = undefined;
      throw error;
    },
  );
  return loadingRarePages;
}

/** They, if they've loaded. */
export const peekRarePages = () => rarePages;

/** Starts loading them, as hovering or focusing what opens one does, so they're there by the time it's clicked. */
export const preloadRarePages = () => void loadRarePages().catch(() => {});

interface RarePageProps {
  show: (pages: RarePages) => ReactNode;
  loading: ReactNode;
  /** Hears why they didn't load, if they didn't: left out where nothing need be said, as for a dialog that simply doesn't open. */
  onFailed?: (error: unknown) => void;
}

/**
 * What `show` makes of the pages few visits need, once they've loaded, and `loading` until then. They aren't
 * `lazy` components, each of which shows its fallback the first time it shows, however long ago its code
 * loaded, and React then keeps showing that for 300 ms.
 */
export function RarePage({ show, loading, onFailed }: RarePageProps) {
  const [pages, setPages] = useState(rarePages);
  useEffect(() => {
    if (pages) return;
    let current = true;
    loadRarePages().then(
      (loaded) => current && setPages(loaded),
      (error: unknown) => current && onFailed?.(error),
    );
    return () => {
      current = false;
    };
  }, [pages, onFailed]);
  return pages ? show(pages) : loading;
}
