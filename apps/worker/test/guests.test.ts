import { type Directory, type DirectoryUser, type Me, type RoomGuest, type RoomId, type RoomSettings, CloseCode } from "@ember/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewWorkspace } from "@ember/protocol";
import { runInDurableObject } from "cloudflare:test";
import {
  api,
  apiWith,
  cookieOf,
  createRoom,
  freshDeploy,
  openWorkspaceSocket,
  signIn,
  shown,
  startUpload,
  upgrade,
  workspaceSql,
  workspaceStub,
  type Session,
} from "./support";

// Guests of one room: an administrator adds a guest to exactly one room, with a stay that ends, and the
// guest signs in with just that name. Their access is the one room, which every check a member goes
// through asks, so their other rooms refuse them the way a stranger's do, and their sessions refuse
// once the stay has passed, as the Workspace's alarm lapses it. The guests of the open sign-in
// (EMBER_GUEST_SIGN_IN) have no stay, and keep the whole workspace the flag gives them.

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };

/** What the Worker answers a room someone can't open, whether it's missing or they aren't in it. */
const ROOM_NOT_FOUND = "Room not found or inaccessible";

/** A week ahead, as the picker's span gives it. */
const inAWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

/** Adds a guest named `name` to room `roomId`, whose stay ends at `until`, as its settings ask. */
const addGuestAs = (session: Session, roomId: RoomId, body: unknown) =>
  api(`/api/rooms/${roomId}/guests`, { method: "POST", headers: { Cookie: session.cookie }, body: JSON.stringify(body) });

/** Adds a guest named `name` whose stay ends in a week, answering them as the room's settings mark them. */
async function addGuest(session: Session, roomId: RoomId, name: string): Promise<RoomGuest> {
  const response = await addGuestAs(session, roomId, { name, until: inAWeek() });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { guest: RoomGuest }).guest;
}

/** Signs in with just a name, as a guest of one room does, with `changes` to the deploy's settings. */
const signInByName = (name: string, changes: Record<string, string | undefined> = {}) =>
  apiWith({ EMBER_GUEST_SIGN_IN: undefined, ...changes }, "/api/session", { method: "POST", body: JSON.stringify({ name }) });

/** Signs in with just a name, answering the session, whether or not guests may stay signed in. */
async function guestSession(name: string, guests = false): Promise<Session> {
  const response = await signInByName(name, { EMBER_GUEST_SIGN_IN: guests ? "true" : undefined });
  expect(response.status, await response.clone().text()).toBe(201);
  return { user: shown(((await response.json()) as { user: Me }).user), cookie: cookieOf(response) };
}

/** Room `roomId`'s settings, as `session` sees them. */
const settingsOf = (session: Session, roomId: RoomId) =>
  api(`/api/rooms/${roomId}/settings`, { headers: { Cookie: session.cookie } });

/** The people directory `session` is given. */
const directoryOf = async (session: Session): Promise<DirectoryUser[]> => ((await (await api("/api/users", { headers: { Cookie: session.cookie } })).json()) as Directory).users;

/** The sidebar `session` is given. */
const sidebarOf = async (session: Session) => (await (await api("/api/sidebar", { headers: { Cookie: session.cookie } })).json()) as { rooms: Array<{ id: RoomId }> };

/** Whether room `roomId`'s socket opens for `session`, or how it closes. */
async function opened(roomId: RoomId, session: Session): Promise<"welcome" | number> {
  const response = await api(`/api/rooms/${roomId}/socket`, upgrade(session.cookie));
  const ws = response.webSocket;
  if (!ws) return response.status;
  ws.accept();
  return new Promise((resolve) => {
    ws.addEventListener("message", () => {
      resolve("welcome");
      ws.close(1000);
    });
    ws.addEventListener("close", (event) => resolve(event.code));
  });
}

/** Makes `userId`'s stay, if they have one, passed, as its last minute would. */
const expire = async (userId: string) => {
  await workspaceSql("UPDATE guest_stays SET until_at = ? WHERE user_id = ?", Date.now() - 1, userId);
};

