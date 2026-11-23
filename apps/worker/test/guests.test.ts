import { ASSISTANT_ID, type Directory, type DirectoryUser, type Me, type RoomGuest, type RoomId, type RoomSettings, CloseCode } from "@ember/protocol";
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
  type WorkspaceSocket,
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
const sidebarOf = async (session: Session) =>
  (await (await api("/api/sidebar", { headers: { Cookie: session.cookie } })).json()) as { rooms: Array<{ id: RoomId }>; suggestions: Array<{ id: string; name: string }> };

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

  it("hears no room arrive on their workspace socket when one is made or opens while they listen", async () => {
    const quiet = await createRoom("Quiet", { closedTo: [host.user.id] });
    const tab = await openWorkspaceSocket(guest);

    const made = await createRoom("Later");
    const openedQuiet = await api(`/api/rooms/${quiet.id}`, { method: "PATCH", headers: { Cookie: host.cookie }, body: JSON.stringify({ kind: "open" }) });
    expect(openedQuiet.status, await openedQuiet.clone().text()).toBe(200);
    // The frames went to the rooms' people, and a guest of one room is neither's: their tab hears nothing.
    expect(await tab.answers()).toBe(true);

    const memberships = (await workspaceSql("SELECT room_id FROM memberships WHERE user_id = ?", guest.user.id)) as Array<{ room_id: RoomId }>;
    expect(memberships).toEqual([{ room_id: room }]);
    expect((await sidebarOf(guest)).rooms.map(({ id }) => id)).toEqual([room]);
    expect(await opened(made.id, guest)).toBe(CloseCode.NotFound);
    expect(await opened(quiet.id, guest)).toBe(CloseCode.NotFound);
  });

  it("joins no closed room made with them among its people, or added to them from its settings", async () => {
    const member = await signIn("Grace");
    const made = await createRoom("Secret", { closedTo: [host.user.id, member.user.id, guest.user.id] });
    // Whoever its settings add it to is granted, and a stay holds the guest out of it there too.
    const changed = await api(`/api/rooms/${made.id}`, {
      method: "PATCH",
      headers: { Cookie: host.cookie },
      body: JSON.stringify({ kind: "closed", memberIds: [host.user.id, member.user.id, guest.user.id] }),
    });
    expect(changed.status, await changed.clone().text()).toBe(200);

    const memberships = (await workspaceSql("SELECT room_id FROM memberships WHERE user_id = ?", guest.user.id)) as Array<{ room_id: RoomId }>;
    expect(memberships).toEqual([{ room_id: room }]);
    expect((await sidebarOf(guest)).rooms.map(({ id }) => id)).toEqual([room]);
    expect(await opened(made.id, guest)).toBe(CloseCode.NotFound);
  });

  it("comes back into their room once its settings have them again, and into no other", async () => {
    const tab = await openWorkspaceSocket(guest);

    // Taking them out of their room ends their way in.
    const out = await api(`/api/rooms/${room}`, { method: "PATCH", headers: { Cookie: host.cookie }, body: JSON.stringify({ kind: "closed", memberIds: [host.user.id] }) });
    expect(out.status, await out.clone().text()).toBe(200);
    expect(await tab.next()).toMatchObject({ type: "room.gone", roomId: room });
    expect(await opened(room, guest)).toBe(CloseCode.NotFound);
    expect((await workspaceSql("SELECT room_id FROM memberships WHERE user_id = ?", guest.user.id)) as Array<unknown>).toEqual([]);

    // Their stay outlives the membership, so having them among its people once more puts them back
    // in, which is what saving the room again after taking them out does.
    const back = await api(`/api/rooms/${room}`, { method: "PATCH", headers: { Cookie: host.cookie }, body: JSON.stringify({ kind: "closed", memberIds: [host.user.id, guest.user.id] }) });
    expect(back.status, await back.clone().text()).toBe(200);
    expect(await tab.next()).toMatchObject({ type: "room.saved", room: { id: room } });
    expect(await opened(room, guest)).toBe("welcome");
    expect((await workspaceSql("SELECT room_id FROM memberships WHERE user_id = ?", guest.user.id)) as Array<{ room_id: RoomId }>).toEqual([{ room_id: room }]);
    expect((await sidebarOf(guest)).rooms.map(({ id }) => id)).toEqual([room]);

    // A room of another's is still none of theirs to be saved into, whose stay holds them out of it.
    const elsewhere = await createRoom("Elsewhere", { closedTo: [host.user.id] });
    const sneaked = await api(`/api/rooms/${elsewhere.id}`, { method: "PATCH", headers: { Cookie: host.cookie }, body: JSON.stringify({ kind: "closed", memberIds: [host.user.id, guest.user.id] }) });
    expect(sneaked.status, await sneaked.clone().text()).toBe(200);
    expect((await workspaceSql("SELECT room_id FROM memberships WHERE user_id = ?", guest.user.id)) as Array<{ room_id: RoomId }>).toEqual([{ room_id: room }]);
    expect(await opened(elsewhere.id, guest)).toBe(CloseCode.NotFound);
  });

  it("gains no open room from being unbanned, whose stay keeps them to their own", async () => {
    expect(await opened(room, guest)).toBe("welcome");
    const banned = await api(`/api/users/${guest.user.id}/ban`, { method: "POST", headers: { Cookie: host.cookie } });
    expect(banned.status, await banned.clone().text()).toBe(200);
    expect(await signedIn(guest)).toBe(false);

    // Unbanning puts them back as they were, in no open room, though unbanning a member puts them in all of them.
    const unbanned = await api(`/api/users/${guest.user.id}/ban`, { method: "DELETE", headers: { Cookie: host.cookie } });
    expect(unbanned.status, await unbanned.clone().text()).toBe(200);
    const back = await guestSession("Pat");
    expect(back.user.id).toBe(guest.user.id);

    const memberships = (await workspaceSql("SELECT room_id FROM memberships WHERE user_id = ?", guest.user.id)) as Array<{ room_id: RoomId }>;
    expect(memberships).toEqual([{ room_id: room }]);
    expect((await sidebarOf(back)).rooms.map(({ id }) => id)).toEqual([room]);
    expect(await opened(other, back)).toBe(CloseCode.NotFound);
    expect(await opened(room, back)).toBe("welcome");
  });

  it("is refused to whoever starts a DM with them, with no conversation made without them", async () => {
    const member = await signIn("Grace");
    const started = await api("/api/directs", { method: "POST", headers: { Cookie: member.cookie }, body: JSON.stringify({ userIds: [guest.user.id] }) });
    expect(started.status, await started.clone().text()).toBe(422);
    expect(await started.json()).toEqual({
      error: "They're a guest of one room, whose stay is the one room they reach, so a direct message with them isn't yours to start",
    });
    // Nothing was made: no DM whose only member would be whoever started it, which the guest would never see.
    expect(((await workspaceSql("SELECT count(*) AS n FROM rooms WHERE kind = 'direct'")) as Array<{ n: number }>)[0]!.n).toBe(0);
    // Naming them among others for a group DM is refused the same way, before any of it is made.
    const group = await api("/api/directs", { method: "POST", headers: { Cookie: member.cookie }, body: JSON.stringify({ userIds: [host.user.id, guest.user.id] }) });
    expect(group.status).toBe(422);
    expect(((await workspaceSql("SELECT count(*) AS n FROM rooms WHERE kind = 'direct'")) as Array<{ n: number }>)[0]!.n).toBe(0);
    expect((await sidebarOf(guest)).rooms.map(({ id }) => id)).toEqual([room]);
  });

  it("is suggested to nobody their DM could start from, and suggested nobody themselves", async () => {
    const member = await signIn("Grace");
    const suggestions = (await sidebarOf(member)).suggestions.map(({ id }) => id);
    // Whoever a DM could start with is among the suggestions; the guest, whose stay is a DM none of, is not.
    expect(suggestions).toContain(host.user.id);
    expect(suggestions).not.toContain(guest.user.id);
    // Their own sidebar suggests nobody, a DM being none of theirs to start.
    expect((await sidebarOf(guest)).suggestions).toEqual([]);
  });

  it("can't leave the room they were added to", async () => {
    const refused = await api(`/api/rooms/${room}/membership`, { method: "DELETE", headers: { Cookie: guest.cookie } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "You're a guest of this room, so only whoever added you can take you out" });
  });

  it("reads only their room's pages of people, and each group of theirs with its members of the room alone", async () => {
    // Grace signs in with just a name, which puts her in the open room, outside the guest's room.
    const grace = await signIn("Grace Hopper");
    const made = await api("/api/user_groups", { method: "POST", headers: { Cookie: host.cookie }, body: JSON.stringify({ name: "Illustrators", memberIds: [host.user.id, grace.user.id] }) });
    expect(made.status, await made.clone().text()).toBe(201);

    // The directory keeps its groups to what their room's people are of them, and the people it
    // lists are the room's, as their stays keep them there.
    const { users, groups } = (await (await api("/api/users", { headers: { Cookie: guest.cookie } })).json()) as Directory;
    expect(users.map(({ id }) => id).sort()).toEqual([guest.user.id, host.user.id].sort());
    expect(groups).toEqual([{ id: expect.any(String), name: "illustrators", memberIds: [host.user.id] }]);

    // Their room's people's pages open, and nobody else's do, theirs alone apart.
    expect((await api(`/api/users/${host.user.id}`, { headers: { Cookie: guest.cookie } })).status).toBe(200);
    expect((await api(`/api/users/${guest.user.id}`, { headers: { Cookie: guest.cookie } })).status).toBe(200);
    expect((await api(`/api/users/${grace.user.id}`, { headers: { Cookie: guest.cookie } })).status).toBe(404);

    // A member reads the group whole, as the directory always gave it them.
    const whole = (await (await api("/api/users", { headers: { Cookie: grace.cookie } })).json()) as Directory;
    expect(whole.groups).toEqual([{ id: expect.any(String), name: "illustrators", memberIds: [grace.user.id, host.user.id].sort() }]);
  });

  it("takes no name that's blank however much spacing it has, which their stay signs them back in by", async () => {
    const response = await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: guest.cookie }, body: JSON.stringify({ name: "      " }) });
    expect(response.status).toBe(422);
    expect(await workspaceSql("SELECT name FROM users WHERE id = ?", guest.user.id)).toEqual([{ name: "Pat" }]);
    // Their stay still signs them in by the name they kept.
    expect((await guestSession("Pat")).user.id).toBe(guest.user.id);
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

  it("lapses one run's worth of passed stays, leaving the rest for the next run", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    // More guests whose stays have passed than one run lapses, kept as the adding a guest keeps them.
    const now = new Date().toISOString();
    for (let n = 0; n < 21; n++) {
      await workspaceSql("INSERT INTO users (id, name, guest, created_at, updated_at) VALUES (?, ?, 1, ?, ?)", `guest-${n}`, `Guest ${n}`, now, now);
      await workspaceSql("INSERT INTO guest_stays (user_id, room_id, until_at) VALUES (?, ?, ?)", `guest-${n}`, room, Date.now() - 1);
    }
    const lapsed = async () => ((await workspaceSql("SELECT count(*) AS n FROM users WHERE guest = 1 AND status = 1")) as Array<{ n: number }>)[0]!.n;

    await runAlarm();
    expect(await lapsed()).toBeLessThan(21);
    // Each run takes one budget's worth of what waited, which the alarm was set for as it ended, until
    // none is left.
    for (let runs = 1; (await lapsed()) < 21 && runs < 10; runs++) await runAlarm();
    expect(await lapsed()).toBe(21);
  });
});

