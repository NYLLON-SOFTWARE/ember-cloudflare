import { describe, expect, it } from "vitest";
import { MAX_ID_LENGTH, parseShareCheck, type RoomId } from "./index";

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