/** Runs the Workspace's alarm, as the runtime does once it's due, lapsing the stays it finds passed. */
async function runAlarm(): Promise<void> {
  await runInDurableObject(workspaceStub(), async (workspaceInstance, state) => {
    // The runtime clears an alarm as it runs it.
    await state.storage.deleteAlarm();
    await workspaceInstance.alarm();
  });
}

/** Whether the browser with `cookie` is still signed in. */
const signedIn = async (session: Session) => (await api("/api/me", { headers: { Cookie: session.cookie } })).status === 200;

/** Whom the directory `session` is given lists `userId` as. */
const listedAs = async (session: Session, userId: string): Promise<DirectoryUser | undefined> => (await directoryOf(session)).find((person) => person.id === userId);

/** Waits for the Workspace's outbox to have told every room whose sockets to close. */
const revoked = () => vi.waitFor(async () => expect(await workspaceSql("SELECT * FROM pending_revocations")).toEqual([]), { timeout: 5_000 });

beforeEach(freshDeploy);

describe("Adding a guest", () => {
  it("adds a guest of one room, who is in it and its people list marks, and nobody else hears a room of it", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    const other = await createRoom("Everyone");

    const guest = await addGuest(host, room, "Pat");
    expect(guest.name).toBe("Pat");

    // The room's settings mark them in its people list, and its people alone.
    const settings = (await (await settingsOf(host, room)).json()) as RoomSettings;
    const pat = settings.people.find((person) => person.id === guest.userId)!;
    expect(pat.member).toBe(true);
    expect(pat.guestUntil).toBeTypeOf("string");
    expect(settings.people.find((person) => person.id === host.user.id)?.guestUntil).toBeUndefined();
    // Only their one membership was made, though an open room everyone's in exists already.
    const memberships = (await workspaceSql("SELECT room_id FROM memberships WHERE user_id = ?", guest.userId)) as Array<{ room_id: RoomId }>;
    expect(memberships).toEqual([{ room_id: room }]);
    expect(await workspaceSql("SELECT room_id, until_at > 0 AS until FROM guest_stays WHERE user_id = ?", guest.userId)).toEqual([{ room_id: room, until: 1 }]);
  });

  it("refuses a guest for whoever can't change the room, a name one of its guests stays under, an agent's, or a time that has passed", async () => {
    const host = await setUp();
    const member = await signIn("Grace");
    const room = (await createRoom("Designers", { closedTo: [host.user.id, member.user.id] })).id;
    await createRoom("Everyone");

    expect((await addGuestAs(member, room, { name: "Pat", until: inAWeek() })).status).toBe(403);
    await addGuest(host, room, "Pat");
    const taken = await addGuestAs(host, room, { name: "pat", until: inAWeek() });
    expect(taken.status).toBe(422);
    expect(await taken.json()).toEqual({ error: "pat is already one of this room's guests" });
    const reserved = await addGuestAs(host, room, { name: "Ember", until: inAWeek() });
    expect(reserved.status).toBe(422);
    const passed = await addGuestAs(host, room, { name: "Linus", until: new Date(Date.now() - 60_000).toISOString() });
    expect(passed.status).toBe(422);
    expect(await passed.json()).toEqual({ error: "Pick a time that hasn't passed yet" });
    for (const body of [{ name: "", until: inAWeek() }, { name: "Linus", until: "soon" }, { until: inAWeek() }, { name: "Linus" }, "guest"]) {
      expect((await addGuestAs(host, room, body)).status).toBe(422);
    }
    // A room that isn't theirs, like one that doesn't exist, is heard the same way.
    expect((await addGuestAs(host, "nowhere", { name: "Linus", until: inAWeek() })).status).toBe(404);
    // Nothing was added that wasn't a guest.
    expect(((await workspaceSql("SELECT count(*) AS n FROM guest_stays")) as Array<{ n: number }>)[0]!.n).toBe(1);
  });

  it("says why adding failed to whoever has no session", async () => {
    await setUp();
    const room = (await createRoom("Designers")).id;
    expect((await addGuestAs({ user: { id: "x", name: "X" }, cookie: "session_token=forged" }, room, { name: "Pat", until: inAWeek() })).status).toBe(401);
  });
});

