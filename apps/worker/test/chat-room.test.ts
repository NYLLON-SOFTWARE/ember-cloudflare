import type { ServerFrame } from "@ember/protocol";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const origin = "https://ember.test";

async function signIn(name: string): Promise<string> {
  const response = await exports.default.fetch(`${origin}/api/session`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { token: string }).token;
}

/** Opens a room socket and queues every frame it receives. */
async function connect(room: string, token: string) {
  const response = await exports.default.fetch(`${origin}/api/rooms/${room}/socket?token=${token}`, {
    headers: { Upgrade: "websocket" },
  });
  const ws = response.webSocket;
  if (!ws) throw new Error(`No socket: ${response.status} ${await response.text()}`);
  ws.accept();

  const frames: ServerFrame[] = [];
  const waiters: Array<() => void> = [];
  ws.addEventListener("message", (event) => {
    frames.push(JSON.parse(event.data as string));
    waiters.splice(0).forEach((wake) => wake());
  });

  async function next<T extends ServerFrame["type"]>(type: T): Promise<Extract<ServerFrame, { type: T }>> {
    for (;;) {
      const index = frames.findIndex((f) => f.type === type);
      if (index >= 0) return frames.splice(index, 1)[0] as Extract<ServerFrame, { type: T }>;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  }

  return { ws, next, send: (frame: object) => ws.send(JSON.stringify(frame)) };
}

describe("API", () => {
  it("rejects sockets without a valid token", async () => {
    const response = await exports.default.fetch(`${origin}/api/rooms/general/socket?token=forged.token`, {
      headers: { Upgrade: "websocket" },
    });
    expect(response.status).toBe(401);
  });

  it("lists the default rooms for signed-in users", async () => {
    const token = await signIn("Ada");
    const response = await exports.default.fetch(`${origin}/api/rooms`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await response.json()).toEqual({
      rooms: [
        { id: "general", name: "general", kind: "open" },
        { id: "random", name: "random", kind: "open" },
      ],
    });
  });
});

describe("ChatRoom", () => {
  it("delivers messages, boosts and presence to everyone in the room", async () => {
    const ada = await connect("lobby", await signIn("Ada"));
    const adaWelcome = await ada.next("welcome");
    expect(adaWelcome.messages).toEqual([]);

    const grace = await connect("lobby", await signIn("Grace"));
    const graceWelcome = await grace.next("welcome");
    expect(graceWelcome.present.map((u) => u.name).sort()).toEqual(["Ada", "Grace"]);
    expect((await ada.next("presence")).present).toHaveLength(2);

    ada.send({ type: "message.create", clientMessageId: "c1", body: "Hello, Grace" });
    const { message } = await grace.next("message.created");
    expect(message).toMatchObject({ clientMessageId: "c1", body: "Hello, Grace", creator: { name: "Ada" } });
    await ada.next("message.created");

    grace.send({ type: "boost.create", messageId: message.id, content: "👍" });
    const { boost } = await ada.next("boost.created");
    expect(boost).toMatchObject({ messageId: message.id, content: "👍", booster: { name: "Grace" } });

    grace.send({ type: "message.delete", messageId: message.id });
    expect((await grace.next("error")).message).toMatch(/your own/);

    grace.ws.close(1000);
    expect((await ada.next("presence")).present.map((u) => u.name)).toEqual(["Ada"]);
    ada.ws.close(1000);
  });

  it("keeps history and pages backwards through it", async () => {
    const token = await signIn("Ada");
    const first = await connect("history", token);
    await first.next("welcome");
    for (let i = 0; i < 3; i++) {
      first.send({ type: "message.create", clientMessageId: `c${i}`, body: `message ${i}` });
      await first.next("message.created");
    }
    first.ws.close(1000);

    const second = await connect("history", token);
    const welcome = await second.next("welcome");
    expect(welcome.messages.map((m) => m.body)).toEqual(["message 0", "message 1", "message 2"]);

    second.send({ type: "history.before", before: welcome.messages[2]!.id, limit: 1 });
    const page = await second.next("history");
    expect(page.messages.map((m) => m.body)).toEqual(["message 1"]);
    expect(page.hasMore).toBe(true);
    second.ws.close(1000);
  });

  it("writes to the configured backend", async () => {
    const { storage } = (await (await exports.default.fetch(`${origin}/api/health`)).json()) as { storage: string };
    const db = (env as { DB?: D1Database }).DB;
    expect(storage).toBe(db ? "d1" : "do-sqlite");
    if (!db) return;

    const room = await connect("d1-check", await signIn("Ada"));
    await room.next("welcome");
    room.send({ type: "message.create", clientMessageId: "c1", body: "stored in D1" });
    await room.next("message.created");
    const row = await db.prepare("SELECT body FROM messages WHERE room_id = ?").bind("d1-check").first();
    expect(row).toEqual({ body: "stored in D1" });
    room.ws.close(1000);
  });
});
