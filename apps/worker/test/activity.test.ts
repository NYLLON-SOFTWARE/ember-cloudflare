import type { ActivityItem, ActivityPage, Message, RoomId, User, WorkspaceServerFrame } from "@ember/protocol";
import { MENTION_CONTENT_TYPE, mentionSgid } from "@ember/richtext";
import { runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { BACKFILL_PER_PERSON, BackfillItems, type BackfillItem, type RoomHistory } from "../src/activity-backfill";
import { timeZoneOf, type Workspace } from "../src/workspace";
import { api, connect, createRoom, direct, freshDeploy, freshRoom, openWorkspaceSocket, post, roomSql, roomStub, settle, signIn, standInForRooms, workspaceSql, workspaceStub, type Session, type Socket, type WorkspaceSocket } from "./support";

// Each person's Activity, as Slack's is: what mentions them, comes in their DMs, replies in threads they
// follow, reacts to their messages or adds them to private rooms, kept once read.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(freshDeploy);

/** How a message mentioning `person` is written. */
const mention = (person: Pick<User, "id">) => `<action-text-attachment sgid="${mentionSgid(person.id)}" content-type="${MENTION_CONTENT_TYPE}"></action-text-attachment>`;

/** Waits until room `room` has nothing left in its log, which it forgets once the Workspace has applied it. */
async function delivered(room: RoomId): Promise<void> {
  while ((await roomSql(room, "SELECT seq FROM room_events WHERE room_id = ?", room)).length > 0) await sleep(5);
}

/** A page of `session`'s Activity. */
async function activityOf(session: Session, before?: number): Promise<ActivityPage> {
  const response = await api(`/api/activity${before ? `?before=${before}` : ""}`, { headers: { Cookie: session.cookie } });
  expect(response.status).toBe(200);
  return response.json();
}

const mark = (session: Session, body: unknown) =>
  api("/api/activity/marks", { method: "POST", headers: { Cookie: session.cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** The Activity frames `tab` hears before a pong, once room `room` has been applied. */
async function heardActivity(tab: WorkspaceSocket, room?: RoomId): Promise<WorkspaceServerFrame[]> {
  if (room) await delivered(room);
  tab.send(JSON.stringify({ type: "ping", nonce: crypto.randomUUID() }));
  const frames: WorkspaceServerFrame[] = [];
  for (let frame = await tab.next(); frame.type !== "pong"; frame = await tab.next()) if (frame.type.startsWith("activity.")) frames.push(frame);
  return frames;
}

/** Replies in `parent`'s thread as `client`, and waits for the room to confirm it. */
async function reply(client: Socket, parent: Pick<Message, "id">, body: string): Promise<Message> {
  const clientMessageId = crypto.randomUUID();
  client.send({ type: "message.create", clientMessageId, body, parentId: parent.id, alsoSend: false });
  for (;;) {
    const { message } = await client.next("message.created");
    if (message.clientMessageId === clientMessageId) return message;
  }
}

const item = (fields: Partial<ActivityItem>) => expect.objectContaining(fields) as ActivityItem;

describe("Activity", () => {
  it("records a mention for the person mentioned, and tells their tabs at once", async () => {
    const room = await freshRoom("mentions");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    const linus = await signIn("Linus");
    const tab = await openWorkspaceSocket(grace);

    const message = await post(ada, `Hey ${mention(grace.user)}, look`);
    const [added] = await heardActivity(tab, room);
    expect(added).toEqual({ type: "activity.added", items: [item({ kind: "mention", roomId: room, messageId: message.id, actorId: ada.me.id, read: false })] });
    expect(await activityOf(grace)).toMatchObject({ unread: 1, more: false, items: [{ kind: "mention", preview: expect.stringContaining("look") }] });
    // Nobody else hears of it, the author included.
    expect((await activityOf(linus)).items).toEqual([]);
    expect((await activityOf(ada.session)).items).toEqual([]);
  });

  it("records @channel, @here and @everyone as a mention of everyone in the room", async () => {
    const room = await freshRoom("everyone");
    const ada = await connect(room, "Ada", { visible: true });
    const [grace, linus] = [await signIn("Grace"), await signIn("Linus")];
    await post(ada, "@channel standup in five");
    await delivered(room);
    for (const person of [grace, linus]) expect((await activityOf(person)).items).toEqual([item({ kind: "mention" })]);
  });

  it("records every message in a DM, and only mentions in rooms otherwise", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const dm = await direct(ada, grace);
    const room = await freshRoom("chatter");
    const adaInDm = await connect(dm.id, ada, { visible: true });
    const adaInRoom = await connect(room, ada, { visible: true });
    await signIn("Grace");
    await post(adaInDm, "lunch?");
    await post(adaInRoom, "just chatting");
    await Promise.all([delivered(dm.id), delivered(room)]);
    expect((await activityOf(grace)).items).toEqual([item({ kind: "direct", roomId: dm.id, preview: "lunch?" })]);
  });

  it("records a reply for those following its thread, and marks read whoever's viewing it", async () => {
    const room = await freshRoom("threads");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await connect(room, "Grace", { visible: false });
    const parent = await post(grace, "a question");
    await delivered(room);
    await reply(ada, parent, "an answer");
    await delivered(room);
    expect((await activityOf(grace.session)).items).toEqual([item({ kind: "thread", parentId: parent.id, actorId: ada.me.id, read: false })]);
  });

  it("marks a room's mentions read when it's opened, but leaves them in the feed", async () => {
    const room = await freshRoom("reading");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    const tab = await openWorkspaceSocket(grace);
    await post(ada, `${mention(grace.user)} ping`);
    const [added] = (await heardActivity(tab, room)) as Array<Extract<WorkspaceServerFrame, { type: "activity.added" }>>;

    const reading = await connect(room, grace, { visible: true });
    await settle(reading);
    expect(await heardActivity(tab, room)).toEqual([{ type: "activity.marked", ids: [added!.items[0]!.id], read: true }]);
    expect(await activityOf(grace)).toMatchObject({ unread: 0, items: [{ read: true }] });
  });

  it("marks items read and unread, one at a time or all at once, telling every tab", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const dm = await direct(ada, grace);
    const adaInDm = await connect(dm.id, ada, { visible: true });
    await post(adaInDm, "one");
    await post(adaInDm, "two");
    await delivered(dm.id);
    const [newer, older] = (await activityOf(grace)).items;
    const tab = await openWorkspaceSocket(grace);

    expect((await mark(grace, { ids: [older!.id], read: true })).status).toBe(204);
    expect(await heardActivity(tab)).toEqual([{ type: "activity.marked", ids: [older!.id], read: true }]);
    expect((await activityOf(grace)).unread).toBe(1);

    expect((await mark(grace, { ids: [older!.id], read: false })).status).toBe(204);
    expect((await activityOf(grace)).unread).toBe(2);

    expect((await mark(grace, { all: true, read: true })).status).toBe(204);
    expect(await heardActivity(tab)).toEqual([
      { type: "activity.marked", ids: [older!.id], read: false },
      { type: "activity.marked", ids: null, read: true },
    ]);
    expect(await activityOf(grace)).toMatchObject({ unread: 0, items: [{ id: newer!.id, read: true }, { id: older!.id, read: true }] });

    // Someone else's items are left as they are.
    expect((await mark(ada, { ids: [newer!.id], read: false })).status).toBe(204);
    expect((await activityOf(grace)).unread).toBe(0);
    expect((await mark(grace, { ids: [], read: true })).status).toBe(422);
    expect((await api("/api/activity/marks", { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("records a reaction for the message's author, and takes it back with the reaction", async () => {
    const room = await freshRoom("reactions");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await connect(room, "Grace", { visible: true });
    const message = await post(ada, "shipped it");
    grace.send({ type: "boost.create", messageId: message.id, content: "🎉" });
    const { boost } = await grace.next("boost.created");
    await sleep(50);
    expect((await activityOf(ada.session)).items).toEqual([item({ kind: "reaction", content: "🎉", messageId: message.id, actorId: grace.me.id, preview: "shipped it" })]);

    grace.send({ type: "boost.delete", boostId: boost.id });
    await grace.next("boost.deleted");
    await sleep(50);
    expect((await activityOf(ada.session)).items).toEqual([]);
  });

  it("takes a deleted message's items out of everyone's Activity", async () => {
    const room = await freshRoom("deleting");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    const message = await post(ada, `${mention(grace.user)} oops`);
    await delivered(room);
    expect((await activityOf(grace)).items).toHaveLength(1);
    ada.send({ type: "message.delete", messageId: message.id });
    await ada.next("message.deleted");
    await sleep(50);
    expect((await activityOf(grace)).items).toEqual([]);
  });

  it("has everyone's items about an edited message say what it says now, telling their tabs, keeping nothing edited out", async () => {
    const room = await freshRoom("editing");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await connect(room, "Grace", { visible: false });
    const tab = await openWorkspaceSocket(grace.session);
    const message = await post(ada, `${mention(grace.me)} my password is hunter2`);
    await heardActivity(tab, room);
    grace.send({ type: "boost.create", messageId: message.id, content: "🙈" });
    await grace.next("boost.created");
    await sleep(50);

    ada.send({ type: "message.update", messageId: message.id, body: `${mention(grace.me)} (redacted)` });
    await ada.next("message.updated");
    await sleep(50);
    const [updated] = await heardActivity(tab);
    expect(updated).toEqual({ type: "activity.updated", items: [item({ kind: "mention", messageId: message.id, preview: expect.stringContaining("(redacted)") })] });
    const [mentioned] = (await activityOf(grace.session)).items;
    expect(mentioned!.preview).toContain("(redacted)");
    expect(mentioned!.preview).not.toContain("hunter2");
    // The author's reaction items say it too, and nobody's still holds the old text.
    expect((await activityOf(ada.session)).items).toEqual([item({ kind: "reaction", preview: expect.stringContaining("(redacted)") })]);
    expect(await workspaceSql("SELECT id FROM activity WHERE preview LIKE '%hunter2%'")).toEqual([]);
  });

  it("records an invitation for whoever's added to a private room, but not its creator", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const tab = await openWorkspaceSocket(grace);
    const room = await createRoom("Plans", { closedTo: [ada.user.id, grace.user.id], as: ada });
    expect(await heardActivity(tab)).toEqual([{ type: "activity.added", items: [item({ kind: "invitation", roomId: room.id, actorId: ada.user.id, messageId: null })] }]);
    expect((await activityOf(ada)).items).toEqual([]);
    // An open room adds everyone, which is no invitation.
    await createRoom("Everyone", { as: ada });
    expect(await heardActivity(tab)).toEqual([]);
  });

  it("leaves out the items of rooms its person is no longer in", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await createRoom("Plans", { closedTo: [ada.user.id, grace.user.id], as: ada });
    expect((await activityOf(grace)).items).toHaveLength(1);
    await workspaceSql("DELETE FROM memberships WHERE room_id = ? AND user_id = ?", room.id, grace.user.id);
    expect(await activityOf(grace)).toEqual({ items: [], unread: 0, more: false });
  });

  it("tells nobody out of a private room what its messages say once edited, and keeps nothing of theirs about it", async () => {
    const [adaSession, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await createRoom("Plans", { closedTo: [adaSession.user.id, grace.user.id], as: adaSession });
    const ada = await connect(room.id, adaSession, { visible: true });
    const tab = await openWorkspaceSocket(grace);
    const message = await post(ada, `${mention(grace.user)} the plan is`);
    await heardActivity(tab, room.id);
    // As if they'd left before anything took their items out.
    await workspaceSql("DELETE FROM memberships WHERE room_id = ? AND user_id = ?", room.id, grace.user.id);

    ada.send({ type: "message.update", messageId: message.id, body: `${mention(grace.user)} the plan is hunter2` });
    await ada.next("message.updated");
    await sleep(50);
    expect(await heardActivity(tab)).toEqual([]);
    expect(await workspaceSql("SELECT id FROM activity WHERE user_id = ? AND message_id = ?", grace.user.id, message.id)).toEqual([]);
  });

  it("takes a private room's items out of the Activity of whoever's taken out of it, telling their tabs, and edits reach none of them", async () => {
    const [adaSession, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const room = await createRoom("Plans", { closedTo: [adaSession.user.id, grace.user.id, linus.user.id], as: adaSession });
    const ada = await connect(room.id, adaSession, { visible: true });
    const tab = await openWorkspaceSocket(grace);
    const message = await post(ada, `${mention(grace.user)} ${mention(linus.user)} the plan is`);
    await heardActivity(tab, room.id);
    const graceItems = (await activityOf(grace)).items.map((item) => item.id);
    expect(graceItems).toHaveLength(2);

    const changed = await api(`/api/rooms/${room.id}`, { method: "PATCH", headers: { Cookie: adaSession.cookie }, body: JSON.stringify({ kind: "closed", memberIds: [adaSession.user.id, linus.user.id] }) });
    expect(changed.status).toBe(200);
    expect(await heardActivity(tab)).toEqual([{ type: "activity.removed", ids: expect.arrayContaining(graceItems) }]);
    expect(await workspaceSql("SELECT id FROM activity WHERE user_id = ?", grace.user.id)).toEqual([]);

    ada.send({ type: "message.update", messageId: message.id, body: `${mention(grace.user)} ${mention(linus.user)} the plan is hunter2` });
    await ada.next("message.updated");
    await sleep(50);
    expect(await heardActivity(tab)).toEqual([]);
    // Who's still in it sees it as it is now.
    expect((await activityOf(linus)).items).toContainEqual(item({ kind: "mention", preview: expect.stringContaining("hunter2") }));
  });

  it("takes a sub-room's items out of the Activity of whoever leaves its parent, and edits there reach none of them", async () => {
    const [adaSession, grace] = [await signIn("Ada"), await signIn("Grace")];
    const strata = await createRoom("Strata", { closedTo: [adaSession.user.id, grace.user.id], as: adaSession });
    const created = await api("/api/rooms", {
      method: "POST",
      headers: { Cookie: adaSession.cookie },
      body: JSON.stringify({ kind: "closed", name: "Ops", memberIds: [adaSession.user.id, grace.user.id], parentId: strata.id }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const { room: ops } = (await created.json()) as { room: { id: RoomId } };
    const ada = await connect(ops.id, adaSession, { visible: true });
    const tab = await openWorkspaceSocket(grace);
    const message = await post(ada, `${mention(grace.user)} the plan is`);
    await heardActivity(tab, ops.id);
    expect((await activityOf(grace)).items).toContainEqual(item({ kind: "mention", roomId: ops.id }));

    const left = await api(`/api/rooms/${strata.id}/membership`, { method: "DELETE", headers: { Cookie: grace.cookie } });
    expect(left.status).toBeLessThan(300);
    expect(await heardActivity(tab)).toEqual([{ type: "activity.removed", ids: expect.any(Array) }]);
    expect(await workspaceSql("SELECT id FROM activity WHERE user_id = ?", grace.user.id)).toEqual([]);

    ada.send({ type: "message.update", messageId: message.id, body: `${mention(grace.user)} the plan is hunter2` });
    await ada.next("message.updated");
    await sleep(50);
    expect(await heardActivity(tab)).toEqual([]);
    expect(await workspaceSql("SELECT id FROM activity WHERE preview LIKE '%hunter2%' AND user_id = ?", grace.user.id)).toEqual([]);
  });

  it("pages its items, newest first", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const dm = await direct(ada, grace);
    const adaInDm = await connect(dm.id, ada, { visible: true });
    for (let n = 0; n < 52; n++) await post(adaInDm, `message ${n}`);
    await delivered(dm.id);
    const first = await activityOf(grace);
    expect(first).toMatchObject({ unread: 52, more: true });
    expect(first.items).toHaveLength(50);
    expect(first.items[0]!.preview).toBe("message 51");
    const second = await activityOf(grace, first.items.at(-1)!.id);
    expect(second).toMatchObject({ more: false, items: [{ preview: "message 1" }, { preview: "message 0" }] });
  });

  it("answers 401 without a session", async () => {
    expect((await api("/api/activity")).status).toBe(401);
  });
});

/** Has the Workspace forget that it has filled in Activity, as a new object with no storage would. */
async function forgetBackfill(): Promise<void> {
  await runInDurableObject(workspaceStub(), async (instance: Workspace, state: DurableObjectState) => {
    (instance as unknown as { activityBackfill: Promise<void> | null }).activityBackfill = null;
    await state.storage.delete(["activityBackfilled", "activityBackfilledRooms"]);
  });
}

describe("Activity's backfill", () => {
  it("fills in what came before Activity began, already read, after everything recorded since", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const dm = await direct(ada, grace);
    const room = await freshRoom("history");
    const adaInDm = await connect(dm.id, ada, { visible: true });
    const adaInRoom = await connect(room, ada, { visible: true });
    const graceInRoom = await connect(room, grace, { visible: false });
    await post(adaInDm, "lunch?");
    await post(adaInRoom, `${mention(grace.user)} look`);
    const thought = await post(graceInRoom, "a thought");
    await reply(adaInRoom, thought, "agreed");
    adaInRoom.send({ type: "boost.create", messageId: thought.id, content: "👍" });
    await adaInRoom.next("boost.created");
    await post(adaInRoom, "just chatting");
    await Promise.all([delivered(dm.id), delivered(room)]);
    await sleep(50);
    // As before Activity began.
    await workspaceSql("DELETE FROM activity");

    const page = await activityOf(grace);
    expect(page.unread).toBe(0);
    expect(page.items).toEqual([
      item({ kind: "reaction", messageId: thought.id, actorId: ada.user.id, content: "👍", preview: "a thought", read: true }),
      item({ kind: "thread", parentId: thought.id, preview: "agreed", read: true }),
      item({ kind: "mention", roomId: room, read: true }),
      item({ kind: "direct", roomId: dm.id, preview: "lunch?", read: true }),
    ]);
    expect(page.items.every((filled) => filled.id < 0)).toBe(true);
    // Older pages follow on below zero.
    expect((await activityOf(grace, page.items[1]!.id)).items.map((filled) => filled.id)).toEqual(page.items.slice(2).map((filled) => filled.id));

    // What comes now is recorded above it.
    const later = await post(adaInRoom, `${mention(grace.user)} again`);
    await delivered(room);
    expect((await activityOf(grace)).items[0]).toEqual(item({ messageId: later.id, read: false }));
  });

  it("fills in only the rooms each person is in now, so nothing comes from a private room they've left", async () => {
    const [ada, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const plans = await createRoom("Plans", { closedTo: [ada.user.id, grace.user.id, linus.user.id], as: ada });
    const adaInPlans = await connect(plans.id, ada, { visible: true });
    await post(adaInPlans, `${mention(grace.user)} ${mention(linus.user)} the plan is`);
    await delivered(plans.id);
    await workspaceSql("DELETE FROM memberships WHERE room_id = ? AND user_id = ?", plans.id, grace.user.id);
    await workspaceSql("DELETE FROM activity");

    expect((await activityOf(grace)).items).toEqual([]);
    expect((await activityOf(linus)).items).toEqual([item({ kind: "mention", roomId: plans.id, read: true })]);
  });

  it("records nothing twice, run again or beside what was recorded as it came", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await freshRoom("again");
    const adaInRoom = await connect(room, ada, { visible: true });
    await post(adaInRoom, `${mention(grace.user)} before`);
    await delivered(room);
    await workspaceSql("DELETE FROM activity");
    const [filled] = (await activityOf(grace)).items;
    expect(filled!.id).toBeLessThan(0);

    const recorded = await post(adaInRoom, `${mention(grace.user)} after`);
    await delivered(room);
    await forgetBackfill();
    const items = (await activityOf(grace)).items;
    expect(items.map((each) => each.id)).toEqual([expect.any(Number), filled!.id]);
    expect(items[0]).toEqual(item({ messageId: recorded.id, read: false }));
    expect(items[0]!.id).toBeGreaterThan(0);
  });

  it("keeps each person's newest items, however many one room has", () => {
    const at = (second: number) => new Date(Date.UTC(2026, 10, 1) + second * 1000).toISOString();
    // 300 people, each mentioned in 667 @everyone messages: more items than one call takes as arguments.
    const many: BackfillItem[] = Array.from({ length: 200_100 }, (_, index) => ({
      userId: `u${index % 300}`, kind: "mention", roomId: "general", messageId: `m${Math.floor(index / 300)}`, parentId: null, actorId: "ada", preview: "", content: null, at: at(Math.floor(index / 300)),
    }));
    expect(() => [].push(...(many as never[]))).toThrow(RangeError);
    const items = new BackfillItems();
    items.add(many);
    items.add([{ ...many[0]!, userId: "linus" }]);
    const kept = items.newest();
    const theirs = kept.filter((each) => each.userId === "u7").map((each) => each.messageId);
    expect(theirs).toHaveLength(BACKFILL_PER_PERSON);
    expect([theirs.at(0), theirs.at(-1)]).toEqual([`m${667 - BACKFILL_PER_PERSON}`, "m666"]);
    expect(kept.filter((each) => each.userId === "linus")).toHaveLength(1);
  });

  it("doesn't bring back a message deleted or edited while it's under way", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await freshRoom("racing");
    const adaInRoom = await connect(room, ada, { visible: true });
    const gone = await post(adaInRoom, `${mention(grace.user)} delete me`);
    const changed = await post(adaInRoom, `${mention(grace.user)} first draft`);
    await delivered(room);
    await workspaceSql("DELETE FROM activity");
    // The room answers as it was before either changed, once both have.
    const before = await roomStub(room).activityHistory(room as RoomId, new Date(Date.now() - 86_400_000).toISOString());
    // Flags, not promises, which can't settle across Durable Objects.
    const held = { asked: false, answered: false };
    const restore = await standInForRooms({
      activityHistory: async () => {
        held.asked = true;
        while (!held.answered) await sleep(10);
        return before;
      },
    });
    try {
      const page = activityOf(grace);
      await expect.poll(() => held.asked).toBe(true);
      adaInRoom.send({ type: "message.delete", messageId: gone.id });
      await adaInRoom.next("message.deleted");
      adaInRoom.send({ type: "message.update", messageId: changed.id, body: `${mention(grace.user)} second draft` });
      await adaInRoom.next("message.updated");
      await sleep(200);
      held.answered = true;
      expect((await page).items).toEqual([item({ messageId: changed.id, preview: expect.stringContaining("second draft"), read: true })]);
    } finally {
      await restore();
    }
  });
});

describe("Time zones", () => {
  it("keeps only a zone the runtime knows", () => {
    expect(timeZoneOf("Europe/Paris")).toBe("Europe/Paris");
    for (const zone of [null, "", "Mars/Olympus", "x".repeat(65)]) expect(timeZoneOf(zone), String(zone)).toBeNull();
  });

  it("saves the zone a tab's socket names, which someone's page then gives", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const response = await api("/api/socket?tz=Asia%2FTokyo", { headers: { Upgrade: "websocket", Cookie: ada.cookie, Origin: "https://ember.test" } });
    response.webSocket!.accept();
    await sleep(50);
    const person = (await (await api(`/api/users/${ada.user.id}`, { headers: { Cookie: grace.cookie } })).json()) as { person: { timeZone: string | null } };
    expect(person.person.timeZone).toBe("Asia/Tokyo");
  });
});