describe("Signing in", () => {
  it("signs a guest of one room in by their stay's name, whether or not guests may stay signed in", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    const { userId } = await addGuest(host, room, "Pat Doe");

    // The flag is off, as a members workspace keeps it, and the name alone is still their way in.
    const guest = await guestSession("Pat Doe");
    expect(guest.user.id).toBe(userId);
    // Their sidebar has their room and nothing else, and their directory its people and nobody else's.
    expect((await sidebarOf(guest)).rooms.map((room) => room.id)).toEqual([room]);
    const people = await directoryOf(guest);
    expect(people.map((person) => person.id).sort()).toEqual([host.user.id, userId].sort());
    // A name with different capitals and spaces signs the same guest in, as names compare.
    const again = await guestSession("  pat doe ");
    expect(again.user.id).toBe(userId);
  });

  it("refuses just any name while guests may not stay signed in, and adds someone new while they may", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    const { userId } = await addGuest(host, room, "Pat");

    const refused = await signInByName("Stranger");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "Signing in with just a name is turned off" });

    // With the flag on, a name that isn't a stay's adds someone new, as it always did, and a stay's
    // name still signs the same guest in.
    const newcomer = await guestSession("Stranger", true);
    expect(newcomer.user.id).not.toBe(userId);
    const pat = await guestSession("Pat", true);
    expect(pat.user.id).toBe(userId);
  });

  it("says a stay that has passed is no way in, while just any name stays turned off", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    const { userId } = await addGuest(host, room, "Pat");
    await expire(userId);
    const refused = await signInByName("Pat");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "Signing in with just a name is turned off" });
    // With the flag on, the name is free again, as someone new's, once their stay has passed.
    const newcomer = await guestSession("Pat", true);
    expect(newcomer.user.id).not.toBe(userId);
  });
});

