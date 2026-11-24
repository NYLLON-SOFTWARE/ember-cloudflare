import { threadPath, type Involvement, type NewWorkspace, type RoomId, type SpecialMention, type WorkspaceServerFrame } from "@ember/protocol";
import { REPORTS_PATH } from "@ember/protocol/reports";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPORT_NOTIFICATIONS } from "../src/reports/store";
import type { RoomEvent } from "../src/room-log";
import { INVITATION_NOTIFICATIONS, MESSAGE_NOTIFICATIONS, ROOM_MENTION_NOTIFICATIONS } from "../src/workspace-store";
import {
  api,
  connect,
  cookieOf,
  createRoom,
  direct,
  freshDeploy,
  freshRoom,
  openWorkspaceSocket,
  pauseNotifications,
  shown,
  signIn,
  withWorkspaceEnv,
  workspaceSql,
  workspaceStub,
  type Session,
  type WorkspaceSocket,
} from "./support";

// Notifications for an app that shows them itself, as the desktop app does, where no push service
// reaches: the Workspace sends what a push would say on the workspace sockets the app opens saying so,
// to whom it would push it, whether or not Web Push is on, and on no other socket. pushes.test.ts
// checks whom a push reaches in full, which notifications share.

beforeEach(freshDeploy);

afterEach(() => {
  vi.restoreAllMocks();
});

/** Signs in as each of `names`, in turn. */
async function people<Names extends string[]>(...names: Names): Promise<{ [K in keyof Names]: Session }> {
  const sessions: Session[] = [];
  for (const name of names) sessions.push(await signIn(name));
  return sessions as { [K in keyof Names]: Session };
}

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify({ name: "Ada", emailAddress: "ada@example.com", password: "analytical engine" }) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

/** Gives `session`'s person `involvement` in room `roomId`, as their bell does. */
async function involve(session: Session, roomId: RoomId, involvement: Involvement): Promise<void> {
  const response = await api(`/api/rooms/${roomId}/involvement`, { method: "PUT", headers: { Cookie: session.cookie }, body: JSON.stringify({ involvement }) });
  expect(response.status).toBe(200);
}

/** Has `blocker` block `blocked`, as their Block does. */
async function block(blocker: Session, blocked: Session): Promise<void> {
  const response = await api(`/api/users/${blocked.user.id}/block`, { method: "POST", headers: { Cookie: blocker.cookie } });
  expect(response.status).toBe(200);
}

/** A window of `session`'s in an app that shows notifications itself, hidden unless `visible` says. */
const appOf = (session: Session, visible = false) => openWorkspaceSocket(session, { visible, notifications: true });

/** The next frame of type `type` that `tab` hears, past whatever else it hears first. */
async function nextOf(tab: WorkspaceSocket, type: WorkspaceServerFrame["type"]): Promise<WorkspaceServerFrame> {
  for (;;) {
    const frame = await tab.next();
    if (frame.type === type) return frame;
  }
}

/** The next notification `tab` is sent, past whatever else it hears first. */
const nextNotification = (tab: WorkspaceSocket) => nextOf(tab, "notification");

/** Expects each of `tabs` to have been sent no notification by the time the Workspace answers a ping sent now. */
async function notifiedOfNothing(...tabs: WorkspaceSocket[]): Promise<void> {
  for (const tab of tabs) {
    tab.send(JSON.stringify({ type: "ping", nonce: crypto.randomUUID() }));
    for (;;) {
      const frame = await tab.next();
      expect(frame.type, JSON.stringify(frame)).not.toBe("notification");
      if (frame.type === "pong") break;
    }
  }
}

/** Each room's events are numbered from where the Workspace has applied them, which starts at 0. */
let seq = 0;

/** A new message by `author`, as its room's log sends it to the Workspace, mentioning `mentioned`. */
const message = (author: Session, text: string, ...mentioned: Session[]): RoomEvent & { message: NonNullable<RoomEvent["message"]> } => ({
  seq: ++seq,
  kind: "message",
  userId: author.user.id,
  at: new Date().toISOString(),
  message: { id: crypto.randomUUID(), plainText: text, mentionIds: mentioned.map(({ user }) => user.id) },
});

/** A new message by `author`, as `message` has it, that notifies its room as `notifies` says. */
function notifying(notifies: SpecialMention, author: Session, text: string): RoomEvent {
  const event = message(author, text);
  return { ...event, message: { ...event.message, notifies } };
}

/** Has room `room` send the Workspace `events`, with `viewers` viewing the room. */
const apply = (room: RoomId, events: RoomEvent[], viewers: Session[] = []) => workspaceStub().applyRoomEvents(room, events, viewers.map(({ user }) => user.id));

