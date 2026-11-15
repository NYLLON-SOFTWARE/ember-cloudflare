import { describe, expect, it } from "vitest";
import { keyboardInset } from "./keyboard-inset";

describe("keyboardInset", () => {
  it("is what the keyboard covers of the layout, as on iOS, and nothing where the page shrinks to fit it", () => {
    expect(keyboardInset(852, { height: 516, scale: 1 })).toBe(336);
    expect(keyboardInset(500, { height: 500, scale: 1 })).toBe(0);
  });

  it("says nothing while the page is zoomed in", () => {
    expect(keyboardInset(852, { height: 426, scale: 2 })).toBeNull();
  });
});
