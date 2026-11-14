import { useCallback, useRef } from "react";
import { openOverlay } from "@/hooks/use-route";
import type { PaneStack } from "../workspace/split-panes";

/**
 * Has a split layout's panes, which a phone shows one at a time, go back with the phone's Back too: each
 * pane opened past the first adds an entry to the history, which Back leaves, closing the deepest pane,
 * and closing a pane from the page goes back past its entry. Answers what the layout calls with its panes.
 */
export function usePaneHistory(): (stack: PaneStack) => void {
  // What closes each pane's entry, the second pane's first.
  const entries = useRef<Array<() => void>>([]);
  const back = useRef<(() => void) | null>(null);
  return useCallback((stack: PaneStack) => {
    back.current = stack.back;
    const depth = Math.max(0, stack.open.length - 1);
    while (entries.current.length < depth) entries.current.push(openOverlay(() => back.current?.()));
    while (entries.current.length > depth) entries.current.pop()!();
  }, []);
}
