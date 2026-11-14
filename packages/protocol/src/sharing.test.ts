import { describe, expect, it } from "vitest";
import { MAX_ID_LENGTH, parseShareCheck, reachesMore, type RoomId } from "./index";

describe("Share check", () => {
  it("takes the room shared from and the room shared to", () => {
    const check = { sourceRoomId: "r1" as RoomId, targetRoomId: "r2" as RoomId };
    expect(parseShareCheck(check)).toEqual(check);
    expect(parseShareCheck({ ...check, extra: 1 })).toEqual(check);
  });

  it("refuses one without both rooms", () => {
    const refusal = "A share check needs the room it's from and the room it's to";
    expect(parseShareCheck(null)).toBe("Expected a JSON object");
    expect(parseShareCheck({ sourceRoomId: "r1" })).toBe(refusal);
    expect(parseShareCheck({ sourceRoomId: "", targetRoomId: "r2" })).toBe(refusal);
    expect(parseShareCheck({ sourceRoomId: "r1", targetRoomId: "r".repeat(MAX_ID_LENGTH + 1) })).toBe(refusal);
  });
});

describe("Whether sharing reaches more than the warning said", () => {
  const widening = (newViewers: number, names: string[]) => ({ widens: true, newViewers, names });

  it("reaches more with more people, or someone else in place of one named, or anyone where nothing was asked", () => {
    expect(reachesMore(widening(3, ["Ada", "Grace", "Linus"]), widening(2, ["Ada", "Grace"]))).toBe(true);
    expect(reachesMore(widening(2, ["Ada", "Leo"]), widening(2, ["Ada", "Priya"]))).toBe(true);
    expect(reachesMore(widening(1, ["Ada"]))).toBe(true);
  });

  it("reaches no more with the same people, fewer, or none new", () => {
    expect(reachesMore(widening(2, ["Ada", "Grace"]), widening(2, ["Ada", "Grace"]))).toBe(false);
    expect(reachesMore(widening(1, ["Grace"]), widening(2, ["Ada", "Grace"]))).toBe(false);
    expect(reachesMore({ widens: false, newViewers: 0, names: [] })).toBe(false);
  });
});
