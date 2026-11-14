import { type DndAnswer, type Involvement, type NewWorkspace, type ProfileAnswer, type RoomId, type WorkspaceServerFrame } from "@ember/protocol";
import { MENTION_CONTENT_TYPE, mentionSgid } from "@ember/richtext";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomEvent } from "../src/room-log";
import type { MessagePush } from "../src/workspace-store";
import {
  api,
  direct,
  freshDeploy,
  freshRoom,
  openWorkspaceSocket,
  pushBrowser,
  signIn,
  type Session,
  workspaceSql,
  workspaceStub,
} from "./support";

// Do not disturb: whoever has hushed their push notifications hears none of a new message, in a room,
// a DM, at @mentions or in a thread, until their hush ends, while their unread marks and involvement
// carry on. pushes.test.ts checks the rest of who gets a push and what one says.

/** Saves a subscription for `session`, at Chrome's push service, at `/fcm/send/<label>`. */
async function subscribe(session: Session, label: string): Promise<string> {
  const { p256dh, auth } = await pushBrowser();
  const endpoint = `https://fcm.googleapis.com/fcm/send/${label}`;
  const response = await api("/api/push-subscriptions", { method: "POST", headers: { Cookie: session.cookie }, body: JSON.stringify({ endpoint, p256dhKey: p256dh, authKey: auth }) });
  expect(response.status, await response.clone().text()).toBe(204);
  return endpoint;
}

/** Gives `session`'s person `involvement` in room `roomId`, as their bell does. */
async function involve(session: Session, roomId: RoomId, involvement: Involvement): Promise<void> {
  const response = await api(`/api/rooms/${roomId}/involvement`, { method: "PUT", headers: { Cookie: session.cookie }, body: JSON.stringify({ involvement }) });
  expect(response.status).toBe(200);
}

/** Signs in as each of `names`, in turn. */
async function people<Names extends string[]>(...names: Names): Promise<{ [K in keyof Names]: Session }> {
  const sessions: Session[] = [];
  for (const name of names) sessions.push(await signIn(name));
  return sessions as { [K in keyof Names]: Session };
}

/** Hushes `session`'s push notifications until `until`, as Do not disturb on their profile asks. */
async function hush(session: Session, until: string): Promise<DndAnswer> {
  const response = await api("/api/users/me/dnd", { method: "PUT", headers: { Cookie: session.cookie }, body: JSON.stringify({ until }) });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as DndAnswer;
}

