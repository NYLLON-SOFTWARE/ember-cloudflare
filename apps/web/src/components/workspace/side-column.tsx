import { useLayoutEffect, useRef, useState } from "react";
import { storedWidth, storeWidth } from "@/lib/pane-sizes";
import { PaneSeparator } from "./split-panes";

// The column beside a room, from 1180px wide, where a thread or someone's profile opens, as the page's
// layout grid gives it `--side-width`, 420px until it's resized. Its separator sets that width on the grid,
// and this browser remembers it.

/** The CSS variable the page's grid sizes the column beside a room by. */
export const SIDE_WIDTH = "--side-width";

const STORAGE_KEY = "room-side";
const MIN_SIDE_PX = 300;
/** The narrowest the room keeps beside it. */
const MIN_ROOM_PX = 360;
export const DEFAULT_SIDE_PX = 420;

/** The widest the column can be in `grid`, its third column the room's, leaving the room its narrowest. */
function widestIn(grid: HTMLElement): number {
  const columns = getComputedStyle(grid)
    .gridTemplateColumns.split(" ")
    .map((column) => Number.parseFloat(column));
  const [room, side] = [columns[2], columns[3]];
  if (room === undefined || side === undefined || !Number.isFinite(room + side)) return DEFAULT_SIDE_PX;
  return Math.max(MIN_SIDE_PX, room + side - MIN_ROOM_PX);
}

/**
 * The separator at the left edge of the column beside a room, which shows from 1180px wide, where the
 * column does: it sizes the column through its grid, `element`'s parent, as dragged or moved with the
 * arrow keys, and gives it the width this browser remembers as it opens.
 */
export function SideColumnSeparator({ label }: { label: string }) {
  const handle = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => storedWidth(STORAGE_KEY) ?? DEFAULT_SIDE_PX);
  const [widest, setWidest] = useState(DEFAULT_SIDE_PX);
  const gridOf = () => handle.current?.closest("[data-side-column]")?.parentElement ?? null;

  useLayoutEffect(() => {
    const grid = gridOf();
    if (!grid) return;
    grid.style.setProperty(SIDE_WIDTH, `${width}px`);
    setWidest(widestIn(grid));
  }, [width]);

  const resize = (deltaPx: number) => {
    const grid = gridOf();
    if (!grid) return;
    // Dragging left widens the column, as it's on the right.
    const next = Math.round(Math.min(widestIn(grid), Math.max(MIN_SIDE_PX, width - deltaPx)));
    setWidth(next);
    storeWidth(STORAGE_KEY, next);
  };

  return (
    <div ref={handle} className="absolute inset-y-0 -left-px z-[2] hidden min-[1180px]:flex">
      <PaneSeparator
        label={label}
        widthPx={width}
        minPx={MIN_SIDE_PX}
        maxPx={Math.max(width, widest)}
        // The keys move the line itself: Left widens the column, as dragging it left does.
        onResize={resize}
        sizesNext
        className="bg-transparent"
      />
    </div>
  );
}