describe("Notifications of new messages", () => {
  it("sends a new message, as its push reads, to the apps of its room's members who aren't viewing it, at all messages or at @mentions if it mentions them, and to none of their browsers' tabs", async () => {
    const room = await freshRoom("Designers");
    const [ada, grace, lin, hopper, joan, kay] = await people("Ada", "Grace", "Lin", "Hopper", "Joan", "Kay");
    for (const session of [grace, joan]) await involve(session, room, "everything");
    await involve(kay, room, "nothing");
    // Grace has two of the app's windows open, and a browser's tab, where she's pushed it instead.
    const [gracesWindow, gracesOtherWindow, gracesTab] = [await appOf(grace), await appOf(grace, true), await openWorkspaceSocket(grace)];
    const [linsApp, hoppersApp, joansApp, kaysApp, adasApp] = [await appOf(lin), await appOf(hopper), await appOf(joan), await appOf(kay), await appOf(ada)];

    const sent = message(ada, "Hey @Lin @Kay", lin, kay);
    await apply(room, [sent], [joan]);
    const notification = { type: "notification", id: `message:${sent.message.id}`, title: "Designers", body: "Ada: Hey @Lin @Kay", path: `/rooms/${room}` };
    expect(await nextNotification(gracesWindow)).toEqual(notification);
    expect(await nextNotification(gracesOtherWindow)).toEqual(notification);
    expect(await nextNotification(linsApp)).toEqual(notification);
    await notifiedOfNothing(gracesTab, hoppersApp, joansApp, kaysApp, adasApp);
  });

  it("sends a DM's titled with its sender, and a reply in a thread to those following it, opening the thread at the reply", async () => {
    const room = await freshRoom("Designers");
    const [ada, grace] = await people("Ada", "Grace");
    const dm = await direct(ada, grace);
    const gracesApp = await appOf(grace);

    const said = message(ada, "Lunch?");
    await apply(dm.id, [said]);
    expect(await nextNotification(gracesApp)).toEqual({ type: "notification", id: `message:${said.message.id}`, title: "Ada", body: "Lunch?", path: `/rooms/${dm.id}` });

    const parentId = crypto.randomUUID();
    const reply = message(ada, "Agreed");
    await apply(room, [{ ...reply, threadOnly: true, message: { ...reply.message, parentId, followerIds: [grace.user.id] } }]);
    const { id } = reply.message;
    expect(await nextNotification(gracesApp)).toEqual({ type: "notification", id: `message:${id}`, title: "Thread in Designers", body: "Ada: Agreed", path: threadPath(room, parentId, id) });
  });

  it("sends a message whether or not Web Push is on, and once however often its room sends it", async () => {
    const room = await freshRoom("Designers");
    const [ada, grace] = await people("Ada", "Grace");
    await involve(grace, room, "everything");
    const gracesApp = await appOf(grace);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const events = [message(ada, "Once"), message(ada, "Twice")];
    await withWorkspaceEnv({ VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined }, async () => {
      expect((await apply(room, events)).pushes).toEqual([]);
      expect(await nextNotification(gracesApp)).toMatchObject({ body: "Ada: Once" });
      expect(await nextNotification(gracesApp)).toMatchObject({ body: "Ada: Twice" });
    });
    await apply(room, events);
    await apply(room, events.slice(1));
    await notifiedOfNothing(gracesApp);
  });

  it("sends nothing to anyone whose notifications are paused, who has blocked its sender, or who signed in with just a name while EMBER_GUEST_SIGN_IN doesn't let them stay signed in", async () => {
    const ada = await setUp();
    const room = await freshRoom("Designers");
    const [grace, lin, hopper, joan] = await people("Grace", "Lin", "Hopper", "Joan");
    for (const session of [ada, lin, hopper, joan]) await involve(session, room, "everything");
    await pauseNotifications(lin, 60 * 60_000);
    await block(hopper, grace);
    const [adasApp, linsApp, hoppersApp, joansApp] = [await appOf(ada), await appOf(lin), await appOf(hopper), await appOf(joan)];

    await apply(room, [message(grace, "Standup")]);
    expect(await nextNotification(adasApp)).toMatchObject({ body: "Grace: Standup" });
    expect(await nextNotification(joansApp)).toMatchObject({ body: "Grace: Standup" });
    await notifiedOfNothing(linsApp, hoppersApp);

    await withWorkspaceEnv({ EMBER_GUEST_SIGN_IN: undefined }, async () => {
      await apply(room, [message(grace, "Retro")]);
      expect(await nextNotification(adasApp)).toMatchObject({ body: "Grace: Retro" });
      await notifiedOfNothing(joansApp, linsApp, hoppersApp);
    });
  });

  it("sends a message that notifies the room with @channel to everyone in it at @mentions or all messages, as a mention of each of them would be", async () => {
    const room = await freshRoom("Designers");
    const [ada, grace, lin, kay] = await people("Ada", "Grace", "Lin", "Kay");
    await involve(lin, room, "everything");
    await involve(kay, room, "nothing");
    const [gracesApp, linsApp, kaysApp] = [await appOf(grace), await appOf(lin), await appOf(kay)];

    await apply(room, [notifying("channel", ada, "Standup @channel")]);
    expect(await nextNotification(gracesApp)).toMatchObject({ body: "Ada: Standup @channel" });
    expect(await nextNotification(linsApp)).toMatchObject({ body: "Ada: Standup @channel" });
    await notifiedOfNothing(kaysApp);
  });

  it("finds a message's notifications through the memberships' and people's keys", async () => {
    const room = await freshRoom("plans");
    // Which makes the room's tables, on Durable Object SQLite.
    await connect(room, "Ada");
    const planOf = async (query: string, ...params: Array<string | number>) =>
      ((await workspaceSql(`EXPLAIN QUERY PLAN ${query}`, ...params)) as Array<{ detail: string }>).map(({ detail }) => detail).join("; ");
    const shared = [room, "someone", "[]", 1, 1, "2026-11-20T23:30:00.000Z", "2026-11-20T23:29:00.000Z"] as const;

    for (const plan of [await planOf(MESSAGE_NOTIFICATIONS, ...shared, 1, "[]", "[]", '["someone else"]'), await planOf(ROOM_MENTION_NOTIFICATIONS, ...shared, '["someone else"]')]) {
      expect(plan).not.toMatch(/SCAN (rooms|memberships|users|authors)\b/);
    }
    const invitations = await planOf(INVITATION_NOTIFICATIONS, room, "someone", '["someone else"]', 1, "2026-11-20T23:30:00.000Z");
    expect(invitations).not.toMatch(/SCAN (rooms|memberships|users|inviters)\b/);
  });
});

