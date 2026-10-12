import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only unmounts between tests by itself when Vitest's globals are on.
afterEach(cleanup);

// jsdom has no matchMedia, so unless a test stubs it, every media query is false: a mouse, light mode.
globalThis.matchMedia ??= (media: string) =>
  ({ media, matches: false, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
