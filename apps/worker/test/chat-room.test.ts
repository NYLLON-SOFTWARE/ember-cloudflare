import type { ServerFrame } from "@ember/protocol";
import { STORED_CLIENT_MESSAGE_IDS } from "../src/store";
import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ChatRoom } from "../src/chat-room";

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
  const log: ServerFrame[] = [];
  const waiters: Array<() => void> = [];
  ws.addEventListener("message", (event) => {
    const frame = JSON.parse(event.data as string) as ServerFrame;
    frames.push(frame);
    log.push(frame);
    waiters.splice(0).forEach((wake) => wake());
  });

  async function next<T extends ServerFrame["type"]>(type: T): Promise<Extract<ServerFrame, { type: T }>> {
    for (;;) {
      const index = frames.findIndex((f) => f.type === type);
      if (index >= 0) return frames.splice(index, 1)[0] as Extract<ServerFrame, { type: T }>;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  }

  return { ws, next, log, send: (frame: object) => ws.send(JSON.stringify(frame)) };
}

async function until(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const roomStub = (room: string) => (env as unknown as { CHAT_ROOM: DurableObjectNamespace<ChatRoom> }).CHAT_ROOM.getByName(room);

/** Runs SQL against a room's storage, whichever backend this suite is using. */
async function roomSql(room: string, query: string, ...params: string[]): Promise<unknown[]> {
  const db = (env as { DB?: D1Database }).DB;
  if (db) return (await db.prepare(query).bind(...params).all()).results;
  return runInDurableObject(roomStub(room), (_room, state: DurableObjectState) => state.storage.sql.exec(query, ...params).toArray());
}

describe("API", () => {
  it("rejects sockets without a valid token", async () => {
    const response = await exports.default.fetch(`${origin}/api/rooms/general/socket?token=forged.token`, {
      headers: { Upgrade: "websocket" },
    });
    expect(response.status).toBe(401);
  });

  it("treats a malformed room path as an unknown room", async () => {
    const token = await signIn("Ada");
    const response = await exports.default.fetch(`${origin}/api/rooms/%FF/socket?token=${token}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(response.status).toBe(404);
  });

  it("rejects sign-ins without a usable name", async () => {
    for (const body of ["null", "not json", "{}", '{"name":"   "}']) {
      const response = await exports.default.fetch(`${origin}/api/session`, { method: "POST", body });
      expect(response.status, body).toBe(422);
    }
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

  it("tells everyone when someone's connection drops without closing", async () => {
    const ada = await connect("dropped", await signIn("Ada"));
    await ada.next("welcome");
    const grace = await connect("dropped", await signIn("Grace"));
    const { you } = await grace.next("welcome");
    await ada.next("presence");

    // A connection that drops, like a phone losing signal, reaches the room as code 1006 with no
    // close frame to answer.
    await runInDurableObject(roomStub("dropped"), async (room, state: DurableObjectState) => {
      const [socket] = state.getWebSockets(you.id);
      await room.webSocketClose(socket!, 1006);
    });
    expect((await ada.next("presence")).present.map((u) => u.name)).toEqual(["Ada"]);
    ada.ws.close(1000);
  });

  it("tells a sender which of their messages it stored", async () => {
    const token = await signIn("Ada");
    const ada = await connect("checking", token);
    await ada.next("welcome");
    const grace = await connect("checking", await signIn("Grace"));
    await grace.next("welcome");
    ada.send({ type: "message.create", clientMessageId: "a1", body: "stored" });
    await ada.next("message.created");
    grace.send({ type: "message.create", clientMessageId: "g1", body: "not Ada's" });
    await ada.next("message.created");

    ada.send({ type: "message.check", clientMessageIds: ["a1", "g1", "lost"] });
    expect(await ada.next("message.checked")).toEqual({ type: "message.checked", stored: ["a1"], missing: ["g1", "lost"] });

    // On D1 every room's messages share one table, so the lookup has to stay in its own room.
    const elsewhere = await connect("checking-elsewhere", token);
    await elsewhere.next("welcome");
    elsewhere.send({ type: "message.check", clientMessageIds: ["a1"] });
    expect(await elsewhere.next("message.checked")).toEqual({ type: "message.checked", stored: [], missing: ["a1"] });
    for (const socket of [ada, grace, elsewhere]) socket.ws.close(1000);
  });

  it("checks a sender's messages through the room's index", async () => {
    const ada = await connect("checking-plan", await signIn("Ada"));
    const { you } = await ada.next("welcome");
    const plan = await roomSql("checking-plan", `EXPLAIN QUERY PLAN ${STORED_CLIENT_MESSAGE_IDS}`, "checking-plan", you.id, '["c1"]');
    // Without it, a check reads every message in the room.
    expect(plan.map((row) => (row as { detail: string }).detail).join("; ")).toContain(
      "index_messages_on_room_id_and_client_message_id (room_id=? AND client_message_id=?)",
    );
    ada.ws.close(1000);
  });

  it("names the messages it couldn't check", async () => {
    // Only a Durable Object's storage can be broken for one room without breaking the tests beside it.
    if ((env as { DB?: D1Database }).DB) return;
    const ada = await connect("check-fails", await signIn("Ada"));
    await ada.next("welcome");
    await runInDurableObject(roomStub("check-fails"), (_room, state: DurableObjectState) => {
      state.storage.sql.exec("ALTER TABLE messages RENAME TO messages_gone");
    });
    ada.send({ type: "message.check", clientMessageIds: ["a1", "a2"] });
    expect(await ada.next("error")).toMatchObject({ failed: "message.check", clientMessageIds: ["a1", "a2"] });
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

  it("sends a joining socket its snapshot before any live frames", async () => {
    const ada = await connect("joining", await signIn("Ada"));
    await ada.next("welcome");
    const graceToken = await signIn("Grace");

    // Ada keeps talking while Grace's socket loads its snapshot.
    const joining = connect("joining", graceToken);
    const bodies = Array.from({ length: 10 }, (_, i) => `joining ${i}`);
    for (const [i, body] of bodies.entries()) {
      ada.send({ type: "message.create", clientMessageId: `j${i}`, body });
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const grace = await joining;
    for (const _ of bodies) await ada.next("message.created");

    const seen = () => {
      const [welcome, ...rest] = grace.log;
      const snapshot = welcome?.type === "welcome" ? welcome.messages.map((m) => m.body) : [];
      return [...snapshot, ...rest.flatMap((f) => (f.type === "message.created" ? [f.message.body] : []))];
    };
    await until(() => grace.log.length > 0);
    expect(grace.log[0]?.type).toBe("welcome");
    await until(() => seen().length >= bodies.length);
    expect(seen()).toEqual(bodies);
    ada.ws.close(1000);
    grace.ws.close(1000);
  });

  it("keeps reactions that land while a message is being edited", async () => {
    const ada = await connect("editing", await signIn("Ada"));
    await ada.next("welcome");
    const grace = await connect("editing", await signIn("Grace"));
    await grace.next("welcome");

    ada.send({ type: "message.create", clientMessageId: "e1", body: "first draft" });
    const { message } = await grace.next("message.created");

    ada.send({ type: "message.update", messageId: message.id, body: "second draft" });
    grace.send({ type: "boost.create", messageId: message.id, content: "🎉" });
    await until(() => ada.log.some((f) => f.type === "message.updated") && ada.log.some((f) => f.type === "boost.created"));

    // Whichever lands second must not undo the first.
    const updatedAt = ada.log.findIndex((f) => f.type === "message.updated");
    const boostedAt = ada.log.findIndex((f) => f.type === "boost.created");
    if (boostedAt < updatedAt) {
      const updated = ada.log[updatedAt] as Extract<ServerFrame, { type: "message.updated" }>;
      expect(updated.message.boosts.map((b) => b.content)).toEqual(["🎉"]);
    }
    ada.ws.close(1000);
    grace.ws.close(1000);
  });

  it("keeps a message's reactions when deleting it fails", async () => {
    const ada = await connect("delete-fails", await signIn("Ada"));
    await ada.next("welcome");
    ada.send({ type: "message.create", clientMessageId: "c1", body: "keep my reactions" });
    const { message } = await ada.next("message.created");
    ada.send({ type: "boost.create", messageId: message.id, content: "👍" });
    await ada.next("boost.created");

    await roomSql(
      "delete-fails",
      `CREATE TRIGGER refuse_deletes BEFORE DELETE ON messages WHEN OLD.room_id = 'delete-fails' BEGIN SELECT RAISE(ABORT, 'refused'); END`,
    );
    ada.send({ type: "message.delete", messageId: message.id });
    expect(await ada.next("error")).toMatchObject({ failed: "message.delete" });
    expect(await roomSql("delete-fails", "SELECT content FROM boosts WHERE message_id = ?", message.id)).toEqual([{ content: "👍" }]);

    await roomSql("delete-fails", "DROP TRIGGER refuse_deletes");
    ada.send({ type: "message.delete", messageId: message.id });
    await ada.next("message.deleted");
    expect(await roomSql("delete-fails", "SELECT content FROM boosts WHERE message_id = ?", message.id)).toEqual([]);
    ada.ws.close(1000);
  });

  it("ignores a reaction the same person already added", async () => {
    const ada = await connect("repeat-boost", await signIn("Ada"));
    await ada.next("welcome");
    ada.send({ type: "message.create", clientMessageId: "c1", body: "react once" });
    const { message } = await ada.next("message.created");

    ada.send({ type: "boost.create", messageId: message.id, content: "👍" });
    ada.send({ type: "boost.create", messageId: message.id, content: "👍" });
    // Frames are handled in order, so once this one lands both reactions have been handled.
    ada.send({ type: "message.create", clientMessageId: "c2", body: "fence" });
    await until(() => ada.log.filter((f) => f.type === "message.created").length === 2);
    expect(ada.log.filter((f) => f.type === "boost.created")).toHaveLength(1);
    ada.ws.close(1000);
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
