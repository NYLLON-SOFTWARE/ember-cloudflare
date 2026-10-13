import { feature } from "@ember/parity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchRooms, loadSession, roomSocketUrl, saveSession } from "./api";

const session = { user: { id: "u1", name: "Ada" }, token: "t0k3n" };

afterEach(() => vi.restoreAllMocks());

describe(feature("auth.sessions"), () => {
  it("remembers the session in this browser until sign-out", () => {
    expect(loadSession()).toBeNull();
    saveSession(session);
    expect(loadSession()).toEqual(session);
    saveSession(null);
    expect(loadSession()).toBeNull();
    expect(localStorage.getItem("ember:session")).toBeNull();
  });

  it("treats an unreadable saved session as signed out", () => {
    localStorage.setItem("ember:session", "{not json");
    expect(loadSession()).toBeNull();
  });

  it("sends the token with API requests and reports refusals with the server's reason", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "Not signed in" }, { status: 401 }));
    const failure = await fetchRooms("t0k3n").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 401, message: "Not signed in" });
    expect(new Headers(fetch.mock.calls[0]![1]!.headers).get("Authorization")).toBe("Bearer t0k3n");
  });
});

describe(feature("realtime.reconnect"), () => {
  it("connects room sockets over wss on https pages, with the token in the address", () => {
    expect(roomSocketUrl("general", "a b")).toBe("ws://localhost:3000/api/rooms/general/socket?token=a+b");
    vi.stubGlobal("location", new URL("https://ember.example/rooms/general"));
    expect(roomSocketUrl("general", "t")).toBe("wss://ember.example/api/rooms/general/socket?token=t");
    vi.unstubAllGlobals();
  });
});
