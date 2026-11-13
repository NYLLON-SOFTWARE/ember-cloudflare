import { createContext, useContext, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { fitted, fittingCount, moved, normalized, storedShares, storedWidth, storeShares, storeWidth, type Shares } from "@/lib/pane-sizes";
import { PaneSeparator } from "./pane-separator";
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
  /**
   * Its width in pixels before it's been resized, for a pane that keeps its width as others open and close
   * beside it, as Activity's feed does: the panes with none share what's left, or the last pane takes it.
   */
  width?: number;
  /** What remembers that width, so that panes that take each other's place keep one; its id otherwise. */
  widthKey?: string;
  /** Closes it, which a back button does while it's the deepest; the first pane usually has none. */
  onClose?: () => void;
  /**
   * Whether the separator before it sizes it, as a thread's or a profile's beside a conversation does,
   * rather than the pane before it, as the feed's does: what its value says, and how far Home and End go.
   */
  sizedBySeparator?: boolean;
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
  // The widths of panes that keep one, resized here since they were remembered, by what remembers them.
  const [resized, setResized] = useState<Record<string, number>>({});

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
  useLayoutEffect(() => {
    onCollapsed?.(hidden);
  }, [hidden, onCollapsed]);
  const deepest = panes.at(-1);
  const stack: PaneStack = { open: panes.map((pane) => pane.id), shown: panes.slice(hidden).map((pane) => pane.id), back: deepest?.onClose ?? null };
  const stackKey = `${stack.open.join()}|${stack.shown.join()}|${stack.back !== null}`;
  const latest = useRef(stack);
  latest.current = stack;
  useLayoutEffect(() => {
    onLayout?.(latest.current);
  }, [stackKey, onLayout]);

  // The widths of the panes shown, shared as they were last, or as they start; a pane with a width of its
  // own keeps it, as far as the row allows.
  const visiblePanes = panes.slice(hidden);
  const visibleMins = minWidths.slice(hidden);
  const all = stored ?? defaults;
  const visibleShares = normalized(all.slice(hidden), defaults.slice(hidden));
  const available = width - SEPARATORS_PX * (shown - 1);
  const widthKeyOf = (pane: Pane) => `${layoutKey}:${pane.widthKey ?? pane.id}`;
  const keepsWidth = visiblePanes.map((pane, index) => pane.width !== undefined && (index < visiblePanes.length - 1 || visiblePanes.some((other) => other.width === undefined)));
  const kept = (pane: Pane) => resized[widthKeyOf(pane)] ?? storedWidth(widthKeyOf(pane)) ?? pane.width!;
  const sharesKept = (): Shares => {
    const keptPx = visiblePanes.reduce((sum, pane, index) => sum + (keepsWidth[index] ? kept(pane) : 0), 0);
    const flexing = normalized(
      visibleShares.filter((_, index) => !keepsWidth[index]),
      visiblePanes.filter((_, index) => !keepsWidth[index]).map(() => 1),
    );
    let next = 0;
    const rest = Math.max(0, available - keptPx);
    return normalized(
      visiblePanes.map((pane, index) => (keepsWidth[index] ? kept(pane) : flexing[next++]! * rest)),
      visibleShares,
    );
  };
  const preferred = available > 0 && keepsWidth.some(Boolean) ? sharesKept() : visibleShares;
  const shares = width > 0 ? fitted(preferred, available, visibleMins) : preferred;

  const resize = (index: number, deltaPx: number) => {
    const next = moved(shares, index, deltaPx, available, visibleMins);
    // A pane with a width of its own remembers it, for every layout it's in.
    const widths = { ...resized };
    for (const at of [index, index + 1]) {
      if (!keepsWidth[at]) continue;
      const key = widthKeyOf(visiblePanes[at]!);
      widths[key] = next[at]! * available;
      storeWidth(key, widths[key]);
    }
    setResized(widths);
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
                  {...separatorRange(pane.sizedBySeparator ?? false, shares[index - hidden - 1]! * available, share * available, visibleMins[index - hidden - 1]!, pane.minWidth)}
                  onResize={(delta) => resize(index - hidden - 1, delta)}
                  sizesNext={pane.sizedBySeparator}
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

/**
 * The width a separator's value says, and how narrow and wide it goes, for the separator between panes
 * `beforePx` and `afterPx` wide, of minimum widths `beforeMin` and `afterMin`: the width of the pane
 * after it when `sizesAfter`, or else of the pane before it.
 */
function separatorRange(sizesAfter: boolean, beforePx: number, afterPx: number, beforeMin: number, afterMin: number) {
  const pair = beforePx + afterPx;
  return sizesAfter ? { widthPx: afterPx, minPx: afterMin, maxPx: pair - beforeMin } : { widthPx: beforePx, minPx: beforeMin, maxPx: pair - afterMin };
}

/** A pane and the separator before it, which hold their place in the row whether they show or not. */
function PaneSlot({ visible, children }: { visible: boolean; children: ReactNode }) {
  return <div className={cn("contents", !visible && "[&>*]:hidden")}>{children}</div>;
}

/** How wide each separator is, which the panes leave room for. */
const SEPARATORS_PX = 1;
