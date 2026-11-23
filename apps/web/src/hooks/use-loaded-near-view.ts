import { useEffect, useState, type RefObject } from "react";

/**
 * What `load` finds at `url`, once `element` is within 200px of the timeline's view, or null until then,
 * and where it finds nothing. It stops watching, or loading, when `element` goes.
 */
export function useLoadedNearView<Found>(element: RefObject<HTMLElement | null>, url: string, load: (url: string, signal: AbortSignal) => Promise<Found | null>): Found | null {
  const [found, setFound] = useState<Found | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void load(url, abort.signal).then((loaded) => {
          if (!abort.signal.aborted) setFound(loaded);
        });
      },
      { root: scrollerOf(element.current!), rootMargin: "200px" },
    );
    observer.observe(element.current!);
    return () => {
      observer.disconnect();
      abort.abort();
    };
  }, [element, url, load]);
  return found;
}

/** The nearest of `element`'s ancestors that scrolls, as the timeline does, or null for the page. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(ancestor).overflowY)) return ancestor;
  }
  return null;
}
