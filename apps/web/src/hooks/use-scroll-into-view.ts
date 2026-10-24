import { createContext, useContext, useEffect, useLayoutEffect, type RefObject } from "react";

/**
 * What the timeline does as something opens in a message to scroll itself into view, as the message's editor does:
 * it leaves the reader where they are, so that it scrolls from where it opened.
 */
export const ScrollIntoViewContext = createContext<(element: HTMLElement) => void>(() => {});

/** ember-rust's scroll-into-view controller: once it's shown, an element scrolls to the middle of the timeline. */
export function useScrollIntoView(element: RefObject<HTMLElement | null>) {
  const opened = useContext(ScrollIntoViewContext);
  useLayoutEffect(() => {
    if (element.current) opened(element.current);
  }, [opened, element]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => element.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [element]);
}