describe("What a guest hears of people", () => {
  it("hears of the people their room holds, and of nobody else's", async () => {
    const host = await setUp();
    const mine = await createRoom("Designers", { closedTo: [host.user.id] }).then((created) => created.id);
    const elsewhere = await createRoom("Lounge", { closedTo: [host.user.id] }).then((created) => created.id);
    const nia = await addGuest(host, elsewhere, "Nia");
    await addGuest(host, mine, "Pat");
    const guest = await guestSession("Pat");
    const tab = await openWorkspaceSocket(guest);
    const hostsTab = await openWorkspaceSocket(host);

    // Nia, a guest of another room, is announced to their room's people alone: the host hears of them, the guest doesn't.
    const niaSession = await guestSession("Nia");
    const renamed = await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: niaSession.cookie }, body: JSON.stringify({ name: "Nia Doe" }) });
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    expect(await tab.answers()).toBe(true);
    expect(await hostsTab.next()).toMatchObject({ type: "user.updated", user: { id: nia.userId, name: "Nia Doe" } });

    // A member of no room of theirs is none of theirs to hear of either: what the host hears of Grace
    // saying hello is theirs, then her rename, and the guest hears neither.
    const grace = await signIn("Grace");
    expect(await hostsTab.next()).toMatchObject({ type: "user.updated", user: { name: "Grace" } });
    const graceRenamed = await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: grace.cookie }, body: JSON.stringify({ name: "Grace Hopper" }) });
    expect(graceRenamed.status).toBe(200);
    expect(await tab.answers()).toBe(true);
    expect(await hostsTab.next()).toMatchObject({ type: "user.updated", user: { name: "Grace Hopper" } });

    // Whoever their room holds, they hear of, as its settings list them.
    const hostRenamed = await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: host.cookie }, body: JSON.stringify({ name: "Ada King" }) });
    expect(hostRenamed.status).toBe(200);
    expect(await tab.next()).toMatchObject({ type: "user.updated", user: { name: "Ada King" } });
  });

  it("hears of a guest of another room, whom the directory lists to everyone, while a guest of no room of theirs hears nothing of them", async () => {
    const host = await setUp();
    const mine = await createRoom("Designers", { closedTo: [host.user.id] }).then((created) => created.id);
    const elsewhere = await createRoom("Lounge", { closedTo: [host.user.id] }).then((created) => created.id);
    const nia = await addGuest(host, elsewhere, "Nia");
    await addGuest(host, mine, "Pat");
    const member = await signIn("Grace");
    const membersTab = await openWorkspaceSocket(member);
    const patsTab = await openWorkspaceSocket(await guestSession("Pat"));

    // Nia is in the directory everyone reads, so her rename reaches the member outside her room,
    // whose list would keep her stale without it, and Pat, a guest of no room of hers, hears nothing.
    const niaSession = await guestSession("Nia");
    const renamed = await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: niaSession.cookie }, body: JSON.stringify({ name: "Nia Doe" }) });
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    expect(await membersTab.next()).toMatchObject({ type: "user.updated", user: { id: nia.userId, name: "Nia Doe" } });
    expect(await patsTab.answers()).toBe(true);

    // Her stay ending now reaches the member too, who would otherwise list her as active until a
    // reload, and Pat still hears nothing of her.
    const ended = await api(`/api/rooms/${elsewhere}/guests/${nia.userId}`, { method: "DELETE", headers: { Cookie: host.cookie } });
    expect(ended.status, await ended.clone().text()).toBe(204);
    expect(await membersTab.next()).toMatchObject({ type: "user.updated", user: { id: nia.userId, status: "deactivated" } });
    expect(await patsTab.answers()).toBe(true);
  });
});