describe("One room, and nothing else", () => {
  let host: Session;
  let room: RoomId;
  let other: RoomId;
  let guest: Session;

  beforeEach(async () => {
    host = await setUp();
    room = await createRoom("Designers", { closedTo: [host.user.id] }).then((created) => created.id);
    other = await createRoom("Everyone").then((created) => created.id);
    const { userId } = await addGuest(host, room, "Pat");
    guest = await guestSession("Pat");
    expect(guest.user.id).toBe(userId);
  });

  it("opens their room's socket, and refuses every other room's", async () => {
    expect(await opened(room, guest)).toBe("welcome");
    expect(await opened(other, guest)).toBe(CloseCode.NotFound);
  });

  it("reads their room's settings, whose people are the room's alone, and hears 404 for every other room's", async () => {
    await signIn("Grace");
    expect((await settingsOf(guest, room)).status).toBe(200);
    const settings = (await (await settingsOf(guest, room)).json()) as RoomSettings;
    // Grace is active in the workspace, and in the open room everyone's in, but not in the settings they read.
    expect(settings.people.map((person) => person.id).sort()).toEqual([host.user.id, guest.user.id].sort());
    const elsewhere = await settingsOf(guest, other);
    expect(elsewhere.status).toBe(404);
    expect(await elsewhere.json()).toEqual({ error: ROOM_NOT_FOUND });
  });

  it("is offered their room's people to mention, and nobody else's room's", async () => {
    const theirs = await api(`/api/autocompletable/users?room_id=${room}&query=`, { headers: { Cookie: guest.cookie } });
    expect(theirs.status).toBe(200);
    const elsewhere = await api(`/api/autocompletable/users?room_id=${other}&query=`, { headers: { Cookie: guest.cookie } });
    expect(elsewhere.status).toBe(404);
    expect(await elsewhere.json()).toEqual({ error: ROOM_NOT_FOUND });
  });

  it("uploads to their room, and hears 404 for every other room's uploads", async () => {
    const file = { name: "notes.txt", type: "text/plain", size: 5, clientMessageId: crypto.randomUUID() };
    expect((await startUpload(guest, room, file)).status).toBe(201);
    expect((await startUpload(guest, other, file)).status).toBe(404);
  });

  it("changes nothing in a room they weren't added to", async () => {
    const changes = { method: "PATCH", headers: { Cookie: guest.cookie }, body: JSON.stringify({ name: "Mine" }) };
    expect((await api(`/api/rooms/${other}`, changes)).status).toBe(404);
    expect((await api(`/api/rooms/${other}/favorite`, { method: "PUT", headers: { Cookie: guest.cookie }, body: JSON.stringify({ favorite: true }) })).status).toBe(403);
    expect(
      (await api(`/api/rooms/${other}/involvement`, { method: "PUT", headers: { Cookie: guest.cookie }, body: JSON.stringify({ involvement: "everything" }) })).status,
    ).toBe(404);
  });

  it("starts no DM and makes no room, whichever way the workspace lets people make them", async () => {
    const refused = await api("/api/directs", { method: "POST", headers: { Cookie: guest.cookie }, body: JSON.stringify({ userIds: [host.user.id] }) });
    expect(refused.status).toBe(403);
    const room2 = await api("/api/rooms", { method: "POST", headers: { Cookie: guest.cookie }, body: JSON.stringify({ kind: "open", name: "Mine" }) });
    expect(room2.status).toBe(403);
    expect((await api("/api/rooms/new", { headers: { Cookie: guest.cookie } })).status).toBe(403);
  });

  it("stays out of open rooms made or opened after them, which take everyone else in", async () => {
    const made = await createRoom("Later");
    const quiet = await createRoom("Quiet", { closedTo: [host.user.id] });
    const openedQuiet = await api(`/api/rooms/${quiet.id}`, { method: "PATCH", headers: { Cookie: host.cookie }, body: JSON.stringify({ kind: "open" }) });
    expect(openedQuiet.status, await openedQuiet.clone().text()).toBe(200);
    // Their one membership stands: neither a new open room nor one opened just now put them in it.
    const memberships = (await workspaceSql("SELECT room_id FROM memberships WHERE user_id = ?", guest.user.id)) as Array<{ room_id: RoomId }>;
    expect(memberships).toEqual([{ room_id: room }]);
    expect((await sidebarOf(guest)).rooms.map(({ id }) => id)).toEqual([room]);
    expect(await opened(made.id, guest)).toBe(CloseCode.NotFound);
    expect(await opened(quiet.id, guest)).toBe(CloseCode.NotFound);
  });

  it("joins no DM someone else starts with them, whose room their stay doesn't reach", async () => {
    const member = await signIn("Grace");
    const started = await api("/api/directs", { method: "POST", headers: { Cookie: member.cookie }, body: JSON.stringify({ userIds: [guest.user.id] }) });
    expect(started.status, await started.clone().text()).toBe(201);
    const dm = ((await started.json()) as { room: { id: RoomId } }).room.id;
    expect((await workspaceSql("SELECT room_id FROM memberships WHERE user_id = ?", guest.user.id)) as Array<{ room_id: RoomId }>).toEqual([{ room_id: room }]);
    expect((await sidebarOf(guest)).rooms.map(({ id }) => id)).toEqual([room]);
    expect(await opened(dm, guest)).toBe(CloseCode.NotFound);
  });

  it("can't leave the room they were added to", async () => {
    const refused = await api(`/api/rooms/${room}/membership`, { method: "DELETE", headers: { Cookie: guest.cookie } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "You're a guest of this room, so only whoever added you can take you out" });
  });

  it("hears their workspace socket's welcome, and has the workspace's join link kept from them", async () => {
    const tab = await openWorkspaceSocket(guest);
    expect(tab.welcome).toMatchObject({ you: { ...guest.user, administrator: false } });
    const bootstrap = (await (await api("/api/bootstrap", { headers: { Cookie: guest.cookie } })).json()) as { account: { joinCode: string | null } };
    expect(bootstrap.account.joinCode ?? null).toBeNull();
  });
});

