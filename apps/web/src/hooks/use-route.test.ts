import { feature } from "@ember/parity";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  guardLeaving,
  joinCodeFromPath,
  leave,
  navigate,
  newRoomPath,
  roomIdFromPath,
  roomPath,
  roomSettingsPath,
  routeOf,
  useBackPath,
  useJoinRoute,
  useRoute,
  type LeaveGuard,
} from "./use-route";

afterEach(() => history.replaceState(null, "", "/"));

describe(feature("rooms.show"), () => {
  it("reads the room from /rooms/:id", () => {
    expect(roomIdFromPath("/rooms/general")).toBe("general");
    expect(roomIdFromPath("/rooms/caf%C3%A9")).toBe("café");
    expect(roomPath("café")).toBe("/rooms/caf%C3%A9");
    history.replaceState(null, "", "/rooms/random");
    expect(renderHook(() => useRoute()).result.current).toEqual({ page: "room", roomId: "random" });
  });

  it("reads other paths as home", () => {
    expect(roomIdFromPath("/")).toBeNull();
    expect(roomIdFromPath("/rooms/general/extra")).toBeNull();
    expect(routeOf("/")).toEqual({ page: "home" });
    expect(routeOf("/rooms/general/extra")).toEqual({ page: "home" });
  });

  it("treats a malformed escape as no room instead of throwing", () => {
    expect(roomIdFromPath("/rooms/%FF")).toBeNull();
    expect(roomIdFromPath("/rooms/%E0%A4")).toBeNull();
    expect(routeOf("/rooms/opens/%FF/edit")).toEqual({ page: "home" });
    expect(routeOf("/rooms/opens/%FF")).toEqual({ page: "home" });
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

describe(feature("rooms.index"), () => {
  it("has the newest room at /rooms", () => {
    expect(routeOf("/rooms")).toEqual({ page: "newest-room" });
  });

  it("reads a room's address for its kind, which goes on to the room's own", () => {
    expect(routeOf("/rooms/opens/general")).toEqual({ page: "room-of-kind", kind: "open", roomId: "general" });
    expect(routeOf("/rooms/closeds/caf%C3%A9")).toEqual({ page: "room-of-kind", kind: "closed", roomId: "café" });
    expect(routeOf("/rooms/directs/ada-grace")).toEqual({ page: "room-of-kind", kind: "direct", roomId: "ada-grace" });
  });

  it("reads /rooms/opens and the others as room ids, as ember-rust matches /rooms/<id> first", () => {
    expect(routeOf("/rooms/opens")).toEqual({ page: "room", roomId: "opens" });
    expect(routeOf("/rooms/closeds")).toEqual({ page: "room", roomId: "closeds" });
    expect(routeOf("/rooms/directs")).toEqual({ page: "room", roomId: "directs" });
  });

  it("leaves New direct message, which comes with direct messages, at home for now", () => {
    expect(routeOf("/rooms/directs/new")).toEqual({ page: "home" });
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

describe(feature("users.profile"), () => {
  it("has your profile at /users/me/profile", () => {
    expect(routeOf("/users/me/profile")).toEqual({ page: "profile" });
  });

  it("goes back to the page another was opened from, as ember-rust's `link_back` goes to the referrer", async () => {
    history.replaceState(null, "", "/rooms/general");
    const { result } = renderHook(() => useBackPath());
    act(() => navigate("/users/me/profile"));
    expect(result.current).toBe("/rooms/general");
    act(() => navigate("/account/edit"));
    expect(result.current).toBe("/users/me/profile");

    // Back and Forward find where each page was opened from, as a browser keeps a page's referrer.
    act(() => history.back());
    await waitFor(() => expect(location.pathname).toBe("/users/me/profile"));
    expect(result.current).toBe("/rooms/general");
    act(() => history.forward());
    await waitFor(() => expect(result.current).toBe("/users/me/profile"));
  });

  it("goes back to where a page that took another's place was opened from, as a redirect keeps the referrer", () => {
    history.replaceState(null, "", "/account/edit");
    const { result } = renderHook(() => useBackPath());
    act(() => navigate("/"));
    act(() => navigate("/rooms/general", { replace: true }));
    expect(result.current).toBe("/account/edit");
  });

  it("goes home from a page the app didn't open, or one opened from itself", () => {
    history.replaceState(null, "", "/users/me/profile");
    const { result } = renderHook(() => useBackPath());
    expect(result.current).toBe("/");
    act(() => history.replaceState({ position: 0, from: "/users/me/profile" }, "", "/users/me/profile"));
    expect(renderHook(() => useBackPath()).result.current).toBe("/");
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

describe(feature("rooms.unsaved-changes"), () => {
  /** A guard that holds the app on its page, keeping how to go on. */
  function holdingGuard() {
    const asked: (string | null)[] = [];
    let proceed = () => {};
    const guard = vi.fn<LeaveGuard>((path, go) => {
      asked.push(path);
      proceed = go;
      return true;
    });
    const stop = guardLeaving(guard);
    return { asked, guard, stop, proceed: () => act(() => proceed()) };
  }

  /** The app at `from`, then at `to`, two entries it numbered in the history. */
  function visit(from: string, to: string) {
    navigate(from, { replace: true });
    navigate(to);
    return renderHook(() => useRoute());
  }

  it("asks the page's guard before showing another page, and shows it once the guard lets it go", () => {
    history.replaceState(null, "", "/rooms/opens/design/edit");
    const { result } = renderHook(() => useRoute());
    const { asked, stop, proceed } = holdingGuard();
    act(() => navigate("/rooms/general"));
    expect(asked).toEqual(["/rooms/general"]);
    expect(location.pathname).toBe("/rooms/opens/design/edit");
    expect(result.current).toEqual({ page: "room-settings", access: "open", roomId: "design" });

    proceed();
    expect(location.pathname).toBe("/rooms/general");
    expect(result.current).toEqual({ page: "room", roomId: "general" });
    stop();
  });

  it("goes straight on when the guard doesn't hold the page, or once it's gone", () => {
    history.replaceState(null, "", "/rooms/opens/design/edit");
    const guard = vi.fn<LeaveGuard>(() => false);
    const stop = guardLeaving(guard);
    navigate("/rooms/closeds/design/edit", { replace: true });
    expect(guard).toHaveBeenCalledWith("/rooms/closeds/design/edit", expect.any(Function));
    expect(location.pathname).toBe("/rooms/closeds/design/edit");

    stop();
    const { guard: stale } = holdingGuard();
    // Taking away a guard that's been replaced leaves the one in its place.
    stop();
    navigate("/rooms/general");
    expect(stale).toHaveBeenCalledOnce();
    expect(location.pathname).toBe("/rooms/closeds/design/edit");
  });

  it("asks with no page before leaving the app, as signing out does", () => {
    const signOut = vi.fn();
    const { asked, stop, proceed } = holdingGuard();
    leave(signOut);
    expect(asked).toEqual([null]);
    expect(signOut).not.toHaveBeenCalled();
    proceed();
    expect(signOut).toHaveBeenCalledOnce();

    stop();
    leave(signOut);
    expect(signOut).toHaveBeenCalledTimes(2);
  });

  it("turns Back around, showing the page all along, until the guard lets it go", async () => {
    const { result } = visit("/rooms/general", "/rooms/opens/design/edit");
    const length = history.length;
    const { asked, stop, proceed } = holdingGuard();
    // What the app shows each time the address changes, read as soon as it has.
    const shown: unknown[] = [];
    const read = () => shown.push(renderHook(() => useRoute()).result.current);
    window.addEventListener("popstate", read);

    act(() => history.back());
    await waitFor(() => expect(shown).toHaveLength(2));
    expect(asked).toEqual(["/rooms/general"]);
    expect(location.pathname).toBe("/rooms/opens/design/edit");
    expect(shown).toEqual([result.current, result.current]);
    expect(result.current).toEqual({ page: "room-settings", access: "open", roomId: "design" });
    expect(history.length).toBe(length);

    proceed();
    await waitFor(() => expect(result.current).toEqual({ page: "room", roomId: "general" }));
    expect(location.pathname).toBe("/rooms/general");
    expect(asked).toHaveLength(1);
    window.removeEventListener("popstate", read);
    stop();
  });

  it("turns Forward around too", async () => {
    const { result } = visit("/rooms/opens/design/edit", "/rooms/general");
    act(() => history.back());
    await waitFor(() => expect(result.current).toEqual({ page: "room-settings", access: "open", roomId: "design" }));
    const { asked, stop, proceed } = holdingGuard();

    act(() => history.forward());
    await waitFor(() => expect(asked).toEqual(["/rooms/general"]));
    await waitFor(() => expect(location.pathname).toBe("/rooms/opens/design/edit"));
    expect(result.current).toEqual({ page: "room-settings", access: "open", roomId: "design" });

    proceed();
    await waitFor(() => expect(result.current).toEqual({ page: "room", roomId: "general" }));
    stop();
  });

  it("follows Back when the guard lets it", async () => {
    const { result } = visit("/rooms/general", "/rooms/opens/design/edit");
    const stop = guardLeaving(() => false);
    act(() => history.back());
    await waitFor(() => expect(result.current).toEqual({ page: "room", roomId: "general" }));
    stop();
  });
});
