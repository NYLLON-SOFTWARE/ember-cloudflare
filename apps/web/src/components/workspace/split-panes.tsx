import { createContext, useContext, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { BIG_KEY_STEP_PX, fitted, fittingCount, KEY_STEP_PX, moved, normalized, storedShares, storeShares, type Shares } from "@/lib/pane-sizes";
import { cn } from "@/lib/utils";

// Panes side by side, as Slack lays out a conversation beside Activity and a thread or a profile beside
// that, with a separator between each two that a pointer drags, or arrow keys move, to share their width
// differently. Each layout, by its key, remembers how it was last shared in this browser. Below the
// mobile breakpoint only the deepest pane shows, the others keeping their contents, and the layout says
// which are open, for a phone's back button to close the deepest (`onLayout`, `usePaneStack`).

/** Where only one pane shows at a time: the workspace's drawer layout, 900px wide and below. */
export const ONE_PANE = "(width < 56.3125rem)";

/** Which of a layout's panes are open, first to deepest, which of them show, and what closes the deepest. */
export interface PaneStack {
  open: string[];
  shown: string[];
  /** Closes the deepest pane, as a phone's back button does, or null when it can't be closed. */
  back: (() => void) | null;
}

/** The pane stack of the split layout around, for a back button inside it; null outside one. */
export const PaneStackContext = createContext<PaneStack | null>(null);
export const usePaneStack = () => useContext(PaneStackContext);

export interface Pane {
  /** Names the pane among its layout's, which keeps its contents as other panes come and go. */
  id: string;
  /** What the separator before it is called, as "Resize thread". */
  label: string;
  content: ReactNode;
  /** The narrowest it gets, in pixels. */
  minWidth: number;
  /** Its share of the row before it's been resized, the shares of a row's panes being in proportion. */
  defaultShare: number;
  /** Closes it, which a back button does while it's the deepest; the first pane usually has none. */
  onClose?: () => void;
}

interface Props {
  /**
   * The layout's key, for remembering its widths, such as "activity": the number of panes follows it,
   * so that two panes and three are remembered apart.
   */
  layoutKey: string;
  panes: Pane[];
  className?: string;
  /**
   * Called with how many of the first panes are hidden, which they are, keeping their contents, where
   * the row is too narrow for all of them at their minimum widths: the last ones show.
   */
  onCollapsed?: (hidden: number) => void;
  /** Called with which panes are open and shown, as they change, for a phone's back stack. */
  onLayout?: (stack: PaneStack) => void;
}

export function SplitPanes({ layoutKey, panes, className, onCollapsed, onLayout }: Props) {
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const key = `${layoutKey}-${panes.length}`;
  const minWidths = panes.map((pane) => pane.minWidth);
  const defaults = normalized(
    panes.map((pane) => pane.defaultShare),
    panes.map(() => 1 / panes.length),
  );
  const [saved, setSaved] = useState<{ key: string; shares: Shares | null }>(() => ({ key, shares: storedShares(key, panes.length) }));
  // Another number of panes is another layout, with widths of its own.
  const stored = saved.key === key ? saved.shares : storedShares(key, panes.length);
  if (saved.key !== key) setSaved({ key, shares: stored });

  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const onePane = useMediaQuery(ONE_PANE);
  const shown = onePane ? 1 : width > 0 ? fittingCount(minWidths, width) : panes.length;
  const hidden = panes.length - shown;
  useLayoutEffect(() => onCollapsed?.(hidden), [hidden, onCollapsed]);
  const deepest = panes.at(-1);
  const stack: PaneStack = { open: panes.map((pane) => pane.id), shown: panes.slice(hidden).map((pane) => pane.id), back: deepest?.onClose ?? null };
  const stackKey = `${stack.open.join()}|${stack.shown.join()}|${stack.back !== null}`;
  const latest = useRef(stack);
  latest.current = stack;
  useLayoutEffect(() => onLayout?.(latest.current), [stackKey, onLayout]);

  // The widths of the panes shown, shared as they were last, or as they start.
  const visibleMins = minWidths.slice(hidden);
  const all = stored ?? defaults;
  const visibleShares = normalized(all.slice(hidden), defaults.slice(hidden));
  const shares = width > 0 ? fitted(visibleShares, width - SEPARATORS_PX * (shown - 1), visibleMins) : visibleShares;

  const resize = (index: number, deltaPx: number) => {
    const available = width - SEPARATORS_PX * (shown - 1);
    const next = moved(shares, index, deltaPx, available, visibleMins);
    // Hidden panes keep the shares they had.
    const whole = hidden === 0 ? next : [...all.slice(0, hidden), ...next.map((share) => share * all.slice(hidden).reduce((sum, s) => sum + s, 0))];
    const merged = normalized(whole, defaults);
    setSaved({ key, shares: merged });
    storeShares(key, merged);
  };

  return (
    <PaneStackContext value={stack}>
      <div ref={row} className={cn("flex min-h-0 min-w-0", className)}>
        {panes.map((pane, index) => {
          const visible = index >= hidden;
          const share = visible ? shares[index - hidden]! : 0;
          return (
            <PaneSlot key={pane.id} visible={visible}>
              {visible && index > hidden && (
                <PaneSeparator
                  label={pane.label}
                  widthPx={shares[index - hidden - 1]! * width}
                  minPx={visibleMins[index - hidden - 1]!}
                  maxPx={(shares[index - hidden - 1]! + share) * width - visibleMins[index - hidden]!}
                  onResize={(delta) => resize(index - hidden - 1, delta)}
                />
              )}
              <div className="flex min-h-0 min-w-0 flex-col" style={{ flex: `${share} 1 0px`, minWidth: visible ? Math.min(pane.minWidth, width) : 0 }} hidden={!visible}>
                {pane.content}
              </div>
            </PaneSlot>
          );
        })}
      </div>
    </PaneStackContext>
  );
}

/** A pane and the separator before it, which hold their place in the row whether they show or not. */
function PaneSlot({ visible, children }: { visible: boolean; children: ReactNode }) {
  return <div className={cn("contents", !visible && "[&>*]:hidden")}>{children}</div>;
}

/** How wide each separator is, which the panes leave room for. */
const SEPARATORS_PX = 1;

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
