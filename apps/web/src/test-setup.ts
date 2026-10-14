// First, so React sees it when it loads.
import "./test-animation-event";
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

// jsdom's dialogs can't open or close, so these do what browsers do, short of the top layer and
// moving focus.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  if (!this.open) return;
  this.open = false;
  this.dispatchEvent(new Event("close"));
};

afterEach(() => {
  // Testing Library only unmounts between tests by itself when Vitest's globals are on.
  cleanup();
  localStorage.clear();
  setPrefersDark(false);
  document.documentElement.className = "";
});
