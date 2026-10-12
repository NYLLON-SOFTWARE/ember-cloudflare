import { describe, expect, it } from "vitest";
import { roomIdFromPath } from "./use-route";

describe("roomIdFromPath", () => {
  it("reads the room from /rooms/:id", () => {
    expect(roomIdFromPath("/rooms/general")).toBe("general");
    expect(roomIdFromPath("/rooms/caf%C3%A9")).toBe("café");
  });

  it("ignores other paths", () => {
    expect(roomIdFromPath("/")).toBeNull();
    expect(roomIdFromPath("/rooms/general/extra")).toBeNull();
  });

  it("treats a malformed escape as no room instead of throwing", () => {
    expect(roomIdFromPath("/rooms/%FF")).toBeNull();
    expect(roomIdFromPath("/rooms/%E0%A4")).toBeNull();
  });
});