describe("Notifications of invitations into huddles", () => {
  it("sends an invitation to the apps of those invited who have Ember in view nowhere, whether or not Web Push is on, and rings in the others' windows as ever", async () => {
    const { id: room } = await createRoom("Designers");
    const [ada, grace, lin] = await people("Ada", "Grace", "Lin");
    const [gracesApp, linsApp] = [await appOf(grace), await appOf(lin, true)];
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await withWorkspaceEnv({ VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined }, async () => {
      expect(await workspaceStub().inviteToHuddle(room, ada.user.id, [grace.user.id, lin.user.id])).toEqual([]);
    });
    expect(await nextNotification(gracesApp)).toEqual({
      type: "notification",
      id: expect.stringMatching(/^huddle:/) as string,
      title: "Ada",
      body: "Invites you to a huddle in Designers",
      path: `/rooms/${room}`,
    });
    expect(await nextOf(linsApp, "huddle.invited")).toEqual({ type: "huddle.invited", roomId: room, by: ada.user.id });
    await notifiedOfNothing(linsApp);
  });
});

describe("Notifications of reports", () => {
  it("sends a new report to the apps of the active administrators it reaches, but not to anyone who has blocked whoever made it", async () => {
    const ada = await setUp();
    const [grace, lin, joan] = await people("Grace", "Lin", "Joan");
    await workspaceSql("UPDATE users SET role = 1 WHERE id = ?", joan.user.id);
    await block(joan, grace);
    const [adasApp, joansApp, linsApp] = [await appOf(ada), await appOf(joan), await appOf(lin)];

    const response = await api(`/api/users/${lin.user.id}/report`, { method: "POST", headers: { Cookie: grace.cookie }, body: JSON.stringify({ reason: "spam", note: "" }) });
    expect(response.status, await response.clone().text()).toBe(204);
    expect(await nextNotification(adasApp)).toEqual({
      type: "notification",
      id: expect.stringMatching(/^report:/) as string,
      title: "New report",
      body: "Grace reported Lin as spam",
      path: REPORTS_PATH,
    });
    await notifiedOfNothing(joansApp, linsApp);
  });

  it("finds a report's notifications through the people's key", async () => {
    const plan = ((await workspaceSql(`EXPLAIN QUERY PLAN ${REPORT_NOTIFICATIONS}`, "reporter", "subject", "2026-11-20T23:30:00.000Z", '["someone"]')) as Array<{ detail: string }>)
      .map(({ detail }) => detail)
      .join("; ");
    expect(plan).not.toMatch(/SCAN users\b/);
  });
});
