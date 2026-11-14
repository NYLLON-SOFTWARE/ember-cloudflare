import { parentTextOf, SCHEDULED_API_PATH, type ListedScheduledMessage, type RoomId, type ScheduledList } from "@ember/protocol";
import { runDurableObjectAlarm } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEDULED_THREAD_GONE } from "../src/chat-room";
import { api, connect, createRoom, freshDeploy, freshRoom, post, roomSql, roomStub, signIn, workspaceSql, type Session, type Socket } from "./support";

// Drafts & sent's Scheduled tab: every message someone has scheduled, across the rooms they're in, which
// each room sends the Workspace as it changes, so the list never asks every room.

const HOUR = 60 * 60 * 1000;

beforeEach(freshDeploy);

const as = (session: Session) => ({ headers: { Cookie: session.cookie } });

/** `session`'s scheduled messages, as `GET /api/scheduled` lists them. */
async function listed(session: Session): Promise<ListedScheduledMessage[]> {
  const response = await api(SCHEDULED_API_PATH, as(session));
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as ScheduledList).messages;
}

/** Waits until `session`'s list is what `expected` says, as the room sends the Workspace its changes a moment after making them. */
async function listedSoon(session: Session, expected: unknown): Promise<void> {
  await vi.waitFor(async () => expect(await listed(session)).toEqual(expected), { timeout: 5_000 });
}

/** Schedules `body` as `client`, answering the message scheduled. */
async function schedule(client: Socket, body: string, sendAt = Date.now() + HOUR, extra: { parentId?: string; alsoSend?: boolean } = {}) {
  const clientMessageId = crypto.randomUUID();
  client.send({ type: "scheduled.create", clientMessageId, body, sendAt, ...extra });
  const { messages } = await client.next("scheduled");
  return messages.find((message) => message.body === body && message.sendAt === sendAt)!;
}

/** Makes every message scheduled in `room` due, and runs the room's alarm. */
async function timeComes(room: RoomId): Promise<void> {
  await roomSql(room, "UPDATE scheduled_messages SET send_at = ? WHERE room_id = ?", Date.now() - 1, room);
  expect(await runDurableObjectAlarm(roomStub(room))).toBe(true);
}

describe("Scheduled messages across rooms", () => {
  it("lists each scheduled message with the start of its text, soonest first, across rooms, and follows it as it's moved", async () => {
    const [general, random] = [await freshRoom("general"), await freshRoom("random")];
    const ada = await connect(general, "Ada");
    const adaInRandom = await connect(random, ada.session);
    const parent = await post(ada, "<p>Plan</p>");
    const long = "word ".repeat(60).trim();

    const later = await schedule(ada, `<p>Good <strong>morning</strong></p>`, Date.now() + 3 * HOUR);
    const reply = await schedule(ada, "<p>On it</p>", Date.now() + 2 * HOUR, { parentId: parent.id });
    const soon = await schedule(adaInRandom, `<p>${long}</p>`, Date.now() + HOUR);
    await listedSoon(ada.session, [
      { id: soon.id, roomId: random, sendAt: soon.sendAt, preview: parentTextOf(long) },
      { id: reply.id, roomId: general, sendAt: reply.sendAt, preview: "On it", parentId: parent.id },
      { id: later.id, roomId: general, sendAt: later.sendAt, preview: "Good morning" },
    ]);
    expect(parentTextOf(long)).toHaveLength(150);

    const sendAt = Date.now() + 4 * HOUR;
    adaInRandom.send({ type: "scheduled.update", id: soon.id, sendAt });
    await adaInRandom.next("scheduled");
    await listedSoon(ada.session, [
      { id: reply.id, roomId: general, sendAt: reply.sendAt, preview: "On it", parentId: parent.id },
      { id: later.id, roomId: general, sendAt: later.sendAt, preview: "Good morning" },
      { id: soon.id, roomId: random, sendAt, preview: parentTextOf(long) },
    ]);
  });

  it("takes a message off the list once it's sent now, deleted or posted when it's due", async () => {
    const room = await freshRoom("scheduled-gone");
    const ada = await connect(room, "Ada");
    const [now, deleted, due] = [await schedule(ada, "<p>Now</p>"), await schedule(ada, "<p>Deleted</p>"), await schedule(ada, "<p>Due</p>", Date.now() + 2 * HOUR)];
    await vi.waitFor(async () => expect(await listed(ada.session)).toHaveLength(3), { timeout: 5_000 });

    ada.send({ type: "scheduled.send", id: now.id });
    await ada.next("message.created");
    ada.send({ type: "scheduled.delete", id: deleted.id });
    await listedSoon(ada.session, [expect.objectContaining({ id: due.id })]);

    await timeComes(room);
    expect((await ada.next("message.created")).message).toMatchObject({ plainText: "Due" });
    await listedSoon(ada.session, []);
    expect(await workspaceSql("SELECT count(*) AS n FROM scheduled_listings")).toEqual([{ n: 0 }]);
    // The room forgets what the Workspace has heard.
    await vi.waitFor(async () => expect(await roomSql(room, "SELECT count(*) AS n FROM scheduled_changes WHERE room_id = ?", room)).toEqual([{ n: 0 }]), { timeout: 5_000 });
  });

  it("lists one the room couldn't post as not sent, saying why", async () => {
    const room = await freshRoom("scheduled-failed");
    const ada = await connect(room, "Ada");
    const doomed = await post(ada, "<p>Old plan</p>");
    const never = await schedule(ada, "<p>Never</p>", Date.now() + HOUR, { parentId: doomed.id });
    ada.send({ type: "message.delete", messageId: doomed.id });
    await ada.next("message.deleted");

    await timeComes(room);
    // Its thread is gone, so it's the room's now.
    await listedSoon(ada.session, [{ id: never.id, roomId: room, sendAt: expect.any(Number) as number, preview: "Never", failed: SCHEDULED_THREAD_GONE }]);
  });

  it("lists only your own, in the rooms you're still in, and forgets a deleted room's", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const kept = await createRoom("kept", { as: ada });
    // One she can leave, as someone who can't change it.
    const left = await createRoom("left", { closedTo: [ada.user.id, grace.user.id], as: grace });
    const [adaInKept, adaInLeft, graceInKept] = [await connect(kept.id, ada), await connect(left.id, ada), await connect(kept.id, grace)];
    const mine = await schedule(adaInKept, "<p>Mine</p>");
    const gone = await schedule(adaInLeft, "<p>Gone</p>");
    const graces = await schedule(graceInKept, "<p>Grace's</p>");
    await listedSoon(grace, [expect.objectContaining({ id: graces.id, preview: "Grace's" })]);
    await vi.waitFor(async () => expect((await listed(ada)).map(({ id }) => id)).toEqual([mine.id, gone.id]), { timeout: 5_000 });

    // The room still keeps it, so it's listed again if she comes back, but not while she's out.
    expect((await api(`/api/rooms/${left.id}/membership`, { method: "DELETE", ...as(ada) })).status).toBe(204);
    expect((await listed(ada)).map(({ id }) => id)).toEqual([mine.id]);

    expect((await api(`/api/rooms/${kept.id}`, { method: "DELETE", ...as(ada) })).status).toBeLessThan(300);
    expect(await listed(ada)).toEqual([]);
    expect(await listed(grace)).toEqual([]);
    expect(await workspaceSql("SELECT id FROM scheduled_listings")).toEqual([{ id: gone.id }]);
  });

  it("answers only someone signed in", async () => {
    expect((await api(SCHEDULED_API_PATH)).status).toBe(401);
  });
});
