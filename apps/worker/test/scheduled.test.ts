import { MAX_SCHEDULE_AHEAD_MS, type RoomId } from "@ember/protocol";
import { runDurableObjectAlarm } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { MESSAGE_GONE, SCHEDULED_AUTHOR_GONE, SCHEDULED_THREAD_GONE } from "../src/chat-room";
import { connect, freshDeploy, freshRoom, post, roomSql, roomStub, settle, workspaceSql, type Socket } from "./support";

// Slack's scheduled messages: kept by the room, listed only to their author, and posted as theirs by the
// room's alarm once they're due, whether or not the author has the room open.

const HOUR = 60 * 60 * 1000;

beforeEach(freshDeploy);

/** Schedules `body` as `client` at `sendAt`, waiting for the list the room tells them of then. */
async function schedule(client: Socket, body: string, sendAt = Date.now() + HOUR, extra: { parentId?: string; alsoSend?: boolean } = {}) {
  client.send({ type: "scheduled.create", clientMessageId: crypto.randomUUID(), body, sendAt, ...extra });
  return (await client.next("scheduled")).messages;
}

/** Makes every message scheduled in `room` due, as if their time had come, and runs the room's alarm. */
async function timeComes(room: RoomId): Promise<void> {
  await roomSql(room, "UPDATE scheduled_messages SET send_at = ? WHERE room_id = ?", Date.now() - 1, room);
  expect(await runDurableObjectAlarm(roomStub(room))).toBe(true);
}

