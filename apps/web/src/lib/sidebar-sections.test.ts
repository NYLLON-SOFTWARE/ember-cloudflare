import { beforeEach, describe, expect, it } from "vitest";
import { isFolded, rememberFolded } from "./sidebar-sections";

beforeEach(() => localStorage.clear());

describe("sidebar sections", () => {
  it("starts every section unfolded, and remembers each one folded until it's unfolded", () => {
    expect(isFolded("starred")).toBe(false);
    rememberFolded("starred", true);
    expect(isFolded("starred")).toBe(true);
    expect(isFolded("rooms")).toBe(false);
    rememberFolded("starred", false);
    expect(isFolded("starred")).toBe(false);
  });
});
