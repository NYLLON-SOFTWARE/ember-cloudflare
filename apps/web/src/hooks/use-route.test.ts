import { feature } from "@ember/parity";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { joinCodeFromPath, navigate, newRoomPath, roomIdFromPath, roomPath, roomSettingsPath, routeOf, useJoinRoute, useRoute } from "./use-route";

afterEach(() => history.replaceState(null, "", "/"));

describe(feature("rooms.show"), () => {
  it("reads the room from /rooms/:id", () => {
    expect(roomIdFromPath("/rooms/general")).toBe("general");
    expect(roomIdFromPath("/rooms/caf%C3%A9")).toBe("café");
    expect(roomPath("café")).toBe("/rooms/caf%C3%A9");
    history.replaceState(null, "", "/rooms/random");
    expect(renderHook(() => useRoute()).result.current).toEqual({ page: "room", roomId: "random" });
  });

  it("ignores other paths", () => {
    expect(roomIdFromPath("/")).toBeNull();
    expect(roomIdFromPath("/rooms/general/extra")).toBeNull();
    expect(routeOf("/")).toEqual({ page: "room", roomId: null });
    expect(routeOf("/rooms/general/extra")).toEqual({ page: "room", roomId: null });
  });

  it("treats a malformed escape as no room instead of throwing", () => {
    expect(roomIdFromPath("/rooms/%FF")).toBeNull();
    expect(roomIdFromPath("/rooms/%E0%A4")).toBeNull();
    expect(routeOf("/rooms/opens/%FF/edit")).toEqual({ page: "room", roomId: null });
  });

  it("follows in-app navigation and the browser's Back button", async () => {
    history.replaceState(null, "", "/rooms/general");
    const { result } = renderHook(() => useRoute());
    act(() => navigate("/rooms/random"));
    expect(result.current).toEqual({ page: "room", roomId: "random" });
    expect(location.pathname).toBe("/rooms/random");

    act(() => history.back());
    await waitFor(() => expect(result.current).toEqual({ page: "room", roomId: "general" }));
  });

  it("doesn't add a history entry for the page you're already on", () => {
    history.replaceState(null, "", "/rooms/general");
    const length = history.length;
    navigate("/rooms/general");
    expect(history.length).toBe(length);
  });

  it("takes the current page's place in the history when asked to", () => {
    history.replaceState(null, "", "/rooms/general");
    const length = history.length;
    navigate("/rooms/random", { replace: true });
    expect(location.pathname).toBe("/rooms/random");
    expect(history.length).toBe(length);
  });
});

describe(feature("rooms.create-open"), () => {
  it("has New room at /rooms/opens/new", () => {
    expect(newRoomPath("open")).toBe("/rooms/opens/new");
    expect(routeOf("/rooms/opens/new")).toEqual({ page: "new-room", access: "open" });
  });
});

describe(feature("rooms.create-closed"), () => {
  it("has the private room form at /rooms/closeds/new", () => {
    expect(newRoomPath("closed")).toBe("/rooms/closeds/new");
    expect(routeOf("/rooms/closeds/new")).toEqual({ page: "new-room", access: "closed" });
  });
});

describe(feature("rooms.settings-page"), () => {
  it("has a room's settings at the address for its kind, as ember-rust's edit_path gives it", () => {
    expect(roomSettingsPath("open", "general")).toBe("/rooms/opens/general/edit");
    expect(roomSettingsPath("closed", "café")).toBe("/rooms/closeds/caf%C3%A9/edit");
    expect(roomSettingsPath("direct", "ada-grace")).toBe("/rooms/directs/ada-grace/edit");
    expect(routeOf("/rooms/opens/general/edit")).toEqual({ page: "room-settings", access: "open", roomId: "general" });
    expect(routeOf("/rooms/closeds/caf%C3%A9/edit")).toEqual({ page: "room-settings", access: "closed", roomId: "café" });
  });
});

describe(feature("accounts.settings-page"), () => {
  it("has workspace settings at /account/edit", () => {
    expect(routeOf("/account/edit")).toEqual({ page: "workspace-settings" });
  });
});

describe(feature("auth.sign-up"), () => {
  it("reads the join code from /join/:code, as the link has it", () => {
    expect(joinCodeFromPath("/join/aB3d-Ef5h-iJ7k")).toBe("aB3d-Ef5h-iJ7k");
    expect(joinCodeFromPath("/join/")).toBeNull();
    expect(joinCodeFromPath("/join/aB3d-Ef5h-iJ7k/extra")).toBeNull();
    expect(joinCodeFromPath("/rooms/aB3d-Ef5h-iJ7k")).toBeNull();
  });

  it("leaves the join page when the app goes home", () => {
    history.replaceState(null, "", "/join/aB3d-Ef5h-iJ7k");
    const { result } = renderHook(() => useJoinRoute());
    expect(result.current).toBe("aB3d-Ef5h-iJ7k");
    act(() => navigate("/", { replace: true }));
    expect(result.current).toBeNull();
  });
});
