import { feature } from "@ember/parity";
import type { NewRoom, Sidebar } from "@ember/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, changeRoom, createRoom, fetchMe, fetchNewRoomForm, fetchRoomSettings, fetchSidebar, forgetStoredSession, joinWorkspace, roomSocketUrl, setFavorite, setFavoriteOrder, signOut, workspaceSocketUrl } from "./api";

afterEach(() => vi.restoreAllMocks());

describe(feature("auth.sessions"), () => {
  it("reports refusals with the server's reason", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "Not signed in" }, { status: 401 }));
    const failure = await fetchMe().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 401, message: "Not signed in" });
  });

  it("leaves the session to the browser's cookie, sending no token", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ rooms: [], favorites: { rooms: [], version: 0 }, invitation: null }));
    await fetchSidebar(null);
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe("/api/sidebar");
    expect(new Headers(init!.headers).has("Authorization")).toBe(false);
  });

  it("forgets the session earlier versions kept in localStorage", () => {
    localStorage.setItem("ember:session", JSON.stringify({ user: { id: "u1", name: "Ada" }, token: "t0k3n" }));
    forgetStoredSession();
    expect(localStorage.getItem("ember:session")).toBeNull();
  });
});

describe(feature("auth.sign-up"), () => {
  const grace = { name: "Grace Hopper", emailAddress: "grace@example.com", password: "compiler" };

  it("joins with the join link's code", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ user: { id: "u2", name: "Grace Hopper" } }, { status: 201 }));
    expect(await joinWorkspace("aB3d-Ef5h-iJ7k", grace)).toEqual({ id: "u2", name: "Grace Hopper" });
    expect(fetch).toHaveBeenCalledWith("/api/join/aB3d-Ef5h-iJ7k", expect.objectContaining({ method: "POST", body: JSON.stringify(grace) }));
  });

  it("says where the server sends someone it turns away", async () => {
    const signIn = "/session/new?email_address=grace%40example.com";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "That email address has an account already", redirect: signIn }, { status: 409 }));
    const failure = await joinWorkspace("aB3d-Ef5h-iJ7k", grace).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 409, redirect: signIn });
  });
});

describe(feature("auth.sign-out"), () => {
  it("ends the session on the server", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await signOut();
    expect(fetch).toHaveBeenCalledWith("/api/session", expect.objectContaining({ method: "DELETE" }));
  });
});

describe(feature("realtime.connection"), () => {
  it("opens room sockets at the room's own address, over wss on https pages", () => {
    expect(roomSocketUrl("general", { visible: true })).toBe("ws://localhost:3000/api/rooms/general/socket?visible=1&protocol=2");
    vi.stubGlobal("location", new URL("https://ember.example/rooms/general"));
    expect(roomSocketUrl("general", { visible: false })).toBe("wss://ember.example/api/rooms/general/socket?visible=0&protocol=2");
    vi.unstubAllGlobals();
  });
});

describe(feature("platform.live-socket"), () => {
  it("opens the workspace socket on the page's own host, over wss on https pages", () => {
    expect(workspaceSocketUrl()).toBe("ws://localhost:3000/api/socket");
    vi.stubGlobal("location", new URL("https://ember.example/rooms/general"));
    expect(workspaceSocketUrl()).toBe("wss://ember.example/api/socket");
    vi.unstubAllGlobals();
  });
});

describe(feature("sidebar.live-updates"), () => {
  const sidebar: Sidebar = { rooms: [{ id: "r1", name: "Design", kind: "open", icon: null, unread: false }], favorites: { rooms: [], version: 0 }, invitation: null };

  it("keeps the sidebar's ETag, and names it to keep the copy while it's current", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(sidebar, { headers: { ETag: 'W/"abc"' } }));
    const copy = await fetchSidebar(null);
    expect(copy).toEqual({ sidebar, etag: 'W/"abc"' });
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).has("If-None-Match")).toBe(false);

    fetch.mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: 'W/"abc"' } }));
    expect(await fetchSidebar(copy)).toBe(copy);
    expect(new Headers(fetch.mock.calls[1]![1]?.headers).get("If-None-Match")).toBe('W/"abc"');

    const renamed = { ...sidebar, rooms: [{ ...sidebar.rooms[0]!, name: "Product" }] };
    fetch.mockResolvedValueOnce(Response.json(renamed, { headers: { ETag: 'W/"def"' } }));
    expect(await fetchSidebar(copy)).toEqual({ sidebar: renamed, etag: 'W/"def"' });
  });

  it("reports a refusal as any request does", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "Not signed in" }, { status: 401 }));
    await expect(fetchSidebar({ sidebar, etag: 'W/"abc"' })).rejects.toMatchObject({ status: 401, message: "Not signed in" });
  });
});

describe(feature("sidebar.favorites"), () => {
  it("stars a room, or unstars it, answering the person's stars", async () => {
    const favorites = { rooms: ["r 1"], version: 3 };
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ favorites }));
    expect(await setFavorite("r 1", true)).toEqual(favorites);
    expect(fetch).toHaveBeenLastCalledWith("/api/rooms/r%201/favorite", expect.objectContaining({ method: "PUT", body: JSON.stringify({ favorite: true }) }));
    await setFavorite("r 1", false);
    expect(fetch).toHaveBeenLastCalledWith("/api/rooms/r%201/favorite", expect.objectContaining({ body: JSON.stringify({ favorite: false }) }));
  });
});

describe(feature("sidebar.favorite-order"), () => {
  it("sends the order of someone's stars, answering their stars", async () => {
    const favorites = { rooms: ["r2", "r1"], version: 3 };
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ favorites }));
    expect(await setFavoriteOrder(["r2", "r1"])).toEqual(favorites);
    expect(fetch).toHaveBeenLastCalledWith("/api/sidebar/order", expect.objectContaining({ method: "PUT", body: JSON.stringify({ roomIds: ["r2", "r1"] }) }));
  });
});

describe(feature("rooms.create-closed"), () => {
  it("asks for New room's people, and creates a room with the people chosen", async () => {
    const leads = { id: "leads", name: "Leads", kind: "closed", icon: null };
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ people: [] }));
    expect(await fetchNewRoomForm()).toEqual({ people: [] });
    expect(fetch).toHaveBeenLastCalledWith("/api/rooms/new", expect.anything());

    fetch.mockResolvedValueOnce(Response.json({ room: leads }, { status: 201 }));
    const room: NewRoom = { kind: "closed", name: "Leads", memberIds: ["u1", "u2"] };
    expect(await createRoom(room)).toEqual(leads);
    expect(fetch).toHaveBeenLastCalledWith("/api/rooms", expect.objectContaining({ method: "POST", body: JSON.stringify(room) }));
  });
});

describe(feature("rooms.settings-page"), () => {
  it("reads and changes a room by its id, escaped", async () => {
    const café = { id: "café", name: "Café", kind: "open", icon: null };
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ room: café, canAdminister: true, people: [] }));
    expect(await fetchRoomSettings("café")).toEqual({ room: café, canAdminister: true, people: [] });
    expect(fetch).toHaveBeenLastCalledWith("/api/rooms/caf%C3%A9/settings", expect.anything());

    fetch.mockResolvedValueOnce(Response.json({ room: { ...café, name: "Coffee" } }));
    expect(await changeRoom("café", { name: "Coffee" })).toEqual({ ...café, name: "Coffee" });
    expect(fetch).toHaveBeenLastCalledWith("/api/rooms/caf%C3%A9", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Coffee" }) }));
  });
});
