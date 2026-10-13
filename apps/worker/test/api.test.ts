import { feature } from "@ember/parity";
import { listDurableObjectIds } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import worker from "../src/index";
import { api, origin, signIn } from "./support";

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe(feature("auth.guest-sign-in"), () => {
  it("signs in with a trimmed display name and returns a token for it", async () => {
    const response = await api("/api/session", { method: "POST", body: JSON.stringify({ name: "  Ada Lovelace  " }) });
    expect(response.status).toBe(201);
    const { user, token } = (await response.json()) as { user: { id: string; name: string }; token: string };
    expect(user.name).toBe("Ada Lovelace");
    expect(user.id).toMatch(/^[0-9a-z]{16}$/);

    const me = await api("/api/me", bearer(token));
    expect(await me.json()).toEqual({ user });
  });

  it("gives everyone who signs in a distinct identity, even with the same name", async () => {
    const [first, second] = await Promise.all([signIn("Ada"), signIn("Ada")]);
    expect(first.user.id).not.toBe(second.user.id);
  });

  it.each([
    ["a blank name", { name: "   " }],
    ["a missing name", {}],
    ["a name that isn't text", { name: 42 }],
    ["a name over 48 characters", { name: "x".repeat(49) }],
    ["a null body", null],
  ])("refuses %s with 422 and says why", async (_, body) => {
    const response = await api("/api/session", { method: "POST", body: JSON.stringify(body) });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Name must be 1 to 48 characters" });
  });

  it("accepts a name of exactly 48 characters", async () => {
    const response = await api("/api/session", { method: "POST", body: JSON.stringify({ name: "x".repeat(48) }) });
    expect(response.status).toBe(201);
  });

  it("refuses a body that isn't JSON", async () => {
    expect((await api("/api/session", { method: "POST", body: "name=Ada" })).status).toBe(422);
  });
});

describe(feature("auth.require-sign-in"), () => {
  it("answers 401 to requests without a valid token", async () => {
    expect((await api("/api/me")).status).toBe(401);
    expect((await api("/api/me", bearer("forged.token"))).status).toBe(401);
    expect((await api("/api/rooms")).status).toBe(401);
  });
});

describe(feature("rooms.open"), () => {
  it("lists the workspace's open rooms to everyone signed in", async () => {
    const { token } = await signIn("Ada");
    const response = await api("/api/rooms", bearer(token));
    expect(await response.json()).toEqual({
      rooms: [
        { id: "general", name: "general", kind: "open" },
        { id: "random", name: "random", kind: "open" },
      ],
    });
  });

  it("lets anyone signed in join any open room", async () => {
    const { token } = await signIn("Grace");
    const response = await api(`/api/rooms/general/socket?token=${token}`, { headers: { Upgrade: "websocket" } });
    expect(response.status).toBe(101);
    response.webSocket!.accept();
    response.webSocket!.close(1000);
  });

  it("answers 404 for room names that can't exist", async () => {
    const { token } = await signIn("Ada");
    for (const room of ["General", "-general", "a%2Fb", "%FF", "x".repeat(64)]) {
      const response = await api(`/api/rooms/${room}/socket?token=${token}`, { headers: { Upgrade: "websocket" } });
      expect(response.status, room).toBe(404);
    }
  });
});

describe(feature("realtime.connection"), () => {
  it("refuses room sockets without a valid token", async () => {
    const response = await api("/api/rooms/general/socket?token=forged.token", { headers: { Upgrade: "websocket" } });
    expect(response.status).toBe(401);
  });

  it("expects a WebSocket upgrade on the room socket", async () => {
    const { token } = await signIn("Ada");
    expect((await api(`/api/rooms/general/socket?token=${token}`)).status).toBe(426);
  });
});

describe(feature("platform.health"), () => {
  const bindings = env as unknown as Env;
  /** /api/health from a Worker whose bindings differ from this suite's by `changes`. */
  const healthWith = (changes: Partial<Env>) => worker.fetch(new Request(`${origin}/api/health`), { ...bindings, ...changes });

  it("reports that the Worker is up and which storage it uses", async () => {
    const response = await api("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, storage: bindings.STORAGE_BACKEND });
  });

  it("reaches the Workspace and a room's object, so a deploy can be checked without signing in", async () => {
    expect((await api("/api/health")).status).toBe(200);
    const workspaces = await listDurableObjectIds(bindings.WORKSPACE);
    expect(workspaces.some((id) => id.equals(bindings.WORKSPACE.idFromName("workspace")))).toBe(true);
    const rooms = await listDurableObjectIds(bindings.CHAT_ROOM);
    expect(rooms.some((id) => id.equals(bindings.CHAT_ROOM.idFromName("_health")))).toBe(true);
  });

  it("answers 503 and says so when SESSION_SECRET isn't set", async () => {
    const response = await healthWith({ SESSION_SECRET: "" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, storage: bindings.STORAGE_BACKEND, error: "SESSION_SECRET isn't set" });
  });

  it("answers 503 when the Workspace can't read its storage", async () => {
    const failing = { getByName: () => ({ health: () => Promise.reject(new Error("No such table")) }) };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await healthWith({ WORKSPACE: failing as unknown as Env["WORKSPACE"] });
    logged.mockRestore();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, storage: bindings.STORAGE_BACKEND, error: "Storage isn't answering" });
  });

  it("answers unknown API paths with a JSON 404", async () => {
    const response = await api("/api/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});
