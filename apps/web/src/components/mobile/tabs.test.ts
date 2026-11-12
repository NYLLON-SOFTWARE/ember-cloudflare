import { describe, expect, it } from "vitest";
import { tabAt, tabOf } from "./tabs";

describe("Phone tabs", () => {
  it("knows each tab's own page", () => {
    expect(tabAt("/")).toBe("home");
    expect(tabAt("/dms")).toBe("dms");
    expect(tabAt("/activity")).toBe("activity");
    expect(tabAt("/files")).toBe("files");
    expect(tabAt("/files/canvases")).toBe("files");
    expect(tabAt("/rooms/general")).toBeNull();
    expect(tabAt("/filesystem")).toBeNull();
  });

  it("keeps the tab a page was opened from, and otherwise gives a DM to DMs and the rest to Home", () => {
    const isDirect = (roomId: string) => roomId === "dm";
    expect(tabOf("/activity", "home", isDirect)).toBe("activity");
    expect(tabOf("/rooms/general", "activity", isDirect)).toBe("activity");
    expect(tabOf("/rooms/dm", null, isDirect)).toBe("dms");
    expect(tabOf("/rooms/general", null, isDirect)).toBe("home");
    expect(tabOf("/users/someone", null, isDirect)).toBe("home");
  });
});