// The agents are in the rooms they're in, so a guest of one room hears of the agents of that room alone,
// as their directory lists them, and of no agent of another room's, whichever way the agents' news goes.

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const API_TOKEN = "an-api-token-with-ai-gateway-run_0123456";
const SONNET = "anthropic/claude-sonnet-5.5";
const HAIKU = "anthropic/claude-haiku-5.5";

/** A model saying hello in Messages' format, which is how every model the fake AI Gateway stands for answers. */
const HELLO = {
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "Hello, team!" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 100, output_tokens: 10 },
};

/** Has the fake AI Gateway answer every ask of a model with hello, until the test's mocks are restored. */
const gatewaySaysHello = () => vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(Response.json(HELLO)));

/** Turns Ember AI on as `administrator`, with Claude Sonnet answering everyone, as its card's switch does. */
async function turnOnAssistant(administrator: Session): Promise<void> {
  const response = await api("/api/account/assistant", {
    method: "PUT",
    headers: { Cookie: administrator.cookie },
    body: JSON.stringify({ accountId: ACCOUNT_ID, apiToken: API_TOKEN, model: SONNET }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
}

/** Turns Ember AI off as `administrator`, as its card's switch does. */
async function turnOffAssistant(administrator: Session): Promise<void> {
  expect((await api("/api/account/assistant", { method: "DELETE", headers: { Cookie: administrator.cookie } })).status).toBe(200);
}

/** Makes an agent named `name` as `administrator`, in every open room or the ones `rooms` pick, answering it. */
async function makeAgent(administrator: Session, name: string, rooms: RoomId[] | null): Promise<{ id: string }> {
  const agent = {
    name,
    description: "Sums up long threads",
    instructions: "Sum up the thread you're asked in, in five bullets at most.",
    model: HAIKU,
    thinking: "off",
    length: "short",
    webSearch: false,
    rooms,
  };
  const response = await api("/api/account/agents", { method: "POST", headers: { Cookie: administrator.cookie }, body: JSON.stringify(agent) });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { agent: { id: string } }).agent;
}

/** Renames agent `id` to `name` as `administrator`, as its page saves it. */
const renameAgent = (administrator: Session, id: string, name: string) =>
  api(`/api/account/agents/${id}`, { method: "PATCH", headers: { Cookie: administrator.cookie }, body: JSON.stringify({ name }) });

/** Sets Ember up with Ada as its administrator, Ember AI on with the gateway answering hello, signed in. */
async function setUpWithAgents(): Promise<Session> {
  gatewaySaysHello();
  const host = await setUp();
  await turnOnAssistant(host);
  return host;
}

/** The next `count` people `tab` hears of, by ID, past what else it hears of, such as rooms. */
async function heardIds(tab: WorkspaceSocket, count: number): Promise<string[]> {
  const heard: string[] = [];
  while (heard.length < count) {
    const frame = await tab.next();
    if (frame.type === "user.updated") heard.push(frame.user.id);
  }
  return heard;
}

describe("What a guest hears of agents", () => {
  it("hears of an agent of their room's renamed, and of no agent of another room's, whose name their directory keeps out", async () => {
    const host = await setUpWithAgents();
    const mine = await createRoom("Designers", { as: host });
    const other = await createRoom("Lounge", { as: host });
    const everywhere = await makeAgent(host, "Everywhere", null);
    const kept = await makeAgent(host, "Kept", [other.id]);
    await addGuest(host, mine.id, "Pat");
    const guest = await guestSession("Pat");
    const tab = await openWorkspaceSocket(guest);
    const hostsTab = await openWorkspaceSocket(host);

    // Their directory lists the agents of their room, which its people are, and no agent of another room's.
    const people = await directoryOf(guest);
    expect(people.some(({ id }) => id === everywhere.id)).toBe(true);
    expect(people.some(({ id }) => id === kept.id)).toBe(false);

    // Renaming their room's agent reaches them, and the host with them.
    const renamed = await renameAgent(host, everywhere.id, "Everywhere About");
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    expect(await hostsTab.next()).toMatchObject({ type: "user.updated", user: { id: everywhere.id, name: "Everywhere About" } });
    expect(await tab.next()).toMatchObject({ type: "user.updated", user: { id: everywhere.id, name: "Everywhere About" } });

    // One kept to another room's is renamed out of their hearing: the host hears of it, their tab hears nothing.
    const keptRenamed = await renameAgent(host, kept.id, "Kept There");
    expect(keptRenamed.status, await keptRenamed.clone().text()).toBe(200);
    expect(await hostsTab.next()).toMatchObject({ type: "user.updated", user: { id: kept.id, name: "Kept There" } });
    expect(await tab.answers()).toBe(true);
    expect((await directoryOf(guest)).some(({ id }) => id === kept.id)).toBe(false);
  });

  it("hears of their room's agents going with Ember AI and coming back, and of no agent of another room's", async () => {
    const host = await setUpWithAgents();
    const mine = await createRoom("Designers", { as: host });
    const other = await createRoom("Lounge", { as: host });
    const everywhere = await makeAgent(host, "Everywhere", null);
    const kept = await makeAgent(host, "Kept", [other.id]);
    await addGuest(host, mine.id, "Pat");
    const guest = await guestSession("Pat");
    const tab = await openWorkspaceSocket(guest);
    const hostsTab = await openWorkspaceSocket(host);

    // Turning Ember AI off takes @ember and the agents out of every room, so the host hears of each of
    // them, and a guest of one room hears nothing of any of them: none is of their room any more.
    await turnOffAssistant(host);
    expect(await hostsTab.next()).toMatchObject({ type: "user.updated", user: { id: ASSISTANT_ID, status: "deactivated" } });
    expect((await heardIds(hostsTab, 2)).sort()).toEqual([everywhere.id, kept.id].sort());
    expect(await tab.answers()).toBe(true);

    // Turning it on puts them back, so their room's reach them again, and one kept to another room's
    // doesn't, whose name their directory keeps out still.
    await turnOnAssistant(host);
    expect((await heardIds(tab, 2)).sort()).toEqual([ASSISTANT_ID, everywhere.id].sort());
    expect(await tab.answers()).toBe(true);
    expect(await hostsTab.next()).toMatchObject({ type: "user.updated", user: { id: ASSISTANT_ID, status: "active" } });
    expect((await heardIds(hostsTab, 2)).sort()).toEqual([everywhere.id, kept.id].sort());
    expect((await directoryOf(guest)).some(({ id }) => id === everywhere.id)).toBe(true);
    expect((await directoryOf(guest)).some(({ id }) => id === kept.id)).toBe(false);
  });
});

describe("What a guest hears once their stay has passed", () => {
  it("hears nothing more of anyone, though their tab keeps reading, while whose stay holds hears of their room's people", async () => {
    const host = await setUp();
    const mine = await createRoom("Designers", { closedTo: [host.user.id] }).then((created) => created.id);
    const pat = await addGuest(host, mine, "Pat");
    await addGuest(host, mine, "Quinn");
    const grace = await signIn("Grace");
    const patsTab = await openWorkspaceSocket(await guestSession("Pat"));
    const quinnsTab = await openWorkspaceSocket(await guestSession("Quinn"));

    // Pat's stay passes without the alarm having run, whose deliveries would close their tab: what
    // lands on it of people meanwhile is dropped, as their reads refuse it.
    await expire(pat.userId);

    // A member of no room of theirs is none of theirs to hear of: the frame that would have told them
    // Grace's name is dropped on its way to their tab, whose stay has nothing left to see her by.
    const graceRenamed = await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: grace.cookie }, body: JSON.stringify({ name: "Grace Hopper" }) });
    expect(graceRenamed.status, await graceRenamed.clone().text()).toBe(200);
    expect(await patsTab.answers()).toBe(true);
    expect(await quinnsTab.answers()).toBe(true);

    // Whose stay holds hears of their room's people still: the host is Pat's and Quinn's, so Quinn
    // takes the rename their stay lets them see, and Pat's lapsed one drops it.
    const hostRenamed = await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: host.cookie }, body: JSON.stringify({ name: "Ada King" }) });
    expect(hostRenamed.status, await hostRenamed.clone().text()).toBe(200);
    expect(await quinnsTab.next()).toMatchObject({ type: "user.updated", user: { id: host.user.id, name: "Ada King" } });
    expect(await patsTab.answers()).toBe(true);
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

  it("extends no stay whose time has passed, whose name is free for another guest to take already", async () => {
    const host = await setUp();
    const room = await createRoom("Designers", { closedTo: [host.user.id] }).then((created) => created.id);
    const { userId } = await addGuest(host, room, "Pat");
    await expire(userId);

    // Extending a passed stay would bring it back under a name another guest may hold already.
    const until = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
    const extended = await api(`/api/rooms/${room}/guests/${userId}`, { method: "PUT", headers: { Cookie: host.cookie }, body: JSON.stringify({ until }) });
    expect(extended.status).toBe(404);
    const kept = (await workspaceSql("SELECT until_at FROM guest_stays WHERE user_id = ?", userId)) as Array<{ until_at: number }>;
    expect(kept[0]!.until_at).toBeLessThan(Date.now());
    // The name stays free, as a passed stay's is, and the guest taken for it signs in by it.
    const again = await addGuest(host, room, "Pat");
    expect(again.name).toBe("Pat");
    expect(again.userId).not.toBe(userId);
    expect((await guestSession("Pat")).user.id).toBe(again.userId);
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

describe("Renaming", () => {
  it("keeps a guest from taking another guest's name, which would sign one of them in as the other", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    const other = (await createRoom("Lounge", { closedTo: [host.user.id] })).id;
    await addGuest(host, room, "Pat");
    const nia = await addGuest(host, other, "Nia");
    const session = await guestSession("Pat");

    const taken = await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: session.cookie }, body: JSON.stringify({ name: "  nia " }) });
    expect(taken.status).toBe(422);
    expect(await taken.json()).toEqual({ error: "nia is another guest's way in. Choose another." });
    // Nothing saved: each stay still signs nobody but its own guest in.
    expect((await guestSession("Nia")).user.id).toBe(nia.userId);
    expect((await guestSession("Pat")).user.id).toBe(session.user.id);

    // Their profile is otherwise theirs to save, and a name no stay holds is theirs to take.
    expect((await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: session.cookie }, body: JSON.stringify({ bio: "Here for the week" }) })).status).toBe(200);
    const renamed = await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: session.cookie }, body: JSON.stringify({ name: "Pat Doe" }) });
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    expect((await guestSession("Pat Doe")).user.id).toBe(session.user.id);
  });

  it("keeps a guest's renamed name within what signing in with just a name takes", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    await addGuest(host, room, "Pat");
    const session = await guestSession("Pat");

    // A longer one would save, and then neither it nor the old one would sign them back in.
    const tooLong = await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: session.cookie }, body: JSON.stringify({ name: "P".repeat(49) }) });
    expect(tooLong.status).toBe(422);
    expect(await tooLong.json()).toEqual({ error: "Your name must be 1 to 48 characters, as signing in with just a name takes it" });
    expect((await guestSession("Pat")).user.id).toBe(session.user.id);

    // One the sign-in form takes is theirs to rename to.
    const kept = await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: session.cookie }, body: JSON.stringify({ name: "P".repeat(48) }) });
    expect(kept.status, await kept.clone().text()).toBe(200);
    expect((await guestSession("P".repeat(48))).user.id).toBe(session.user.id);
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
    // No stay keeps them, so their name is no one's way in, and a long one is theirs to save.
    expect((await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: openGuest.cookie }, body: JSON.stringify({ name: "D".repeat(60) }) })).status).toBe(200);

    // The flag off, their session is refused, as it always was, whatever any stay would say.
    expect((await apiWith({ EMBER_GUEST_SIGN_IN: undefined }, "/api/me", { headers: { Cookie: openGuest.cookie } })).status).toBe(401);
  });
});

