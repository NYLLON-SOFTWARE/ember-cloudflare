// The widths of panes side by side, as `SplitPanes` lays them out: each pane's share of the row, which
// dragging the separator between two panes moves from one to the other, kept apart from a pane's
// minimum width, and remembered in this browser for each layout, by its key, as Slack remembers how
// wide you made its panes.

/** A pane's share of its row, as a fraction of it, the fractions of a row's panes adding up to 1. */
export type Shares = number[];

/** How far a press of an arrow key moves a separator, and with Shift held. */
export const KEY_STEP_PX = 16;
export const BIG_KEY_STEP_PX = 64;

const STORAGE_PREFIX = "ember:panes:";

/** `shares` scaled to add up to 1, or `fallback` when they can't be. */
export function normalized(shares: readonly number[], fallback: Shares): Shares {
  const total = shares.reduce((sum, share) => sum + share, 0);
  if (!(total > 0) || shares.some((share) => !(share >= 0))) return [...fallback];
  return shares.map((share) => share / total);
}

/**
 * `shares` with the separator after pane `index` moved by `deltaPx` in a row `widthPx` wide, taking the
 * width from the pane on one side and giving it to the pane on the other, but leaving each at least its
 * `minPx`.
 */
export function moved(shares: Shares, index: number, deltaPx: number, widthPx: number, minPx: readonly number[]): Shares {
  if (widthPx <= 0 || index < 0 || index >= shares.length - 1) return shares;
  const before = shares[index]! * widthPx;
  const after = shares[index + 1]! * widthPx;
  const pair = before + after;
  const lowest = Math.min(minPx[index] ?? 0, pair);
  const highest = Math.max(lowest, pair - (minPx[index + 1] ?? 0));
  const next = Math.min(highest, Math.max(lowest, before + deltaPx));
  const result = [...shares];
  result[index] = next / widthPx;
  result[index + 1] = (pair - next) / widthPx;
  return result;
}

/**
 * `shares` made to leave each pane at least its `minPx` in a row `widthPx` wide, where they can be: what
 * a narrow pane needs comes from the widest of the others.
 */
export function fitted(shares: Shares, widthPx: number, minPx: readonly number[]): Shares {
  if (widthPx <= 0) return shares;
  const widths = shares.map((share) => share * widthPx);
  for (let i = 0; i < widths.length; i++) {
    const short = (minPx[i] ?? 0) - widths[i]!;
    if (short <= 0) continue;
    // Taken from the others, each down to its own minimum, the roomiest first.
    let needed = short;
    const others = widths.map((width, j) => ({ j, spare: j === i ? 0 : width - (minPx[j] ?? 0) })).sort((a, b) => b.spare - a.spare);
    for (const { j, spare } of others) {
      if (needed <= 0 || spare <= 0) break;
      const taken = Math.min(spare, needed);
      widths[j]! -= taken;
      widths[i]! += taken;
      needed -= taken;
    }
  }
  return widths.map((width) => width / widthPx);
}

/** How many of the last panes fit in a row `widthPx` wide at their minimum widths, at least one. */
export function fittingCount(minPx: readonly number[], widthPx: number): number {
  let total = 0;
  let count = 0;
  for (let i = minPx.length - 1; i >= 0; i--) {
    total += minPx[i]!;
    if (count > 0 && total > widthPx) break;
    count++;
  }
  return count;
}

/** The shares remembered for layout `key`, if they're for as many panes as `count`. */
export function storedShares(key: string, count: number): Shares | null {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_PREFIX + key) ?? "null") as unknown;
    if (!Array.isArray(stored) || stored.length !== count || !stored.every((share) => typeof share === "number" && share > 0)) return null;
    return normalized(stored as number[], []);
  } catch {
    return null;
  }
}

/** Remembers `shares` for layout `key`, in this browser. */
export function storeShares(key: string, shares: Shares): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(shares.map((share) => Math.round(share * 10000) / 10000)));
  } catch {
    // Private windows and full storage forget it, which only costs the widths next time.
  }
}

/** A width in pixels remembered for `key`, such as the thread's beside its room, or null. */
export function storedWidth(key: string): number | null {
  try {
    const stored = Number(localStorage.getItem(STORAGE_PREFIX + key));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

export function storeWidth(key: string, widthPx: number): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, String(Math.round(widthPx)));
  } catch {
    // As with shares.
  }
}