describe("Expiry", () => {
  it("refuses a guest's sessions and every read once their stay has passed, before the alarm has run", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    const { userId } = await addGuest(host, room, "Pat");
    const guest = await guestSession("Pat");
    expect(await opened(room, guest)).toBe("welcome");

    await expire(userId);
    expect(await signedIn(guest)).toBe(false);
    expect(await opened(room, guest)).toBe(401);
    expect((await settingsOf(guest, room)).status).toBe(401);
    expect((await api("/api/users", { headers: { Cookie: guest.cookie } })).status).toBe(401);
    const file = { name: "notes.txt", type: "text/plain", size: 5, clientMessageId: crypto.randomUUID() };
    expect((await startUpload(guest, room, file)).status).toBe(401);
  });

  it("lapses a passed stay when the alarm runs: their sessions end, their sockets close, and their row says they were removed", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    const { userId, untilAt } = await addGuest(host, room, "Pat");
    const guest = await guestSession("Pat");
    const tab = await openWorkspaceSocket(guest);
    const hostsTab = await openWorkspaceSocket(host);
    expect(await opened(room, guest)).toBe("welcome");

    await expire(userId);
    // The alarm is set for when the stay ends.
    const alarm = await runInDurableObject(workspaceStub(), (_workspace, state) => state.storage.getAlarm());
    expect(alarm).toBe(Date.parse(untilAt));
    await runAlarm();
    await revoked();

    expect(await signedIn(guest)).toBe(false);
    expect(await tab.closed).toMatchObject({ code: CloseCode.Revoked });
    expect(await opened(room, guest)).toBe(401);
    // Their row stays, as a removed person's does, saying they were removed, which everyone hears of.
    expect(await hostsTab.next()).toMatchObject({ type: "user.updated", user: { id: userId, status: "deactivated" } });
    expect(await listedAs(host, userId)).toMatchObject({ status: "deactivated" });
    // And their room's people list stops counting them, while the row remains.
    const settings = (await (await settingsOf(host, room)).json()) as RoomSettings;
    expect(settings.people.find((person) => person.id === userId)).toBeUndefined();
    // Their pushes and recent searches are forgotten, as removing them forgets them.
    expect(((await workspaceSql("SELECT count(*) AS n FROM push_subscriptions WHERE user_id = ?", userId)) as Array<{ n: number }>)[0]!.n).toBe(0);
    expect(((await workspaceSql("SELECT count(*) AS n FROM sessions WHERE user_id = ?", userId)) as Array<{ n: number }>)[0]!.n).toBe(0);
  });

  it("lapses only the stays whose time has passed, once each, and none of a person who was removed already", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    await addGuest(host, room, "Pat");
    const rows = (await workspaceSql("SELECT user_id FROM guest_stays")) as Array<{ user_id: string }>;
    await workspaceSql("UPDATE guest_stays SET until_at = ?", Date.now() - 1);
    const removed = rows[0]!.user_id;
    // One of them was removed since, whose row the alarm leaves as it is.
    await workspaceSql("UPDATE users SET status = 1 WHERE id = ?", removed);

    await runAlarm();
    const statuses = (await workspaceSql("SELECT id, status FROM users WHERE id = ?", removed)) as Array<{ id: string; status: number }>;
    expect(statuses).toEqual([{ id: removed, status: 1 }]);
    await runAlarm();
    expect(((await workspaceSql("SELECT count(*) AS n FROM guest_stays")) as Array<{ n: number }>)[0]!.n).toBe(1);
  });
});

