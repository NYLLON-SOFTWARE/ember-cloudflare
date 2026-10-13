import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { installMatchMedia, setPrefersDark } from "./test-media";

// jsdom has no matchMedia, so this one says every query is false (a mouse, light mode) unless a
// test sets the color scheme or stubs it.
installMatchMedia();

// jsdom doesn't lay anything out, so nothing ever resizes or scrolls into view. The message list
// only needs to be able to start observing; its own tests say what's in view.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof IntersectionObserver;

afterEach(() => {
  // Testing Library only unmounts between tests by itself when Vitest's globals are on.
  cleanup();
  localStorage.clear();
  setPrefersDark(false);
  document.documentElement.className = "";
});
