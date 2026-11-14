import { useLayoutEffect, useRef, useState } from "react";
import { storedWidth, storeWidth } from "@/lib/pane-sizes";
import { PaneSeparator } from "./pane-separator";

// The column beside a room, from 1180px wide, where a thread or someone's profile opens, as the page's
// layout grid gives it `--side-width`, 420px until it's resized. Its separator sets that width on the grid,
// and this browser remembers it.

/** Narrower than this, the column covers the room rather than sitting beside it. */
export const COLUMN_COVERS_ROOM = "(width < 73.75rem)";

/** The CSS variable the page's grid sizes the column beside a room by. */
export const SIDE_WIDTH = "--side-width";

const STORAGE_KEY = "room-side";
const MIN_SIDE_PX = 300;
/** The narrowest the room keeps beside it, which the page's grid holds to as well. */
const MIN_ROOM_PX = 480;
export const DEFAULT_SIDE_PX = 420;

/** The room's and the column's widths in `grid`, its third and fourth columns, as laid out. */
function columnsOf(grid: HTMLElement): { room: number; side: number } | null {
  const columns = getComputedStyle(grid)
    .gridTemplateColumns.split(" ")
    .map((column) => Number.parseFloat(column));
  const [room, side] = [columns[2], columns[3]];
  return room === undefined || side === undefined || !Number.isFinite(room + side) ? null : { room, side };
}

/** The widest the column can be in `grid`, leaving the room its narrowest. */
function widestIn(grid: HTMLElement): number {
  const columns = columnsOf(grid);
  return columns ? Math.max(MIN_SIDE_PX, columns.room + columns.side - MIN_ROOM_PX) : DEFAULT_SIDE_PX;
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
    // Dragging left widens the column, as it's on the right, from the width it shows, which the grid
    // holds under the one remembered when the window is too narrow for that.
    const shown = Math.min(width, columnsOf(grid)?.side ?? width);
    const next = Math.round(Math.min(widestIn(grid), Math.max(MIN_SIDE_PX, shown - deltaPx)));
    setWidth(next);
    storeWidth(STORAGE_KEY, next);
  };

  return (
    <div ref={handle} className="absolute inset-y-0 -left-px z-[2] hidden min-[1180px]:flex">
      <PaneSeparator
        label={label}
        widthPx={Math.min(width, widest)}
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
