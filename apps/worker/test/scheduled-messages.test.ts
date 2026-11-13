import {
  CloseCode,
  NOT_IN_ROOM,
  NOT_YOUR_SCHEDULED,
  ROOM_PROTOCOL,
  SCHEDULED_GONE,
  SEND_AT_IN_THE_PAST,
  type RoomId,
} from "@ember/protocol";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { resetNow, setNow } from "../src/clock";
import { api, connect, createRoom, freshRoom, roomSql, roomStub, settle, signIn, upgrade, workspaceSql } from "./support";

afterEach(() => resetNow());

/** Milliseconds since the epoch as this test's clock, moved with `advance`. */
function freezeClock(start = Date.now()): { now: () => number; advance: (ms: number) => void; iso: (ms?: number) => string } {
  let current = start;
  setNow(() => current);
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
    iso: (ms = current) => new Date(ms).toISOString(),
  };
}

const alarmOf = (room: RoomId) => runInDurableObject(roomStub(room), (_room, state: DurableObjectState) => state.storage.getAlarm());

const ring = async (room: RoomId) => expect(await runDurableObjectAlarm(roomStub(room))).toBe(true);

describe("Schedule a message to send later", () => {
  it("holds the message until the clock reaches its send time, then posts it as a normal message", async () => {
    const clock = freezeClock();
    const room = await freshRoom("later");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    const sendAt = clock.iso(clock.now() + 60_000);

    ada.send({ type: "message.schedule", clientMessageId: "c1", body: "<p>After lunch</p>", sendAt });
    const { scheduled } = await ada.next("scheduled.created");
    expect(scheduled).toMatchObject({
      clientMessageId: "c1",
      roomId: room,
      body: "<p>After lunch</p>",
      plainText: "After lunch",
      creator: ada.me,
      sendAt,
    });
    expect(await alarmOf(room)).not.toBeNull();
    await settle(ada, grace);
    expect(grace.pending("scheduled.created")).toEqual([]);
    expect(grace.pending("message.created")).toEqual([]);
    expect((await connect(room, "Linus")).welcome.messages).toEqual([]);

    clock.advance(60_000 - 1);
    await ring(room);
    await settle(ada, grace);
    expect(grace.pending("message.created")).toEqual([]);

    clock.advance(1);
    await ring(room);
    const { message } = await grace.next("message.created");
    expect(message).toMatchObject({
      clientMessageId: "c1",
      roomId: room,
      body: "<p>After lunch</p>",
      plainText: "After lunch",
      creator: ada.me,
      createdAt: clock.iso(),
    });
    expect((await ada.next("message.created")).message).toEqual(message);
    expect(await ada.next("scheduled.sent")).toEqual({ type: "scheduled.sent", scheduledId: scheduled.id });
    expect((await connect(room, "Katherine")).welcome.messages).toEqual([message]);
    expect(await roomSql(room, "SELECT count(*) AS n FROM scheduled_messages WHERE room_id = ?", room)).toEqual([{ n: 0 }]);
  });

  it("drops a waiting message when its author cancels it, so the clock advancing posts nothing", async () => {
    const clock = freezeClock();
    const room = await freshRoom("cancel");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    const sendAt = clock.iso(clock.now() + 60_000);

    ada.send({ type: "message.schedule", clientMessageId: "c1", body: "<p>Never mind</p>", sendAt });
    const { scheduled } = await ada.next("scheduled.created");
    ada.send({ type: "scheduled.cancel", scheduledId: scheduled.id });
    expect(await ada.next("scheduled.cancelled")).toEqual({ type: "scheduled.cancelled", scheduledId: scheduled.id });

    clock.advance(60_000);
    await ring(room);
    await settle(ada, grace);
    expect(ada.pending("message.created")).toEqual([]);
    expect(grace.pending("message.created")).toEqual([]);
    expect((await connect(room, "Linus")).welcome.messages).toEqual([]);
  });

  it("refuses a send time that has already passed, and does not post the message", async () => {
    const clock = freezeClock();
    const ada = await connect(await freshRoom("past"), "Ada");
    ada.send({
      type: "message.schedule",
      clientMessageId: "c1",
      body: "<p>Too late</p>",
      sendAt: clock.iso(clock.now() - 1),
    });
    expect(await ada.next("error")).toEqual({ type: "error", message: SEND_AT_IN_THE_PAST, failed: "message.schedule" });
    await settle(ada);
    expect(ada.pending("message.created")).toEqual([]);
    expect(ada.pending("scheduled.created")).toEqual([]);
  });

  it("lets only the author cancel a waiting message", async () => {
    const clock = freezeClock();
    const room = await freshRoom("author");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    ada.send({ type: "message.schedule", clientMessageId: "c1", body: "<p>Mine</p>", sendAt: clock.iso(clock.now() + 60_000) });
    const { scheduled } = await ada.next("scheduled.created");

    grace.send({ type: "scheduled.cancel", scheduledId: scheduled.id });
    expect(await grace.next("error")).toEqual({ type: "error", message: NOT_YOUR_SCHEDULED, failed: "scheduled.cancel" });
    grace.send({ type: "scheduled.list" });
    expect(await grace.next("scheduled.listed")).toEqual({ type: "scheduled.listed", scheduled: [] });

    ada.send({ type: "scheduled.list" });
    expect((await ada.next("scheduled.listed")).scheduled).toEqual([scheduled]);
    ada.send({ type: "scheduled.cancel", scheduledId: "nope" });
    expect(await ada.next("error")).toEqual({ type: "error", message: SCHEDULED_GONE, failed: "scheduled.cancel" });
  });

  it("drops a waiting message whose author is no longer in the room, so the clock advancing posts nothing", async () => {
    const clock = freezeClock();
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const room = await createRoom("Leads", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const adaSocket = await connect(room.id, ada);
    const graceSocket = await connect(room.id, grace);
    const sendAt = clock.iso(clock.now() + 60_000);

    graceSocket.send({ type: "message.schedule", clientMessageId: "g1", body: "<p>After I left</p>", sendAt });
    const { scheduled } = await graceSocket.next("scheduled.created");
    await workspaceSql("DELETE FROM memberships WHERE room_id = ? AND user_id = ?", room.id, grace.user.id);

    clock.advance(60_000);
    await ring(room.id);
    await settle(adaSocket, graceSocket);
    expect(adaSocket.pending("message.created")).toEqual([]);
    expect(graceSocket.pending("message.created")).toEqual([]);
    expect(graceSocket.pending("scheduled.sent")).toEqual([]);
    expect(graceSocket.pending("scheduled.cancelled")).toEqual([{ type: "scheduled.cancelled", scheduledId: scheduled.id }]);
    expect((await connect(room.id, ada)).welcome.messages).toEqual([]);
    expect(await roomSql(room.id, "SELECT count(*) AS n FROM scheduled_messages WHERE room_id = ?", room.id)).toEqual([{ n: 0 }]);
  });

  it("lets only a member of the room schedule, list or cancel", async () => {
    const clock = freezeClock();
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const room = await createRoom("Leads", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const adaSocket = await connect(room.id, ada);
    const graceSocket = await connect(room.id, grace);
    adaSocket.send({ type: "message.schedule", clientMessageId: "c1", body: "<p>Board only</p>", sendAt: clock.iso(clock.now() + 60_000) });
    const { scheduled } = await adaSocket.next("scheduled.created");

    const linus = await signIn("Linus");
    const response = await api(`/api/rooms/${room.id}/socket?protocol=${ROOM_PROTOCOL}`, upgrade(linus.cookie));
    const ws = response.webSocket;
    if (!ws) {
      expect(response.status).toBeGreaterThanOrEqual(400);
    } else {
      ws.accept();
      expect(await new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)))).toBe(CloseCode.NotFound);
    }

    // Membership gone while the socket is still open: the room asks the Workspace, rather than trusting the socket.
    await workspaceSql("DELETE FROM memberships WHERE room_id = ? AND user_id = ?", room.id, grace.user.id);
    graceSocket.send({ type: "message.schedule", clientMessageId: "c2", body: "<p>After I left</p>", sendAt: clock.iso(clock.now() + 60_000) });
    expect(await graceSocket.next("error")).toEqual({ type: "error", message: NOT_IN_ROOM, failed: "message.schedule" });
    graceSocket.send({ type: "scheduled.list" });
    expect(await graceSocket.next("error")).toEqual({ type: "error", message: NOT_IN_ROOM, failed: "scheduled.list" });
    graceSocket.send({ type: "scheduled.cancel", scheduledId: scheduled.id });
    expect(await graceSocket.next("error")).toEqual({ type: "error", message: NOT_IN_ROOM, failed: "scheduled.cancel" });
  });

  it("lists the author's waiting messages soonest first, and not anyone else's", async () => {
    const clock = freezeClock();
    const room = await freshRoom("list");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    ada.send({ type: "message.schedule", clientMessageId: "c2", body: "<p>Second</p>", sendAt: clock.iso(clock.now() + 120_000) });
    const second = (await ada.next("scheduled.created")).scheduled;
    ada.send({ type: "message.schedule", clientMessageId: "c1", body: "<p>First</p>", sendAt: clock.iso(clock.now() + 60_000) });
    const first = (await ada.next("scheduled.created")).scheduled;
    grace.send({ type: "message.schedule", clientMessageId: "g1", body: "<p>Grace's</p>", sendAt: clock.iso(clock.now() + 30_000) });
    await grace.next("scheduled.created");

    ada.send({ type: "scheduled.list" });
    expect((await ada.next("scheduled.listed")).scheduled.map((item) => item.id)).toEqual([first.id, second.id]);
  });
});
