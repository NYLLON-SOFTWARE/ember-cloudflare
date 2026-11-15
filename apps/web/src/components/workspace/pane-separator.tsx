import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { BIG_KEY_STEP_PX, KEY_STEP_PX } from "@/lib/pane-sizes";
import { cn } from "@/lib/utils";

// The separator between panes (split-panes.tsx), apart from them, as a thread's column beside a room has one
// too, which the app's script holds without the split layouts of the pages that load with the pages.

interface SeparatorProps {
  /** What it's called, as "Resize thread". */
  label: string;
  /** How wide the pane before it is now, and the narrowest and widest it can be, for screen readers. */
  widthPx: number;
  minPx: number;
  maxPx: number;
  /** Called with how far to move it, in pixels, rightward positive. */
  onResize: (deltaPx: number) => void;
  /** Whether the pane it sizes is the one after it, on its right, which moving it rightward narrows. */
  sizesNext?: boolean;
  className?: string;
}

/**
 * The line between two panes, which a pointer drags to share their width differently, and which takes
 * focus, for the arrow keys to move it: 16px a press, or 64px with Shift held, and Home and End as far
 * as it goes. Its grip is wider than the 1px line, for a pointer to find.
 */
export function PaneSeparator({ label, widthPx, minPx, maxPx, onResize, sizesNext = false, className }: SeparatorProps) {
  const dragging = useRef<{ x: number } | null>(null);
  const [active, setActive] = useState(false);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    dragging.current = { x: event.clientX };
    setActive(true);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const delta = event.clientX - dragging.current.x;
    if (delta === 0) return;
    dragging.current = { x: event.clientX };
    onResize(delta);
  };
  const pointerUp = () => {
    dragging.current = null;
    setActive(false);
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_KEY_STEP_PX : KEY_STEP_PX;
    const direction = sizesNext ? -1 : 1;
    const deltas: Record<string, number> = { ArrowLeft: -step, ArrowRight: step, Home: direction * (minPx - widthPx), End: direction * (maxPx - widthPx) };
    const delta = deltas[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    if (delta !== 0) onResize(delta);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(widthPx)}
      aria-valuemin={Math.round(minPx)}
      aria-valuemax={Math.round(Math.max(minPx, maxPx))}
      tabIndex={0}
      data-active={active || undefined}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onKeyDown={keyDown}
      className={cn(
        "group relative z-[1] w-px shrink-0 cursor-col-resize touch-none bg-border outline-none",
        // A grip 9px wide over the line, which shows in the accent while it's dragged or focused.
        "before:absolute before:inset-y-0 before:-left-1 before:w-[9px] before:content-['']",
        "after:absolute after:inset-y-0 after:-left-px after:w-[3px] after:bg-transparent after:transition-colors after:content-[''] hover:after:bg-ring/60 focus-visible:after:bg-ring data-active:after:bg-ring",
        className,
      )}
    />
  );
}