describe("A guest's sign-in link", () => {
  it("signs their link in while their stay holds, whatever the flag says, and not once it has passed", async () => {
    const host = await setUp();
    const room = (await createRoom("Designers", { closedTo: [host.user.id] })).id;
    const { userId } = await addGuest(host, room, "Pat");
    const guest = await guestSession("Pat");
    const page = await api("/api/users/me/profile", { headers: { Cookie: guest.cookie } });
    expect(page.status).toBe(200);
    const { transferId } = (await page.json()) as { transferId: string };

    // The link works, though guests can't stay signed in: their stay is their way in while it lasts.
    const linked = await apiWith({ EMBER_GUEST_SIGN_IN: undefined }, "/api/session/transfers", { method: "POST", body: JSON.stringify({ transferId }) });
    expect(linked.status, await linked.clone().text()).toBe(201);
    const browser = { user: shown(((await linked.json()) as { user: Me }).user), cookie: cookieOf(linked) };
    expect(browser.user.id).toBe(userId);
    expect(await opened(room, browser)).toBe("welcome");

    // The stay passed, the link is no way in, as its page answers with nothing.
    await expire(userId);
    expect((await apiWith({ EMBER_GUEST_SIGN_IN: undefined }, "/api/session/transfers", { method: "POST", body: JSON.stringify({ transferId }) })).status).toBe(400);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