describe("Scheduled messages", () => {
  it("keeps a message to send later, telling only its author's tabs, and posts it as theirs once it's due", async () => {
    const room = await freshRoom("scheduled");
    const [ada, grace] = [await connect(room, "Ada"), await connect(room, "Grace")];
    const sendAt = Date.now() + HOUR;

    const listed = await schedule(ada, "<p>Good morning</p>", sendAt);
    expect(listed).toEqual([{ id: expect.any(String) as string, body: "<p>Good morning</p>", sendAt }]);
    await settle(grace);
    expect(grace.pending("scheduled")).toEqual([]);
    expect(grace.pending("message.created")).toEqual([]);

    // A tab opened later hears of it as it opens, and nobody else's does.
    const adaAgain = await connect(room, ada.session);
    expect((await adaAgain.next("scheduled")).messages).toEqual(listed);
    const lin = await connect(room, "Lin");
    await settle(lin);
    expect(lin.pending("scheduled")).toEqual([]);

    // Ada closes her tabs; the room posts it anyway.
    ada.close();
    adaAgain.close();
    await timeComes(room);
    const { message } = await grace.next("message.created");
    expect(message).toMatchObject({ creator: { id: ada.me.id, name: "Ada" }, plainText: "Good morning" });
    expect(await roomSql(room, "SELECT count(*) AS n FROM scheduled_messages WHERE room_id = ?", room)).toEqual([{ n: 0 }]);
  });

  it("posts a scheduled reply in its thread, and keeps one whose thread's message was deleted, unsent, saying why", async () => {
    const room = await freshRoom("scheduled-replies");
    const ada = await connect(room, "Ada");
    const [parent, doomed] = [await post(ada, "<p>Plan</p>"), await post(ada, "<p>Old plan</p>")];
    await schedule(ada, "<p>Later</p>", undefined, { parentId: parent.id, alsoSend: true });
    const [, never] = await schedule(ada, "<p>Never</p>", Date.now() + 2 * HOUR, { parentId: doomed.id });
    ada.send({ type: "message.delete", messageId: doomed.id });
    await ada.next("message.deleted");

    await timeComes(room);
    const { message } = await ada.next("message.created");
    expect(message).toMatchObject({ parentId: parent.id, alsoSent: true, plainText: "Later" });
    expect((await ada.next("scheduled")).messages).toHaveLength(1);
    // It's the room's now, as its thread is gone, where its author's composer shows it.
    expect((await ada.next("scheduled")).messages).toEqual([{ id: never!.id, body: "<p>Never</p>", sendAt: expect.any(Number) as number, failed: SCHEDULED_THREAD_GONE }]);
    await settle(ada);
    expect(ada.pending("message.created")).toEqual([]);

    // The alarm leaves it be, until its author sends it, to the room.
    expect(await runDurableObjectAlarm(roomStub(room))).toBe(false);
    ada.send({ type: "scheduled.send", id: never!.id });
    const posted = (await ada.next("message.created")).message;
    expect(posted).toMatchObject({ plainText: "Never" });
    expect(posted).not.toHaveProperty("parentId");
    expect((await ada.next("scheduled")).messages).toEqual([]);
  });

  it("moves, sends now and deletes a scheduled message for its author alone", async () => {
    const room = await freshRoom("scheduled-changes");
    const [ada, grace] = [await connect(room, "Ada"), await connect(room, "Grace")];
    const [first] = await schedule(ada, "<p>One</p>", Date.now() + HOUR);
    const [, second] = await schedule(ada, "<p>Two</p>", Date.now() + 2 * HOUR);

    // Nobody else can touch them.
    for (const frame of [{ type: "scheduled.send", id: first!.id }, { type: "scheduled.delete", id: first!.id }, { type: "scheduled.update", id: first!.id, sendAt: Date.now() + HOUR }]) {
      grace.send(frame);
      expect(await grace.next("error")).toMatchObject({ message: "That scheduled message has already been sent or deleted.", failed: frame.type });
    }

    const later = Date.now() + 3 * HOUR;
    ada.send({ type: "scheduled.update", id: first!.id, sendAt: later });
    expect((await ada.next("scheduled")).messages.map(({ id, sendAt }) => ({ id, sendAt }))).toEqual([
      { id: second!.id, sendAt: second!.sendAt },
      { id: first!.id, sendAt: later },
    ]);

    ada.send({ type: "scheduled.send", id: second!.id });
    expect((await grace.next("message.created")).message).toMatchObject({ plainText: "Two", creator: { id: ada.me.id } });
    expect((await ada.next("scheduled")).messages.map(({ id }) => id)).toEqual([first!.id]);

    ada.send({ type: "scheduled.delete", id: first!.id });
    expect((await ada.next("scheduled")).messages).toEqual([]);
    // Sending one that's gone says so.
    ada.send({ type: "scheduled.send", id: first!.id });
    expect(await ada.next("error")).toMatchObject({ failed: "scheduled.send" });
  });

  it("refuses a time that's passed or too far ahead, a body the room can't keep, and a reply to a message it doesn't have", async () => {
    const room = await freshRoom("scheduled-refusals");
    const ada = await connect(room, "Ada");
    for (const sendAt of [Date.now() - 1000, Date.now() + MAX_SCHEDULE_AHEAD_MS + HOUR]) {
      ada.send({ type: "scheduled.create", clientMessageId: "c1", body: "<p>Hi</p>", sendAt });
      expect(await ada.next("error")).toEqual({ type: "error", message: "Pick a time in the next 120 days.", clientMessageId: "c1", failed: "scheduled.create" });
    }
    ada.send({ type: "scheduled.create", clientMessageId: "c2", body: "<p> </p>", sendAt: Date.now() + HOUR });
    expect(await ada.next("error")).toMatchObject({ clientMessageId: "c2", failed: "scheduled.create" });
    ada.send({ type: "scheduled.create", clientMessageId: "c3", body: "<p>Hi</p>", sendAt: Date.now() + HOUR, parentId: "nothing-here" });
    expect(await ada.next("error")).toEqual({ type: "error", message: MESSAGE_GONE, clientMessageId: "c3", failed: "scheduled.create" });
    expect(await roomSql(room, "SELECT count(*) AS n FROM scheduled_messages WHERE room_id = ?", room)).toEqual([{ n: 0 }]);
  });

  it("doesn't post a scheduled message once its author is no longer in the room, or no longer active, keeping it unsent", async () => {
    const room = await freshRoom("scheduled-access");
    const [ada, grace, lin] = [await connect(room, "Ada"), await connect(room, "Grace"), await connect(room, "Lin")];
    await schedule(ada, "<p>From Ada</p>");
    await schedule(grace, "<p>From Grace</p>");
    await workspaceSql("DELETE FROM memberships WHERE room_id = ? AND user_id = ?", room, ada.me.id);
    await workspaceSql("UPDATE users SET status = 1 WHERE id = ?", grace.me.id);

    await timeComes(room);
    await settle(lin);
    expect(lin.pending("message.created")).toEqual([]);
    expect(await roomSql(room, "SELECT body, failed FROM scheduled_messages WHERE room_id = ? ORDER BY body", room)).toEqual([
      { body: "<p>From Ada</p>", failed: SCHEDULED_AUTHOR_GONE },
      { body: "<p>From Grace</p>", failed: SCHEDULED_AUTHOR_GONE },
    ]);
    // Nor is either tried again.
    expect(await runDurableObjectAlarm(roomStub(room))).toBe(false);
  });

  it("sends one that couldn't be posted once its author can post again, and moving it tries it again", async () => {
    const room = await freshRoom("scheduled-retry");
    const [ada, grace] = [await connect(room, "Ada"), await connect(room, "Grace")];
    const [first] = await schedule(ada, "<p>One</p>");
    const [, second] = await schedule(ada, "<p>Two</p>", Date.now() + 2 * HOUR);
    await roomSql(room, "UPDATE scheduled_messages SET failed = ? WHERE room_id = ?", SCHEDULED_AUTHOR_GONE, room);

    ada.send({ type: "scheduled.send", id: first!.id });
    expect((await grace.next("message.created")).message).toMatchObject({ plainText: "One", creator: { id: ada.me.id } });
    expect((await ada.next("scheduled")).messages).toMatchObject([{ id: second!.id, failed: SCHEDULED_AUTHOR_GONE }]);

    const later = Date.now() + 3 * HOUR;
    ada.send({ type: "scheduled.update", id: second!.id, sendAt: later });
    expect((await ada.next("scheduled")).messages).toEqual([{ id: second!.id, body: "<p>Two</p>", sendAt: later }]);
    await timeComes(room);
    expect((await grace.next("message.created")).message).toMatchObject({ plainText: "Two" });
  });

  it("keeps a message scheduled twice with the same client id once, answering what's scheduled", async () => {
    const room = await freshRoom("scheduled-twice");
    const ada = await connect(room, "Ada");
    const frame = { type: "scheduled.create", clientMessageId: "twice", body: "<p>Once</p>", sendAt: Date.now() + HOUR } as const;
    ada.send(frame);
    const [kept] = (await ada.next("scheduled")).messages;
    ada.send(frame);
    expect((await ada.next("scheduled")).messages).toEqual([kept]);
    // Even once it's posted, or its time has passed.
    ada.send({ type: "scheduled.send", id: kept!.id });
    await ada.next("message.created");
    expect((await ada.next("scheduled")).messages).toEqual([]);
    ada.send({ ...frame, sendAt: Date.now() - 1000 });
    expect((await ada.next("scheduled")).messages).toEqual([]);
    await settle(ada);
    expect(ada.pending("error")).toEqual([]);
    expect(await roomSql(room, "SELECT count(*) AS n FROM scheduled_messages WHERE room_id = ?", room)).toEqual([{ n: 0 }]);

    // The index keeps one however it's written.
    await expect(
      roomSql(room, "INSERT INTO scheduled_messages (id, room_id, author_id, client_message_id, body, send_at, created_at) VALUES ('x', ?, ?, 'c', 'b', 1, 'now'), ('y', ?, ?, 'c', 'b', 1, 'now')", room, ada.me.id, room, ada.me.id),
    ).rejects.toThrow(/UNIQUE/);
  });
});
