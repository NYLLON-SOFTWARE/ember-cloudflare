import { describe, expect, it } from "vitest";
import { tabOf } from "./tabs";

describe("Phone tabs", () => {
  it("keeps the tab a page was opened from, and otherwise gives a DM to DMs and the rest to Home", () => {
    expect(tabOf("activity", "home", false)).toBe("activity");
    expect(tabOf(null, "activity", false)).toBe("activity");
    expect(tabOf(null, null, true)).toBe("dms");
    expect(tabOf(null, null, false)).toBe("home");
  });
});
