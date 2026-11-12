import { useSyncExternalStore } from "react";

/** A sheet's gutters, 16px on each side, which the picker's own 8px are half of. */
const SHEET_GUTTERS = 32;

function subscribeToResizes(resized: () => void) {
  window.addEventListener("resize", resized);
  return () => window.removeEventListener("resize", resized);
}

/**
 * How many 44px emoji a row of the picker holds in a sheet as wide as the screen, or `maxWidth` where the
 * sheet stops, within its gutters, as the screen turns.
 */
export function useSheetColumns(maxWidth = Infinity): number {
  return useSyncExternalStore(subscribeToResizes, () => Math.max(1, Math.floor((Math.min(window.innerWidth, maxWidth) - SHEET_GUTTERS) / 44)));
}
