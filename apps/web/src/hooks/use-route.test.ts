import { feature } from "@ember/parity";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { navigate, roomIdFromPath, useRoomRoute } from "./use-route";

afterEach(() => history.replaceState(null, "", "/"));

describe(feature("rooms.show"), () => {
  it("reads the room from /rooms/:id", () => {
    expect(roomIdFromPath("/rooms/general")).toBe("general");
    expect(roomIdFromPath("/rooms/caf%C3%A9")).toBe("café");
    history.replaceState(null, "", "/rooms/random");
    expect(renderHook(() => useRoomRoute()).result.current).toBe("random");
  });

  it("ignores other paths", () => {
    expect(roomIdFromPath("/")).toBeNull();
    expect(roomIdFromPath("/rooms/general/extra")).toBeNull();
  });

  it("treats a malformed escape as no room instead of throwing", () => {
    expect(roomIdFromPath("/rooms/%FF")).toBeNull();
    expect(roomIdFromPath("/rooms/%E0%A4")).toBeNull();
  });

  it("follows in-app navigation and the browser's Back button", async () => {
    history.replaceState(null, "", "/rooms/general");
    const { result } = renderHook(() => useRoomRoute());
    act(() => navigate("/rooms/random"));
    expect(result.current).toBe("random");
    expect(location.pathname).toBe("/rooms/random");

    act(() => history.back());
    await waitFor(() => expect(result.current).toBe("general"));
  });

  it("doesn't add a history entry for the page you're already on", () => {
    history.replaceState(null, "", "/rooms/general");
    const length = history.length;
    navigate("/rooms/general");
    expect(history.length).toBe(length);
  });
});
