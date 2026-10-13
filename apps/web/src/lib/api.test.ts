import { feature } from "@ember/parity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchMe, fetchRooms, forgetStoredSession, roomSocketUrl, signOut } from "./api";

afterEach(() => vi.restoreAllMocks());

describe(feature("auth.sessions"), () => {
  it("reports refusals with the server's reason", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "Not signed in" }, { status: 401 }));
    const failure = await fetchMe().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 401, message: "Not signed in" });
  });

  it("leaves the session to the browser's cookie, sending no token", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ rooms: [] }));
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
