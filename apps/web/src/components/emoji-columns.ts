import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";

/** A sheet's gutters, 16px on each side, which the picker's own 8px are half of. */
const SHEET_GUTTERS = 32;

function subscribeToResizes(resized: () => void) {
  window.addEventListener("resize", resized);
  return () => window.removeEventListener("resize", resized);
}

/**
 * How many 44px emoji a row of the picker holds in a sheet as wide as the screen, or `maxWidth` where the
 * sheet stops, within its gutters, as the screen turns: a first guess, until the picker measures its rows
 * (`useFittedColumns`).
 */
export function useSheetColumns(maxWidth = Infinity): number {
  return useSyncExternalStore(subscribeToResizes, () => Math.max(1, Math.floor((Math.min(window.innerWidth, maxWidth) - SHEET_GUTTERS) / 44)));
}

/** How many 44px emoji fit across `width`, one at least. */
const columnsAcross = (width: number) => Math.max(1, Math.floor(width / 44));

/**
 * How many 44px emoji a row holds across `rows`' content box, as it resizes, where `fit` says to measure,
 * or else `columns`, as until it's laid out. A sheet's sides grow with the screen's safe areas in landscape,
 * which the screen's width doesn't tell.
 */
export function useFittedColumns(rows: RefObject<HTMLElement | null>, columns: number, fit: boolean): number {
  const [fitted, setFitted] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = rows.current;
    if (!fit || !element) return;
    const measure = () => {
      if (element.clientWidth === 0) return;
      const { paddingLeft, paddingRight } = getComputedStyle(element);
      setFitted(columnsAcross(element.clientWidth - (parseFloat(paddingLeft) || 0) - (parseFloat(paddingRight) || 0)));
    };
    measure();
    const watching = new ResizeObserver(measure);
    watching.observe(element);
    return () => watching.disconnect();
  }, [rows, fit]);
  return fit && fitted !== null ? fitted : columns;
}
