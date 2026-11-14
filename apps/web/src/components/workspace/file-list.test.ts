import { describe, expect, it } from "vitest";
import { shortDateLabel } from "./file-list";

describe("A row's date", () => {
  const now = new Date(2026, 10, 12, 15, 0);
  it("says Today and Yesterday, else the month and day, and the year only when it isn't this one", () => {
    expect(shortDateLabel(new Date(2026, 10, 12, 0, 5), now)).toBe("Today");
    expect(shortDateLabel(new Date(2026, 10, 11, 23, 59), now)).toBe("Yesterday");
    expect(shortDateLabel(new Date(2026, 10, 3), now)).toBe(new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(2026, 10, 3)));
    expect(shortDateLabel(new Date(2025, 10, 3), now)).toContain("2025");
  });
});
