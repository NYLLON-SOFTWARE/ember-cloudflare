import { describe, expect, it } from "vitest";
import { BADGE_PIXELS, badgePixels } from "./badge-image.ts";

/** The pixel at `x`, `y` of `pixels`, as blue, green, red and alpha. */
const pixel = (pixels: Buffer, x: number, y: number) => [...pixels.subarray((y * BADGE_PIXELS + x) * 4, (y * BADGE_PIXELS + x + 1) * 4)];

describe("badgePixels", () => {
  it("draws the count in white on a red disc, with nothing beyond it", () => {
    const one = badgePixels(1);
    expect(one).toHaveLength(BADGE_PIXELS * BADGE_PIXELS * 4);
    expect(pixel(one, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(one, 16, 3)).toEqual([38, 38, 220, 255]);
    // The top of the 1, the third of its five dots across, from where the text starts, 11 pixels in and 9 down.
    expect(pixel(one, 15, 9)).toEqual([255, 255, 255, 255]);
    expect(pixel(one, 16, 10)).toEqual([255, 255, 255, 255]);
    expect(pixel(one, 13, 9)).toEqual([38, 38, 220, 255]);
  });

  it("smooths the disc's edge", () => {
    const [blue, green, red, alpha] = pixel(badgePixels(1), 4, 4);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(255);
    // Premultiplied, as Electron takes its pixels.
    expect(red).toBe(Math.round((220 * alpha!) / 255));
    expect([blue, green]).toEqual([Math.round((38 * alpha!) / 255), Math.round((38 * alpha!) / 255)]);
  });

  it("draws 9+ past nine", () => {
    expect(badgePixels(10)).toEqual(badgePixels(250));
    expect(badgePixels(10)).not.toEqual(badgePixels(9));
    expect(badgePixels(2)).not.toEqual(badgePixels(3));
  });
});
