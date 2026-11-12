import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

describe("relativeTime", () => {
  const now = new Date("2026-11-11T12:00:00");

  it("counts minutes, hours and days within a week", () => {
    expect(relativeTime("2026-11-11T11:59:30", now)).toBe("now");
    expect(relativeTime("2026-11-11T11:55:00", now)).toBe("5m ago");
    expect(relativeTime("2026-11-11T05:00:00", now)).toBe("7h ago");
    expect(relativeTime("2026-11-08T12:00:00", now)).toBe("3d ago");
  });

  it("gives the date after a week, with the year once it's another year's", () => {
    expect(relativeTime("2026-11-01T12:00:00", now)).toBe(new Date("2026-11-01T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    expect(relativeTime("2025-11-01T12:00:00", now)).toContain("2025");
  });
});
