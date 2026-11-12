import { describe, expect, it } from "vitest";
import { parseNewRoom, parseRoomChanges, subRoomName } from "./index.ts";

describe("Sub-rooms", () => {
  it("names a sub-room with its parent, by the parent's name as it is now when that's known", () => {
    const sales = { name: "Sales", parent: { id: "strata", name: "Strata" } };
    expect(subRoomName(sales)).toBe("Strata – Sales");
    expect(subRoomName(sales, "Strata Motors")).toBe("Strata Motors – Sales");
    expect(subRoomName({ name: "Strata" })).toBe("Strata");
  });

  it("takes a new room's parent, refusing one that can't name a room", () => {
    expect(parseNewRoom({ kind: "open", name: "Sales", parentId: "strata" })).toEqual({ kind: "open", name: "Sales", icon: undefined, parentId: "strata" });
    expect(parseNewRoom({ kind: "closed", name: "Sales", parentId: "strata", memberIds: [] })).toMatchObject({ parentId: "strata", memberIds: [] });
    expect(parseNewRoom({ kind: "open", name: "Sales", parentId: null })).not.toHaveProperty("parentId");
    for (const parentId of [7, "", "Not An Id", {}]) expect(typeof parseNewRoom({ kind: "open", name: "Sales", parentId })).toBe("string");
  });

  it("takes a change of parent, null taking a room out from under its parent, and leaves it out when it's left out", () => {
    expect(parseRoomChanges({ parentId: "strata" })).toEqual({ name: undefined, icon: undefined, parentId: "strata" });
    expect(parseRoomChanges({ parentId: null })).toEqual({ name: undefined, icon: undefined, parentId: null });
    expect(parseRoomChanges({ name: "Sales" })).not.toHaveProperty("parentId");
    expect(typeof parseRoomChanges({ parentId: 7 })).toBe("string");
  });
});
