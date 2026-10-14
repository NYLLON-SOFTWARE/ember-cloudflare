import { feature } from "@ember/parity";
import type { NewRoom } from "@ember/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, changeRoom, createRoom, fetchMe, fetchNewRoomForm, fetchRooms, fetchRoomSettings, forgetStoredSession, joinWorkspace, roomSocketUrl, signOut } from "./api";

afterEach(() => vi.restoreAllMocks());

describe(feature("auth.sessions"), () => {
  it("reports refusals with the server's reason", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "Not signed in" }, { status: 401 }));
    const failure = await fetchMe().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 401, message: "Not signed in" });
  });

  it("leaves the session to the browser's cookie, sending no token", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ rooms: [], invitation: null }));
    await fetchRooms();
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe("/api/rooms");
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
    expect(roomSocketUrl("general")).toBe("ws://localhost:3000/api/rooms/general/socket");
    vi.stubGlobal("location", new URL("https://ember.example/rooms/general"));
    expect(roomSocketUrl("general")).toBe("wss://ember.example/api/rooms/general/socket");
    vi.unstubAllGlobals();
  });
});

describe(feature("rooms.create-closed"), () => {
  it("asks for New room's people, and creates a room with the people chosen", async () => {
    const leads = { id: "leads", name: "Leads", kind: "closed" };
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
    const café = { id: "café", name: "Café", kind: "open" };
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ room: café, canAdminister: true, people: [] }));
    expect(await fetchRoomSettings("café")).toEqual({ room: café, canAdminister: true, people: [] });
    expect(fetch).toHaveBeenLastCalledWith("/api/rooms/caf%C3%A9/settings", expect.anything());

    fetch.mockResolvedValueOnce(Response.json({ room: { ...café, name: "Coffee" } }));
    expect(await changeRoom("café", { name: "Coffee" })).toEqual({ ...café, name: "Coffee" });
    expect(fetch).toHaveBeenLastCalledWith("/api/rooms/caf%C3%A9", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Coffee" }) }));
  });
});
