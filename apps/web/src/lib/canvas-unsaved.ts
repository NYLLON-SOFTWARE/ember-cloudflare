// What a canvas had unsaved as its page went, which this browser keeps until the canvas next opens
// (canvas-editor.tsx), or until it turns out to have been deleted.

/**
 * What a canvas had unsaved as its page went, which this browser keeps until the canvas next opens, in
 * case the room never had it: what it was written over, and what was written.
 */
export interface Unsaved {
  base: string;
  body: string;
  /** The version `base` is, which a save sent as the page went went over. */
  version: number;
  /** Whether the page could send that save, being online: one that went needn't be merged in again. */
  sent: boolean;
}

const unsavedKey = (tabId: string) => `ember:canvas-unsaved:${tabId}`;

export function keepUnsaved(tabId: string, unsaved: Unsaved): void {
  try {
    localStorage.setItem(unsavedKey(tabId), JSON.stringify(unsaved));
  } catch {
    // Kept nowhere, as in a private window: the save sent as the page went is all there is.
  }
}

/** What canvas `tabId` had unsaved as its page last went, taken out of what the browser keeps. */
export function takeUnsaved(tabId: string): Unsaved | null {
  try {
    const kept = localStorage.getItem(unsavedKey(tabId));
    localStorage.removeItem(unsavedKey(tabId));
    const unsaved = kept === null ? null : (JSON.parse(kept) as Partial<Unsaved> | null);
    if (typeof unsaved?.base !== "string" || typeof unsaved.body !== "string") return null;
    // One kept before the version was, as if never sent.
    return { base: unsaved.base, body: unsaved.body, version: typeof unsaved.version === "number" ? unsaved.version : -1, sent: unsaved.sent === true };
  } catch {
    return null;
  }
}

/**
 * Settles what canvas `tabId` kept as its page went once the save sent then is answered, if the page is still
 * there to hear: one that saved it leaves nothing to keep, and one refused leaves it to merge in.
 */
export function settleUnsaved(tabId: string, saved: boolean): void {
  if (saved) return forgetUnsaved(tabId);
  const kept = takeUnsaved(tabId);
  if (kept) keepUnsaved(tabId, { ...kept, sent: false });
}

/** Forgets what canvas `tabId` had unsaved, as it's been deleted. */
export function forgetUnsaved(tabId: string): void {
  try {
    localStorage.removeItem(unsavedKey(tabId));
  } catch {
    // Nothing was kept.
  }
}
