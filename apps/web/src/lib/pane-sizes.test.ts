import { afterEach, describe, expect, it } from "vitest";
import { fitted, fittingCount, moved, normalized, storedShares, storedWidth, storeShares, storeWidth } from "./pane-sizes";

afterEach(() => localStorage.clear());

const rounded = (shares: number[]) => shares.map((share) => Math.round(share * 1000) / 1000);

describe("normalized", () => {
  it("scales shares to add up to 1", () => {
    expect(normalized([1, 3], [0.5, 0.5])).toEqual([0.25, 0.75]);
  });

  it("falls back for shares that can't be", () => {
    expect(normalized([0, 0], [0.4, 0.6])).toEqual([0.4, 0.6]);
    expect(normalized([1, Number.NaN], [0.4, 0.6])).toEqual([0.4, 0.6]);
  });
});

describe("moved", () => {
  it("moves width from one side of a separator to the other", () => {
    expect(rounded(moved([0.5, 0.5], 0, 100, 1000, [0, 0]))).toEqual([0.6, 0.4]);
    expect(rounded(moved([0.3, 0.3, 0.4], 1, -100, 1000, [0, 0, 0]))).toEqual([0.3, 0.2, 0.5]);
  });

  it("stops at either pane's minimum width", () => {
    expect(rounded(moved([0.5, 0.5], 0, 400, 1000, [300, 300]))).toEqual([0.7, 0.3]);
    expect(rounded(moved([0.5, 0.5], 0, -400, 1000, [300, 300]))).toEqual([0.3, 0.7]);
  });

  it("leaves shares as they are for a separator that isn't there", () => {
    const shares = [0.5, 0.5];
    expect(moved(shares, 1, 50, 1000, [0, 0])).toBe(shares);
    expect(moved(shares, 0, 50, 0, [0, 0])).toBe(shares);
  });
});

describe("fitted", () => {
  it("widens a pane under its minimum from the roomiest of the others", () => {
    expect(rounded(fitted([0.1, 0.6, 0.3], 1000, [300, 300, 200]))).toEqual([0.3, 0.4, 0.3]);
  });

  it("leaves panes that fit as they are", () => {
    expect(fitted([0.5, 0.5], 1000, [300, 300])).toEqual([0.5, 0.5]);
  });
});

describe("fittingCount", () => {
  it("counts the last panes that fit at their minimum widths, at least one", () => {
    expect(fittingCount([320, 360, 300], 1200)).toBe(3);
    expect(fittingCount([320, 360, 300], 700)).toBe(2);
    expect(fittingCount([320, 360, 300], 200)).toBe(1);
  });
});

describe("Remembered widths", () => {
  it("keeps each layout's shares, for as many panes as it has", () => {
    storeShares("activity-2", [0.4, 0.6]);
    expect(storedShares("activity-2", 2)).toEqual([0.4, 0.6]);
    expect(storedShares("activity-2", 3)).toBeNull();
    expect(storedShares("activity-3", 3)).toBeNull();
  });

  it("forgets what isn't shares", () => {
    localStorage.setItem("ember:panes:bad", '["a", 1]');
    expect(storedShares("bad", 2)).toBeNull();
    localStorage.setItem("ember:panes:broken", "{");
    expect(storedShares("broken", 2)).toBeNull();
  });

  it("keeps a width in pixels", () => {
    expect(storedWidth("thread")).toBeNull();
    storeWidth("thread", 480.4);
    expect(storedWidth("thread")).toBe(480);
  });
});
