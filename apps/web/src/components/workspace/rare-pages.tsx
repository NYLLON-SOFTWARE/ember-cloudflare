import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useOptionalFlash, type Flasher } from "@/components/flash";

// The pages few visits need, and the dialogs and panels few visits open, which load together in a chunk of
// their own (pages.ts), apart from the rest of the app: once the rooms have, while the browser is idle, or as
// one of them is first wanted, whichever comes first.

export type RarePages = typeof import("./pages");

let rarePages: RarePages | undefined;
let loadingRarePages: Promise<RarePages> | undefined;

/** A failed module's address, as Chromium names it in its error; WebKit names none. */
const MODULE_ADDRESS = /https?:\/\/[^\s?#]+\.js/;

/**
 * Loads a module that may fail to load, as a chunk can when the network drops, with `load` until it fails and
 * then afresh. Some browsers keep a module that failed to load as failed until the page loads again, so asking
 * for it again fails at once: afresh is the same module at an address of its own, `?retry=` and a count,
 * where the browser named the module's address, as Chromium does, and otherwise `load` again, which, should
 * that fail too, as in WebKit, only loading the page again can mend, so `stuck` hears it.
 */
export function retryingImport<T>(load: () => Promise<T>, loadAt: (address: string) => Promise<T>, stuck: () => void): () => Promise<T> {
  let failed = false;
  let address: string | null = null;
  let retries = 0;
  const loadAgain = () =>
    load().catch((error: unknown) => {
      stuck();
      throw error;
    });
  return () => {
    const loading = !failed ? load() : address ? loadAt(`${address}?retry=${++retries}`) : loadAgain();
    return loading.catch((error: unknown) => {
      failed = true;
      address = (error instanceof Error && MODULE_ADDRESS.exec(error.message)?.[0]) || address;
      throw error;
    });
  };
}

/** Whether the pages failed to load again where only loading the page again can load them. */
let rarePagesStuck = false;

const importRarePages = retryingImport<RarePages>(
  () => import("./pages"),
  (address) => import(/* @vite-ignore */ address) as Promise<RarePages>,
  () => (rarePagesStuck = true),
);

/** What the flash says when the pages couldn't load since the browser is stuck on their failure. */
export const RELOAD_TO_LOAD = "Ember couldn’t load this. Reload to try again.";

/**
 * Says what was opened couldn't load: that Ember can't be reached, and, online, where the browser holds on to
 * the failure, offering to load the page again, which the person decides on, as it loses what's unsaved.
 */
export function flashNotLoaded(flash: Flasher | null) {
  if (rarePagesStuck && navigator.onLine) flash?.("alert", RELOAD_TO_LOAD, { label: "Reload", onClick: () => location.reload() });
  else flash?.("alert", NOT_LOADED);
}

/** Whether the pages failed to load, which only something opened, not a preload, tries again. */
let rarePagesFailed = false;

/** Loads the pages few visits need (pages.ts), once, answering them. */
export function loadRarePages(): Promise<RarePages> {
  loadingRarePages ??= importRarePages().then(
    (pages) => {
      rarePagesFailed = false;
      return (rarePages = pages);
    },
    (error: unknown) => {
      // The next page that needs them tries again.
      loadingRarePages = undefined;
      rarePagesFailed = true;
      throw error;
    },
  );
  return loadingRarePages;
}

/** They, if they've loaded. */
export const peekRarePages = () => rarePages;

/** Starts loading them, as hovering or focusing what opens one does, so they're there by the time it's clicked. */
export const preloadRarePages = () => {
  // After a failure, trying again may load the page again, which only opening something should.
  if (!rarePagesFailed) void loadRarePages().catch(() => {});
};

/** What the flash says when what was opened can't load. */
export const NOT_LOADED = "Couldn’t reach Ember. Check your connection and try again.";

/**
 * Whether what opens with `open`, and loads with the pages, is in the page: from when it first opens, and
 * then while it's shut, so it can slide away, until the pages don't load, when it's closed with `close` and
 * the flash says so, so that opening it again tries again. Answers that, and what its `RarePage` hears fail.
 */
export function useOpenedRarePage(open: boolean, close: () => void): [opened: boolean, failed: () => void] {
  const [opened, setOpened] = useState(false);
  if (open && !opened) setOpened(true);
  const flash = useOptionalFlash();
  const closing = useRef(close);
  closing.current = close;
  const failed = useCallback(() => {
    setOpened(false);
    closing.current();
    flashNotLoaded(flash);
  }, [flash]);
  return [opened, failed];
}

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
  const flash = useOptionalFlash();
  const pages = useRetryingLoad(rarePages, loadRarePages, onFailed ?? (() => flashNotLoaded(flash)));
  return pages ? show(pages) : loading;
}

/**
 * What `load` answers, starting with `loaded` if it's there already. Should it fail, `failed` hears why, and
 * the next press or key anywhere, as on what opened it, opening it again, tries again, as a page or dialog
 * that stays shown has nothing else to try again with.
 */
export function useRetryingLoad<T>(loaded: T | undefined, load: () => Promise<T>, failed: (error: unknown) => void): T | undefined {
  const [value, setValue] = useState(loaded);
  const [attempt, setAttempt] = useState(0);
  const failing = useRef(failed);
  failing.current = failed;
  useEffect(() => {
    if (value !== undefined) return;
    let current = true;
    const retry = () => setAttempt((attempt) => attempt + 1);
    const stopWaiting = () => {
      window.removeEventListener("pointerdown", retry, true);
      window.removeEventListener("keydown", retry, true);
    };
    load().then(
      (result) => current && setValue(result),
      (error: unknown) => {
        if (!current) return;
        failing.current(error);
        window.addEventListener("pointerdown", retry, { capture: true, once: true });
        window.addEventListener("keydown", retry, { capture: true, once: true });
      },
    );
    return () => {
      current = false;
      stopWaiting();
    };
  }, [value, load, attempt]);
  return value;
}