describe("Extending and ending a stay", () => {
  it("extends a guest's stay, which reads as its settings mark them, and only for whoever can change the room", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    const { userId } = await addGuest(host, room, "Pat");
    const guest = await guestSession("Pat");
    const passerby = await signIn("Grace");

    const until = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
    const refused = await api(`/api/rooms/${room}/guests/${userId}`, { method: "PUT", headers: { Cookie: passerby.cookie }, body: JSON.stringify({ until }) });
    expect(refused.status).toBe(403);
    const missing = await api(`/api/rooms/${room}/guests/nowhere`, { method: "PUT", headers: { Cookie: host.cookie }, body: JSON.stringify({ until }) });
    expect(missing.status).toBe(404);
    const passed = await api(`/api/rooms/${room}/guests/${userId}`, { method: "PUT", headers: { Cookie: host.cookie }, body: JSON.stringify({ until: "soon" }) });
    expect(passed.status).toBe(422);

    const extended = await api(`/api/rooms/${room}/guests/${userId}`, { method: "PUT", headers: { Cookie: host.cookie }, body: JSON.stringify({ until }) });
    expect(extended.status, await extended.clone().text()).toBe(200);
    expect(((await extended.json()) as { guest: RoomGuest }).guest).toEqual({ userId, name: "Pat", untilAt: until });
    const kept = (await workspaceSql("SELECT until_at FROM guest_stays WHERE user_id = ?", userId)) as Array<{ until_at: number }>;
    expect(new Date(kept[0]!.until_at).toISOString()).toBe(until);

    // The guest carries on, their session untouched by the stay's being longer.
    expect(await signedIn(guest)).toBe(true);
  });

  it("ends a guest's stay now: their sessions end, their sockets close, and their row says they were removed", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    const { userId } = await addGuest(host, room, "Pat");
    const guest = await guestSession("Pat");
    const tab = await openWorkspaceSocket(guest);
    expect(await opened(room, guest)).toBe("welcome");
    const passerby = await signIn("Grace");

    const refused = await api(`/api/rooms/${room}/guests/${userId}`, { method: "DELETE", headers: { Cookie: passerby.cookie } });
    expect(refused.status).toBe(403);
    const ended = await api(`/api/rooms/${room}/guests/${userId}`, { method: "DELETE", headers: { Cookie: host.cookie } });
    expect(ended.status, await ended.clone().text()).toBe(204);
    await revoked();

    expect(await signedIn(guest)).toBe(false);
    expect(await tab.closed).toMatchObject({ code: CloseCode.Revoked });
    expect(await opened(room, guest)).toBe(401);
    expect(await listedAs(host, userId)).toMatchObject({ status: "deactivated" });
    const settings = (await (await settingsOf(host, room)).json()) as RoomSettings;
    expect(settings.people.find((person) => person.id === userId)).toBeUndefined();
    // Ending it again finds no stay to end.
    const again = await api(`/api/rooms/${room}/guests/${userId}`, { method: "DELETE", headers: { Cookie: host.cookie } });
    expect(again.status).toBe(404);
  });

  it("brings no one back who was removed, whose stay ending was not theirs to extend", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    const { userId } = await addGuest(host, room, "Pat");
    // Pat was removed, as Delete on the workspace settings does, and the room's settings no longer list them.
    const removed = await api(`/api/account/users/${userId}`, { method: "DELETE", headers: { Cookie: host.cookie } });
    expect(removed.status, await removed.clone().text()).toBe(200);
    const until = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
    const extended = await api(`/api/rooms/${room}/guests/${userId}`, { method: "PUT", headers: { Cookie: host.cookie }, body: JSON.stringify({ until }) });
    expect(extended.status).toBe(404);
    // The stay's time is as it was, and Pat signs in by their name no more.
    const refused = await signInByName("Pat");
    expect(refused.status).toBe(403);
  });
});

describe("The guests of the open sign-in", () => {
  it("keeps the whole workspace the flag gives them, and lose it once it's turned off, as they did before stays", async () => {
    await setUp();
    await createRoom("Everyone");
    const openGuest = await signIn("Drifter");

    // In every open room, with everyone in their directory, and pushes to come.
    const rooms = await sidebarOf(openGuest);
    expect(rooms.rooms.length).toBeGreaterThan(0);
    expect((await directoryOf(openGuest)).length).toBeGreaterThan(1);
    expect(await api("/api/directs", { method: "POST", headers: { Cookie: openGuest.cookie }, body: JSON.stringify({ userIds: [] }) })).toMatchObject({ status: 201 });

    // The flag off, their session is refused, as it always was, whatever any stay would say.
    expect((await apiWith({ EMBER_GUEST_SIGN_IN: undefined }, "/api/me", { headers: { Cookie: openGuest.cookie } })).status).toBe(401);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
