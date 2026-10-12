import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only unmounts between tests by itself when Vitest's globals are on.
afterEach(cleanup);

// jsdom has no matchMedia. Matching nothing lays components out as they are with a mouse.
window.matchMedia = (media: string) =>
  ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
