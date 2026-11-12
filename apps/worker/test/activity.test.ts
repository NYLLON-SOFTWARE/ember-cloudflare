import type { ActivityItem, ActivityPage, Message, RoomId, User, WorkspaceServerFrame } from "@ember/protocol";
import { MENTION_CONTENT_TYPE, mentionSgid } from "@ember/richtext";
import { beforeEach, describe, expect, it } from "vitest";
import { timeZoneOf } from "../src/workspace";
import { api, connect, createRoom, direct, freshDeploy, freshRoom, openWorkspaceSocket, post, roomSql, settle, signIn, workspaceSql, type Session, type Socket, type WorkspaceSocket } from "./support";

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
