import { useEffect } from "react";

/**
 * How much of the layout the on-screen keyboard covers, given the layout viewport's height and the
 * visual viewport the keyboard leaves: iOS lays the keyboard over the page rather than shrinking it, as
 * Chrome on Android does with `interactive-widget=resizes-content`, where this is 0. Zoomed in, the visual
 * viewport is smaller for that alone, so it says nothing, and this answers null.
 */
export function keyboardInset(layoutHeight: number, viewport: { height: number; scale: number }): number | null {
  if (Math.abs(viewport.scale - 1) > 0.01) return null;
  return Math.max(0, Math.round(layoutHeight - viewport.height));
}

/**
 * Keeps `--keyboard-inset` on the page at how much of it the on-screen keyboard covers, and marks the page
 * `data-keyboard` while it covers any, so the phone layout can end above the keyboard, with the composer
 * right on top of it and the conversation's newest messages in view (mobile.css). Renders nothing.
 */
export function KeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const measure = () => {
      const inset = keyboardInset(window.innerHeight, viewport);
      if (inset === null) return;
      root.style.setProperty("--keyboard-inset", `${inset}px`);
      root.toggleAttribute("data-keyboard", inset > 0);
      // iOS scrolls the page to bring the field into view; the layout now ends above the keyboard instead.
      if (inset > 0 && window.scrollY !== 0) window.scrollTo(0, 0);
    };
    measure();
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    return () => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
      root.style.removeProperty("--keyboard-inset");
      root.removeAttribute("data-keyboard");
    };
  }, []);
  return null;
}
