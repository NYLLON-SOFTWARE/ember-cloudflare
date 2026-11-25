// The count Windows' taskbar shows over the app's icon, which the app draws itself, since Windows, unlike
// a Mac's Dock or Linux docks, has no count of its own: the count, or 9+ past nine, in white on a red disc,
// drawn at twice the 16 points the taskbar shows it at, for screens that are scaled up.

/** How many pixels across and down the badge is. */
export const BADGE_PIXELS = 32;

/** The disc's red, green and blue. */
const RED = [220, 38, 38] as const;
const WHITE = [255, 255, 255] as const;

/** How many pixels across and down each of a glyph's dots is. */
const DOT = 2;

/** The digits, and the plus of 9+, each five dots across and seven down, a 1 for each dot drawn. */
const GLYPHS: Record<string, readonly string[]> = {
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
};

/** A glyph's dots across and down, and the dots between two glyphs. */
const GLYPH = { across: 5, down: 7, apart: 1 };

/**
 * The badge for `count`, from 1, as premultiplied BGRA pixels, row by row from the top, as Electron's
 * `nativeImage.createFromBitmap` takes them.
 */
export function badgePixels(count: number): Buffer {
  const pixels = Buffer.alloc(BADGE_PIXELS * BADGE_PIXELS * 4);
  for (let y = 0; y < BADGE_PIXELS; y++) {
    for (let x = 0; x < BADGE_PIXELS; x++) paint(pixels, x, y, RED, discCovering(x, y));
  }
  const text = count > 9 ? "9+" : String(count);
  const across = (text.length * (GLYPH.across + GLYPH.apart) - GLYPH.apart) * DOT;
  const [left, top] = [Math.round((BADGE_PIXELS - across) / 2), Math.round((BADGE_PIXELS - GLYPH.down * DOT) / 2)];
  [...text].forEach((character, index) => {
    const rows = GLYPHS[character] ?? [];
    rows.forEach((row, down) => {
      [...row].forEach((dot, along) => {
        if (dot !== "1") return;
        const [x, y] = [left + (index * (GLYPH.across + GLYPH.apart) + along) * DOT, top + down * DOT];
        for (let dx = 0; dx < DOT; dx++) for (let dy = 0; dy < DOT; dy++) paint(pixels, x + dx, y + dy, WHITE, 1);
      });
    });
  });
  return pixels;
}

/** How much of the pixel at `x`, `y` the disc covers, from 0 to 1, from 4 by 4 points within it, so its edge is smooth. */
function discCovering(x: number, y: number): number {
  const radius = BADGE_PIXELS / 2;
  let inside = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const [dx, dy] = [x + (i + 0.5) / 4 - radius, y + (j + 0.5) / 4 - radius];
      if (dx * dx + dy * dy <= radius * radius) inside++;
    }
  }
  return inside / 16;
}

/** Paints the pixel at `x`, `y` `color`, covering `alpha` of it, premultiplied, as blue, green, red and alpha. */
function paint(pixels: Buffer, x: number, y: number, [red, green, blue]: readonly [number, number, number], alpha: number): void {
  const at = (y * BADGE_PIXELS + x) * 4;
  pixels.set([blue, green, red, 255].map((value) => Math.round(value * alpha)), at);
}