/** Lets `session`'s push notifications through again, as Do not disturb on their profile asks. */
async function letThrough(session: Session): Promise<DndAnswer> {
  const response = await api("/api/users/me/dnd", { method: "DELETE", headers: { Cookie: session.cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as DndAnswer;
}

/** Makes `session`'s hush, if any, passed, as its last minute would. */
const expired = async (session: Session) => {
  await workspaceSql("UPDATE dnd SET until_at = ? WHERE user_id = ?", Date.now() - 1, session.user.id);
};

/** What the Workspace answers room `room` sending it `events`: the pushes to send. */
const pushesFor = async (room: RoomId, events: RoomEvent[]): Promise<MessagePush[]> =>
  (await workspaceStub().applyRoomEvents(room, events, [])).pushes;

/** Where a message's pushes go, by the labels `subscribe` gave them. */
const labelsOf = (pushes: MessagePush[]) => pushes.flatMap(({ deliveries }) => deliveries.map(({ endpoint }) => endpoint.split("/").at(-1)));

/** How a message mentioning `session`'s person is written. */
const mention = (session: Session) => `<action-text-attachment sgid="${mentionSgid(session.user.id)}" content-type="${MENTION_CONTENT_TYPE}"></action-text-attachment>`;

/** Each room's events are numbered from where the Workspace has applied them, which starts at 0. */
let seq = 0;

/** A new message by `author`, as its room's log sends it to the Workspace, mentioning `mentioned`. */
const message = (author: Session, text: string, ...mentioned: Session[]): RoomEvent => ({
  seq: ++seq,
  kind: "message",
  userId: author.user.id,
  at: new Date().toISOString(),
  message: { id: crypto.randomUUID(), plainText: text, mentionIds: mentioned.map(({ user }) => user.id) },
});

beforeEach(freshDeploy);

describe("Do not disturb", () => {
  it("hushes a room message's push while it lasts, and the next once it has passed, unread marks carrying on", async () => {
    const room = await freshRoom("Designers");
    const [ada, grace] = await people("Ada", "Grace");
    await subscribe(grace, "grace");
    await involve(grace, room, "everything");

    expect(labelsOf(await pushesFor(room, [message(ada, "Before the hush")]))).toEqual(["grace"]);

    const until = new Date(Date.now() + 20 * 60_000).toISOString();
    expect((await hush(grace, until)).dndUntil).toBe(until);
    expect(await pushesFor(room, [message(ada, "While hushed")])).toEqual([]);
    // The room is marked unread all the same, which the badge and the sidebar count on.
    expect(await workspaceSql("SELECT unread_at IS NOT NULL AS unread FROM memberships WHERE room_id = ? AND user_id = ?", room, grace.user.id)).toEqual([{ unread: 1 }]);
    // And involvement is untouched, which the bell shows.
    expect(await workspaceSql("SELECT involvement FROM memberships WHERE room_id = ? AND user_id = ?", room, grace.user.id)).toEqual([{ involvement: "everything" }]);

    await expired(grace);
    expect(labelsOf(await pushesFor(room, [message(ada, "Once it has passed")]))).toEqual(["grace"]);
  });

  it("hushes a mention of someone at @mentions, and a DM's push, each until the hush ends", async () => {
    const room = await freshRoom("Designers");
    const [ada, grace] = await people("Ada", "Grace");
    await subscribe(grace, "grace");
    const dm = await direct(ada, grace);

    await hush(grace, new Date(Date.now() + 60 * 60_000).toISOString());
    // A mention of someone at @mentions, a message in their DM, and a reply there, all hushed.
    expect(await pushesFor(room, [message(ada, "Hey @Grace", grace)])).toEqual([]);
    expect(await pushesFor(dm.id, [message(ada, "In the DM")])).toEqual([]);

    await expired(grace);
    expect(labelsOf(await pushesFor(room, [message(ada, "Hey @Grace", grace)]))).toEqual(["grace"]);
    expect(labelsOf(await pushesFor(dm.id, [message(ada, "In the DM again")]))).toEqual(["grace"]);
  });

  it("keeps one hush per person, which setting it again overwrites and lifting takes away", async () => {
    const room = await freshRoom("Designers");
    const [ada, grace] = await people("Ada", "Grace");
    await subscribe(grace, "grace");
    await involve(grace, room, "everything");

    const later = new Date(Date.now() + 4 * 60 * 60_000).toISOString();
    await hush(grace, new Date(Date.now() + 20 * 60_000).toISOString());
    await hush(grace, later);
    expect(await workspaceSql("SELECT count(*) AS n FROM dnd")).toEqual([{ n: 1 }]);
    expect(await pushesFor(room, [message(ada, "Hushed")])).toEqual([]);

    expect(await letThrough(grace)).toEqual({ dndUntil: null });
    expect(await workspaceSql("SELECT count(*) AS n FROM dnd")).toEqual([{ n: 0 }]);
    expect(labelsOf(await pushesFor(room, [message(ada, "Through again")]))).toEqual(["grace"]);
    // Lifting it again when there's none answers none hushed all the same.
    expect(await letThrough(grace)).toEqual({ dndUntil: null });
  });

  it("tells your own tabs when your hush begins and ends, and nobody else's", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace Hopper");
    const tabs = [await openWorkspaceSocket(ada), await openWorkspaceSocket(ada)];
    const gracesTab = await openWorkspaceSocket(grace);

    const until = new Date(Date.now() + 20 * 60_000).toISOString();
    await hush(ada, until);
    const hushed: WorkspaceServerFrame = { type: "dnd.changed", dndUntil: until };
    for (const tab of tabs) expect(await tab.next()).toEqual(hushed);
    // Grace hears nothing of it, and her tab stays answered.
    expect(await gracesTab.answers()).toBe(true);

    await letThrough(ada);
    const lifted: WorkspaceServerFrame = { type: "dnd.changed", dndUntil: null };
    for (const tab of tabs) expect(await tab.next()).toEqual(lifted);
    expect(await gracesTab.answers()).toBe(true);
  });

  it("says when your push notifications are hushed until, on your profile, as they are then", async () => {
    const grace = await signIn("Grace Hopper");
    const profile = async () => ((await (await api("/api/users/me/profile", { headers: { Cookie: grace.cookie } })).json()) as ProfileAnswer).profile;

    expect((await profile()).dndUntil).toBeNull();
    const until = await hush(grace, new Date(Date.now() + 60 * 60_000).toISOString());
    expect((await profile()).dndUntil).toBe(until.dndUntil);
    await letThrough(grace);
    expect((await profile()).dndUntil).toBeNull();
  });

  it("refuses a hush that isn't a time ahead of now, and one without a session", async () => {
    const grace = await signIn("Grace Hopper");
    const hushAs = (body: unknown, cookie = grace.cookie, method: "PUT" | "DELETE" = "PUT") =>
      api("/api/users/me/dnd", { method, headers: { Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });

    // A hush that isn't a time ahead of now, by the server's own clock, is refused, as is one without a session.
    expect((await hushAs({ until: "soon" })).status).toBe(422);
    expect((await hushAs({ until: "" })).status).toBe(422);
    expect((await hushAs({ until: 1 })).status).toBe(422);
    expect((await hushAs({})).status).toBe(422);
    expect((await hushAs({ until: new Date(Date.now() - 60_000).toISOString() })).status).toBe(422);
    expect(await (await hushAs({ until: "not a time" })).text()).toContain("Until must be a time");
    expect(await (await hushAs({ until: new Date(Date.now() - 60_000).toISOString() })).text()).toContain("Pick a time that hasn't passed yet");
    expect((await hushAs({ until: new Date(Date.now() + 60_000).toISOString() }, "name=none")).status).toBe(401);
    expect((await api("/api/users/me/dnd", { method: "DELETE" })).status).toBe(401);

    // Nothing was kept of the refused hushes.
    expect(await workspaceSql("SELECT count(*) AS n FROM dnd")).toEqual([{ n: 0 }]);
  });
});
