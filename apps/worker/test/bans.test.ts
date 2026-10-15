import { feature } from "@ember/parity";
import { CloseCode, type ChangedPerson, type Directory, type DirectoryUser, type Me, type NewWorkspace, type ProfileAnswer, type RoomId, type UserId } from "@ember/protocol";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { banProblem } from "../src/bans";
import type { Env } from "../src/env";
import type { Revocation } from "../src/revocations";
import { MESSAGES_BY, MESSAGES_BY_UNTIL } from "../src/store";
import type { Workspace } from "../src/workspace";
import { DUE_PURGES, type WorkspaceStore } from "../src/workspace-store";
import {
  api,
  closeOf,
  connect,
  cookieOf,
  createRoom,
  deactivatedPerson,
  direct,
  freshDeploy,
  freshRoom,
  openWorkspaceSocket,
  post,
  reconnect,
  roomSql,
  shown,
  signIn,
  upgrade,
  workspaceSql,
  workspaceStub,
  type Session,
} from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };
const grace = { name: "Grace Hopper", emailAddress: "grace@example.com", password: "compiler design" };

/** A time so far ahead that the runtime never runs an alarm set for it during a test. */
const LATER = Date.now() + 365 * 24 * 60 * 60 * 1000;

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

/** Someone joins with the join link, setting an email address and password, signed in. */
async function join(person: typeof grace): Promise<Session> {
  const [{ join_code: joinCode }] = (await workspaceSql("SELECT join_code FROM accounts")) as [{ join_code: string }];
  const response = await api(`/api/join/${joinCode}`, { method: "POST", body: JSON.stringify(person) });
  expect(response.status, await response.clone().text()).toBe(201);
  return { user: shown(((await response.json()) as { user: Me }).user), cookie: cookieOf(response) };
}

/** Signs in with an email address and password from the IP address `ip`. */
const signInFrom = ({ emailAddress, password }: typeof grace, ip: string) =>
  api("/api/session", { method: "POST", headers: { "CF-Connecting-IP": ip }, body: JSON.stringify({ emailAddress, password }) });

/** Signs in as Grace again from `ip`, in a session of its own. */
async function signInAsGrace(ip: string): Promise<Session> {
  const response = await signInFrom(grace, ip);
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as { user: Me }).user), cookie: cookieOf(response) };
}

/** Asks for `userId` to be banned, as `session` if given. */
const ban = (session: Session | null, userId: UserId) => api(`/api/users/${userId}/ban`, { method: "POST", headers: session ? { Cookie: session.cookie } : {} });

/** Asks for the ban on `userId` to be lifted, as `session` if given. */
const unban = (session: Session | null, userId: UserId) => api(`/api/users/${userId}/ban`, { method: "DELETE", headers: session ? { Cookie: session.cookie } : {} });

/** Someone as the directory lists them, as `viewer` sees it. */
async function listed(viewer: Session, userId: UserId): Promise<DirectoryUser> {
  const { users } = (await (await api("/api/users", { headers: { Cookie: viewer.cookie } })).json()) as Directory;
  return users.find((user) => user.id === userId)!;
}

const stored = async (userId: UserId) =>
  ((await workspaceSql("SELECT role, status, updated_at FROM users WHERE id = ?", userId)) as Array<{ role: number; status: number; updated_at: string }>)[0]!;

const bansOf = (userId: UserId) => workspaceSql("SELECT ip_address, created_at, updated_at FROM bans WHERE user_id = ? ORDER BY ip_address", userId);

const sessionsOf = async (userId: UserId) => ((await workspaceSql("SELECT count(*) AS n FROM sessions WHERE user_id = ?", userId)) as Array<{ n: number }>)[0]!.n;

const signedIn = async (session: Session) => (await api("/api/me", { headers: { Cookie: session.cookie } })).status === 200;

/** The ids of the messages `userId` wrote in `room`, in the order they were written. */
const written = async (room: RoomId, userId: UserId) =>
  ((await roomSql(room, "SELECT id FROM messages WHERE room_id = ? AND creator_id = ? ORDER BY id", room, userId)) as Array<{ id: string }>).map(({ id }) => id);

/** Waits for the Workspace's outbox to have asked every room to delete what it was asked to. */
const purged = () => vi.waitFor(async () => expect(await workspaceSql("SELECT * FROM pending_purges")).toEqual([]), { timeout: 5_000 });

const alarm = () => runInDurableObject(workspaceStub(), (_workspace, state: DurableObjectState) => state.storage.getAlarm());

/** Queues deleting someone's messages in a room, as banning them does. */
const queuePurge = (roomId: string, userId: string, dueAt: number) =>
  workspaceSql("INSERT INTO pending_purges (room_id, user_id, due_at) VALUES (?, ?, ?)", roomId, userId, dueAt);

const purges = () => workspaceSql("SELECT room_id, user_id, attempts, due_at FROM pending_purges ORDER BY id");

/** What the Workspace's alarm calls, standing in for each room. */
interface Rooms {
  revoke?(roomId: RoomId, revocations: Revocation[], revokedAt: number): Promise<void>;
  removeMessagesBy(roomId: RoomId, userId: UserId, limit: number, liftedAt: string | null): Promise<boolean>;
}

/** Runs the Workspace's alarm, as the runtime does once it's due, with `rooms` answering for the rooms. */
async function runAlarm(rooms: Rooms): Promise<void> {
  await runInDurableObject(workspaceStub(), async (workspace: Workspace, state: DurableObjectState) => {
    // The runtime clears an alarm as it runs it.
    await state.storage.deleteAlarm();
    const object = workspace as unknown as { env: Env };
    const env = object.env;
    object.env = { ...env, CHAT_ROOM: { getByName: () => rooms } as unknown as Env["CHAT_ROOM"] };
    try {
      await workspace.alarm();
    } finally {
      object.env = env;
    }
  });
}

beforeEach(freshDeploy);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe(feature("accounts.ban"), () => {
  it("bans someone active, answering them as the directory then lists them, banned, with their role and avatar", async () => {
    const administrator = await setUp();
    const member = await join(grace);
    const long = "2026-01-01T00:00:00.000Z";
    await workspaceSql("UPDATE users SET role = 1, updated_at = ? WHERE id = ?", long, member.user.id);
    const before = await listed(administrator, member.user.id);

    const response = await ban(administrator, member.user.id);
    expect(response.status).toBe(200);
    const { user } = (await response.json()) as ChangedPerson;
    expect(user).toEqual(await listed(administrator, member.user.id));
    expect(user).toMatchObject({ id: member.user.id, name: "Grace Hopper", role: "administrator", status: "banned" });
    // Its time changed, and the avatar's address with it.
    expect(user.avatarUrl).not.toBe(before.avatarUrl);
    expect((await api(user.avatarUrl, { headers: { Cookie: administrator.cookie } })).status).toBe(200);
    expect(await stored(member.user.id)).toMatchObject({ status: 2, role: 1 });
    expect((await stored(member.user.id)).updated_at > long).toBe(true);
  });

  it("blocks each IP address their sessions were signed in from, once each, leaving out blank ones", async () => {
    const administrator = await setUp();
    // With no address, as the tests' requests come.
    const member = await join(grace);
    for (const ip of ["203.0.113.7", "203.0.113.7", "2001:db8::7", "198.51.100.1"]) await signInAsGrace(ip);
    await workspaceSql("UPDATE sessions SET ip_address = ' ' WHERE ip_address = '198.51.100.1'");
    await signInFrom(ada, "192.0.2.1");

    await ban(administrator, member.user.id);
    const { updated_at: bannedAt } = await stored(member.user.id);
    expect(await bansOf(member.user.id)).toEqual(["2001:db8::7", "203.0.113.7"].map((ip_address) => ({ ip_address, created_at: bannedAt, updated_at: bannedAt })));
    expect(await workspaceSql("SELECT count(*) AS n FROM bans")).toEqual([{ n: 2 }]);
  });

  it("refuses to ban someone signed in from an address a ban can't block, changing nothing", async () => {
    const administrator = await setUp();
    const member = await join(grace);
    const lobby = await freshRoom("lobby");
    const message = await post(await connect(lobby, member), "Still here");
    const phone = await signInAsGrace("203.0.113.7");
    await signInAsGrace("10.0.0.1");

    const internal = await ban(administrator, member.user.id);
    expect(internal.status).toBe(422);
    expect(await internal.json()).toEqual({ error: "They signed in from a private or internal IP address, which a ban can't block" });

    await workspaceSql("UPDATE sessions SET ip_address = 'not an ip' WHERE ip_address = '10.0.0.1'");
    const invalid = await ban(administrator, member.user.id);
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({ error: "They signed in from an IP address that isn't valid, which a ban can't block" });

    expect(await stored(member.user.id)).toMatchObject({ status: 0 });
    expect(await sessionsOf(member.user.id)).toBe(3);
    expect(await signedIn(phone)).toBe(true);
    expect(await workspaceSql("SELECT * FROM bans")).toEqual([]);
    expect(await workspaceSql("SELECT * FROM pending_purges")).toEqual([]);
    expect(await workspaceSql("SELECT * FROM pending_revocations")).toEqual([]);
    expect(await written(lobby, member.user.id)).toEqual([message.id]);
  });

  it("ends all their sessions and nobody else's, closing their sockets for good in every room, their DMs too, and the workspace's", async () => {
    const administrator = await setUp();
    const laptop = await join(grace);
    const phone = await signInAsGrace("203.0.113.7");
    const lobby = await freshRoom("lobby");
    const annex = await freshRoom("annex");
    const { id: dm } = await direct(laptop, administrator);
    const rooms = [await connect(lobby, laptop), await connect(annex, laptop), await connect(lobby, phone), await connect(dm, phone)];
    const workspaces = [await openWorkspaceSocket(laptop), await openWorkspaceSocket(phone)];
    const adaInLobby = await connect(lobby, administrator);
    const adasWorkspace = await openWorkspaceSocket(administrator);
    const closes = [...rooms.map((tab) => closeOf(tab.ws)), ...workspaces.map((tab) => tab.closed)];

    expect((await ban(administrator, laptop.user.id)).status).toBe(200);
    for (const close of await Promise.all(closes)) expect(close).toMatchObject({ code: CloseCode.Revoked, reason: "Revoked" });
    // Rooms she has no tab in hear too, and then nothing waits to be told again.
    await vi.waitFor(async () => expect(await workspaceSql("SELECT * FROM pending_revocations")).toEqual([]), { timeout: 5_000 });
    for (const session of [laptop, phone]) {
      expect(await signedIn(session)).toBe(false);
      expect((await api(`/api/rooms/${dm}/socket`, upgrade(session.cookie))).status).toBe(401);
      expect((await api("/api/socket", upgrade(session.cookie))).status).toBe(401);
    }
    expect(await sessionsOf(laptop.user.id)).toBe(0);
    // Nor can she sign in again.
    expect((await signInFrom(grace, "203.0.113.8")).status).toBe(401);

    // Ada is still signed in and connected.
    expect(await signedIn(administrator)).toBe(true);
    expect((await post(adaInLobby, "Still here")).body).toBe("Still here");
    expect(await adasWorkspace.next()).toMatchObject({ type: "user.updated", user: { id: laptop.user.id, status: "banned" } });
    expect(await adasWorkspace.answers()).toBe(true);
  });

  it("refuses their sign-in links from then on", async () => {
    const administrator = await setUp();
    const member = await join(grace);
    const { transferId } = (await (await api("/api/users/me/profile", { headers: { Cookie: member.cookie } })).json()) as ProfileAnswer;

    await ban(administrator, member.user.id);
    expect((await api(`/api/session/transfers/${transferId}`, { method: "PUT" })).status).toBe(400);
  });

  it("deletes every message they wrote, in every room they could have written in, with its boosts, telling everyone there", async () => {
    const administrator = await setUp();
    const member = await join(grace);
    const linus = await signIn("Linus Torvalds");
    const lobby = await freshRoom("lobby");
    const { id: closed } = await createRoom("closed", { closedTo: [administrator.user.id, member.user.id], as: administrator });
    const { id: dm } = await direct(member, administrator);
    const { id: group } = await direct(member, administrator, linus);
    const { id: own } = await direct(member);
    const { id: theirs } = await direct(administrator, linus);

    const adaInLobby = await connect(lobby, administrator);
    const graceInLobby = await connect(lobby, member);
    const adas = await post(adaInLobby, "Ada's");
    const graces = await post(graceInLobby, "Grace's");
    graceInLobby.send({ type: "boost.create", messageId: adas.id, content: "🔥" });
    await adaInLobby.next("boost.created");
    adaInLobby.send({ type: "boost.create", messageId: graces.id, content: "👍" });
    await adaInLobby.next("boost.created");
    for (const room of [closed, dm, group, own]) await post(await connect(room, member), "Grace's");
    const linuss = await post(await connect(group, linus), "Linus's");
    const elsewhere = await post(await connect(theirs, administrator), "Not in Grace's rooms");
    // She's taken out of the closed room after writing there.
    await workspaceSql("DELETE FROM memberships WHERE room_id = ? AND user_id = ?", closed, member.user.id);

    expect((await ban(administrator, member.user.id)).status).toBe(200);
    expect(await adaInLobby.next("message.deleted")).toEqual({ type: "message.deleted", messageId: graces.id, seq: expect.any(Number) });
    await purged();
    for (const room of [lobby, closed, dm, group, own]) expect(await written(room, member.user.id), room).toEqual([]);
    expect(await written(lobby, administrator.user.id)).toEqual([adas.id]);
    expect(await written(group, linus.user.id)).toEqual([linuss.id]);
    expect(await written(theirs, administrator.user.id)).toEqual([elsewhere.id]);
    // Her boost on Ada's message stays, as ember-rust deletes only messages, and Ada's on hers went with it.
    expect(await roomSql(lobby, "SELECT message_id, booster_id FROM boosts WHERE room_id = ?", lobby)).toEqual([{ message_id: adas.id, booster_id: member.user.id }]);
    // A new tab doesn't see them either.
    expect((await connect(lobby, administrator)).welcome.messages.map(({ id }) => id)).toEqual([adas.id]);
  });

  it("deletes a page of their messages at a time, each deletion a change of its own that tabs catch up on", async () => {
    const administrator = await setUp();
    const member = await join(grace);
    const lobby = await freshRoom("lobby");
    const graceInLobby = await connect(lobby, member);
    const ids: string[] = [];
    for (let i = 0; i < 105; i++) ids.push((await post(graceInLobby, `Message ${i}`)).id);
    const adaInLobby = await connect(lobby, administrator);
    const { seq } = adaInLobby.welcome;

    await ban(administrator, member.user.id);
    const deletions = [];
    for (let i = 0; i < ids.length; i++) deletions.push(await adaInLobby.next("message.deleted"));
    expect(deletions.map((deletion) => deletion.seq)).toEqual(ids.map((_, i) => seq + 1 + i));
    expect(deletions.map((deletion) => deletion.messageId).sort()).toEqual([...ids].sort());
    await purged();
    expect(await written(lobby, member.user.id)).toEqual([]);

    // A tab that saw the first five deletions catches up on the rest, the latest the room keeps.
    const { opening } = await reconnect(lobby, administrator, seq + 5);
    expect(opening).toEqual({
      type: "resumed",
      you: administrator.user,
      messages: [],
      deletedIds: deletions.slice(5).map((deletion) => deletion.messageId),
      present: expect.any(Array),
      seq: seq + 105,
    });
    // One that saw none of them is too far behind, and starts again with the newest page.
    expect((await reconnect(lobby, administrator, seq)).opening).toMatchObject({ type: "welcome", messages: [], seq: seq + 105 });
  });

  it("queues deleting their messages in every shared room and every DM of theirs, in the change that bans them", async () => {
    const administrator = await setUp();
    const member = await join(grace);
    const linus = await signIn("Linus Torvalds");
    await freshRoom("lobby");
    // A room she isn't in now, as she may have been once.
    await createRoom("closed", { closedTo: [administrator.user.id], as: administrator });
    const { id: dm } = await direct(member, administrator);
    const { id: own } = await direct(member);
    await direct(administrator, linus);
    const shared = ((await workspaceSql("SELECT id FROM rooms WHERE kind <> 'direct'")) as Array<{ id: string }>).map(({ id }) => id);
    expect(shared).toHaveLength(4);

    const queued = await runInDurableObject(workspaceStub(), (workspace: Workspace) =>
      (workspace as unknown as { store: WorkspaceStore }).store.banPerson(member.user.id, [], CloseCode.Revoked, LATER, new Date().toISOString()),
    );
    expect(queued).toBe(true);
    expect(await workspaceSql("SELECT room_id, user_id, attempts, due_at FROM pending_purges ORDER BY room_id")).toEqual(
      [...shared, dm, own].sort().map((room_id) => ({ room_id, user_id: member.user.id, attempts: 0, due_at: LATER })),
    );
  });

  it("leaves someone banned as they were when banned again, telling nobody", async () => {
    const administrator = await setUp();
    const member = await join(grace);
    const { user } = (await (await ban(administrator, member.user.id)).json()) as ChangedPerson;
    const socket = await openWorkspaceSocket(administrator);

    const again = await ban(administrator, member.user.id);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ user });
    expect(await socket.answers()).toBe(true);
  });

  it("bans removed people and bots too, as ember-rust does", async () => {
    const administrator = await setUp();
    const removed = await deactivatedPerson("Former");
    const now = new Date().toISOString();
    await workspaceSql("INSERT INTO users (id, name, role, created_at, updated_at) VALUES ('robot', 'Build Bot', 2, ?, ?)", now, now);
    for (const userId of [removed, "robot"]) {
      const response = await ban(administrator, userId);
      expect(response.status, userId).toBe(200);
      expect(await response.json()).toMatchObject({ user: { id: userId, status: "banned" } });
    }
  });

  it("tells everyone's workspace sockets they're banned, as the directory now lists them", async () => {
    const administrator = await setUp();
    const member = await join(grace);
    const linus = await signIn("Linus Torvalds");
    const sockets = [await openWorkspaceSocket(administrator), await openWorkspaceSocket(linus)];

    const { user } = (await (await ban(administrator, member.user.id)).json()) as ChangedPerson;
    for (const socket of sockets) expect(await socket.next()).toEqual({ type: "user.updated", user });
  });

  it("lets only administrators ban people, telling anyone else so before looking at whom", async () => {
    await setUp();
    const member = await join(grace);
    const linus = await signIn("Linus Torvalds");
    for (const userId of [linus.user.id, member.user.id, "nobody"]) {
      const response = await ban(member, userId);
      expect(response.status, userId).toBe(403);
      expect(await response.json()).toEqual({ error: "Only administrators can ban people" });
    }
    expect((await stored(linus.user.id)).status).toBe(0);
  });

  it("finds nobody with an id nobody has", async () => {
    const administrator = await setUp();
    for (const userId of ["nobody", "%61"]) {
      const response = await ban(administrator, userId);
      expect(response.status, userId).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
  });

  it("doesn't let administrators ban themselves, so there's always one, unlike ember-rust", async () => {
    const administrator = await setUp();
    const response = await ban(administrator, administrator.user.id);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Administrators can't ban themselves" });
    expect(await signedIn(administrator)).toBe(true);
  });

  it("asks who's signed in", async () => {
    await setUp();
    const member = await join(grace);
    expect((await ban(null, member.user.id)).status).toBe(401);
    expect(await signedIn(member)).toBe(true);
  });

  it("still closes their sockets and deletes their messages when the database saves the ban but its answer is lost", async () => {
    const administrator = await setUp();
    const member = await join(grace);
    const lobby = await freshRoom("lobby");
    const graceInLobby = await connect(lobby, member);
    await post(graceInLobby, "Doomed");
    const closes = [closeOf(graceInLobby.ws), (await openWorkspaceSocket(member)).closed];
    await runInDurableObject(workspaceStub(), (workspace: Workspace) => {
      const store = (workspace as unknown as { store: WorkspaceStore }).store;
      const banPerson = store.banPerson.bind(store);
      store.banPerson = async (...args) => {
        await banPerson(...args);
        throw new Error("The database's answer was lost");
      };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await ban(administrator, member.user.id)).status).toBe(500);
    for (const close of await Promise.all(closes)) expect(close).toMatchObject({ code: CloseCode.Revoked });
    expect(await signedIn(member)).toBe(false);
    await purged();
    expect(await written(lobby, member.user.id)).toEqual([]);
  });

  it("lifts a ban, unblocking their addresses and making them active, without bringing back their messages", async () => {
    const administrator = await setUp();
    const member = await join(grace);
    await signInAsGrace("203.0.113.7");
    const lobby = await freshRoom("lobby");
    await post(await connect(lobby, member), "Gone for good");
    await ban(administrator, member.user.id);
    await purged();
    await workspaceSql("UPDATE users SET updated_at = ? WHERE id = ?", "2026-01-01T00:00:00.000Z", member.user.id);
    const banned = await listed(administrator, member.user.id);
    const sockets = [await openWorkspaceSocket(administrator), await openWorkspaceSocket(await signIn("Linus Torvalds"))];

    const response = await unban(administrator, member.user.id);
    expect(response.status).toBe(200);
    const { user } = (await response.json()) as ChangedPerson;
    expect(user).toEqual(await listed(administrator, member.user.id));
    expect(user).toMatchObject({ id: member.user.id, status: "active", role: "member" });
    // Its time changed, and the avatar's address with it.
    expect(user.avatarUrl).not.toBe(banned.avatarUrl);
    for (const socket of sockets) expect(await socket.next()).toEqual({ type: "user.updated", user });
    expect(await bansOf(member.user.id)).toEqual([]);
    expect(await stored(member.user.id)).toMatchObject({ status: 0 });
    expect(await written(lobby, member.user.id)).toEqual([]);
    expect((await signInFrom(grace, "203.0.113.7")).status).toBe(201);
  });

  it("keeps what they write once the ban is lifted, however late a room answers, deleting everything of theirs from before", async () => {
    const administrator = await setUp();
    const member = await join(grace);
    const lobby = await freshRoom("lobby");
    const graceInLobby = await connect(lobby, member);
    await post(graceInLobby, "Before the ban");
    // A year on, so the alarm the ban sets waits for the test, as the outbox does for a room it can't reach.
    vi.useFakeTimers({ toFake: ["Date"], now: LATER });
    expect((await ban(administrator, member.user.id)).status).toBe(200);
    vi.setSystemTime(LATER + 1_000);
    // Through the socket she had, before the room has closed it.
    await post(graceInLobby, "While banned");
    vi.setSystemTime(LATER + 2_000);
    expect((await unban(administrator, member.user.id)).status).toBe(200);
    vi.setSystemTime(LATER + 3_000);
    const back = await post(await connect(lobby, await signInAsGrace("203.0.113.7")), "Once back");
    expect(await workspaceSql("SELECT DISTINCT lifted_at FROM pending_purges")).toEqual([{ lifted_at: new Date(LATER + 2_000).toISOString() }]);

    await runInDurableObject(workspaceStub(), (workspace: Workspace) => workspace.alarm());
    expect(await written(lobby, member.user.id)).toEqual([back.id]);
    expect(await workspaceSql("SELECT * FROM pending_purges")).toEqual([]);
  });

  it("leaves someone active as they are, telling nobody", async () => {
    const administrator = await setUp();
    const member = await join(grace);
    const socket = await openWorkspaceSocket(administrator);
    const response = await unban(administrator, member.user.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: await listed(administrator, member.user.id) });
    expect(await socket.answers()).toBe(true);
  });

  it("makes whoever it's lifted for active, as ember-rust does, removed people too", async () => {
    const administrator = await setUp();
    const removed = await deactivatedPerson("Former");
    const response = await unban(administrator, removed);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { id: removed, status: "active" } });
  });

  it("lets only administrators lift bans, finding anyone whatever their status", async () => {
    const administrator = await setUp();
    const member = await join(grace);
    const linus = await signIn("Linus Torvalds");
    await ban(administrator, linus.user.id);
    for (const userId of [linus.user.id, "nobody"]) {
      const response = await unban(member, userId);
      expect(response.status, userId).toBe(403);
      expect(await response.json()).toEqual({ error: "Only administrators can lift bans" });
    }
    expect((await stored(linus.user.id)).status).toBe(2);
    const nobody = await unban(administrator, "nobody");
    expect(nobody.status).toBe(404);
    expect(await nobody.json()).toEqual({ error: "Not found" });
    expect((await unban(null, linus.user.id)).status).toBe(401);
  });

  it("asks each room to delete a page of their messages, and again at once while it has more", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: LATER });
    await queuePurge("lobby", "u1", LATER);
    await queuePurge("annex", "u1", LATER);
    await queuePurge("lobby", "u2", LATER + 1);
    const calls: unknown[] = [];
    let more = true;
    const rooms: Rooms = {
      removeMessagesBy: async (...call) => {
        calls.push(call);
        return call[0] === "lobby" && more;
      },
    };

    await runAlarm(rooms);
    expect(calls).toEqual([
      ["lobby", "u1", 100, null],
      ["annex", "u1", 100, null],
    ]);
    expect(await purges()).toEqual([
      { room_id: "lobby", user_id: "u1", attempts: 0, due_at: LATER },
      { room_id: "lobby", user_id: "u2", attempts: 0, due_at: LATER + 1 },
    ]);
    expect(await alarm()).toBe(LATER);

    more = false;
    await runAlarm(rooms);
    expect(calls).toHaveLength(3);
    expect(await purges()).toEqual([{ room_id: "lobby", user_id: "u2", attempts: 0, due_at: LATER + 1 }]);
    expect(await alarm()).toBe(LATER + 1);
  });

  it("never gives up on a room it can't reach, trying again twice as long after each time, up to the longest wait", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: LATER });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await queuePurge("lobby", "u1", LATER);
    let reachable = false;
    const rooms: Rooms = {
      removeMessagesBy: async () => {
        if (!reachable) throw new Error("The lobby isn't answering");
        return false;
      },
    };

    let now = LATER;
    for (let tries = 1; tries <= 12; tries++) {
      await runAlarm(rooms);
      const wait = Math.min(1000 * 2 ** (tries - 1), 5 * 60 * 1000);
      expect(await purges()).toEqual([{ room_id: "lobby", user_id: "u1", attempts: tries, due_at: now + wait }]);
      expect(await alarm()).toBe(now + wait);
      vi.setSystemTime((now += wait));
    }
    // However often it has failed.
    await workspaceSql("UPDATE pending_purges SET attempts = 100");
    await runAlarm(rooms);
    expect(await purges()).toEqual([{ room_id: "lobby", user_id: "u1", attempts: 101, due_at: now + 5 * 60 * 1000 }]);
    vi.setSystemTime((now += 5 * 60 * 1000));

    reachable = true;
    await runAlarm(rooms);
    expect(await purges()).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(13);
  });

  it("delivers 40 rows of its outbox a run, revocations first and then purges, and sets its alarm for the rest", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: LATER });
    const named = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}-${String(i).padStart(2, "0")}`);
    const [revoking, purging] = [named("revoking", 30), named("purging", 15)];
    await workspaceSql(
      "INSERT INTO pending_revocations (room_id, tag, code, due_at) SELECT value, 'u1', ?, ? FROM json_each(?)",
      CloseCode.Revoked,
      LATER,
      JSON.stringify(revoking),
    );
    await workspaceSql("INSERT INTO pending_purges (room_id, user_id, due_at) SELECT value, 'u1', ? FROM json_each(?)", LATER, JSON.stringify(purging));
    const calls: RoomId[] = [];
    const rooms: Rooms = {
      revoke: async (roomId) => void calls.push(roomId),
      removeMessagesBy: async (roomId) => {
        calls.push(roomId);
        return false;
      },
    };

    await runAlarm(rooms);
    expect(calls).toEqual([...revoking, ...purging.slice(0, 10)]);
    expect(await alarm()).toBe(LATER);
    await runAlarm(rooms);
    expect(calls).toEqual([...revoking, ...purging]);
    expect(await purges()).toEqual([]);
    expect(await alarm()).toBeNull();
  });

  it("forgets a deleted room's purges, its messages gone with it", async () => {
    const administrator = await setUp();
    const room = await createRoom("doomed", { as: administrator });
    await queuePurge(room.id, "u1", LATER);
    await queuePurge("elsewhere", "u1", LATER);
    expect((await api(`/api/rooms/${room.id}`, { method: "DELETE", headers: { Cookie: administrator.cookie } })).status).toBe(204);
    expect(await purges()).toEqual([{ room_id: "elsewhere", user_id: "u1", attempts: 0, due_at: LATER }]);
  });

  it("never gives a purge the id of one a room took with it while the alarm was asking that room, which it settles by", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: LATER });
    await queuePurge("doomed", "u1", LATER);
    const rooms: Rooms = {
      removeMessagesBy: async (roomId) => {
        if (roomId === "doomed") {
          // Meanwhile the room is deleted, as `deleteRoom` deletes its purges, and someone else is banned.
          await workspaceSql("DELETE FROM pending_purges WHERE room_id = ?", roomId);
          await queuePurge("lobby", "u2", LATER);
        }
        return false;
      },
    };

    await runAlarm(rooms);
    expect(await purges()).toEqual([{ room_id: "lobby", user_id: "u2", attempts: 0, due_at: LATER }]);
  });

  it("finds the purges that are due by their index, however many are waiting", async () => {
    const plan = (await workspaceSql(`EXPLAIN QUERY PLAN ${DUE_PURGES}`, 0, 40)).map((row) => (row as { detail: string }).detail).join("; ");
    expect(plan).toContain("USING INDEX index_pending_purges_on_due_at (due_at<?)");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  it("finds someone's messages in a room by the room's index, however many others wrote, before a time or not", async () => {
    const room = await freshRoom("purge-plan");
    const ada = await connect(room, "Ada");
    const queries: Array<[string, ...Array<string | number>]> = [
      [MESSAGES_BY, room, ada.me.id, 100],
      [MESSAGES_BY_UNTIL, room, ada.me.id, new Date().toISOString(), 100],
    ];
    for (const [query, ...params] of queries) {
      const plan = await roomSql(room, `EXPLAIN QUERY PLAN ${query}`, ...params);
      expect(plan.map((row) => (row as { detail: string }).detail).join("; "), query).toContain(
        "index_messages_on_room_id_and_creator_id_and_client_message_id (room_id=? AND creator_id=?)",
      );
    }
  });

  // ember-rust's tests of `Ban::validate` (crates/db/src/models/ban.rs), and more of what it inherits
  // from Rust's `IpAddr` and Ruby's `IPAddr`.
  describe("which addresses a ban can block", () => {
    it("blocks public addresses", () => {
      for (const ip of ["8.8.8.8", "2001:4860:4860::8888", "203.0.113.7", "::ffff:8.8.8.8", "FE00::1", "fec0::1", "::1.2.3.4", "::"]) {
        expect(banProblem(ip), ip).toBeNull();
      }
    });

    it("can't block loopback, private or link-local addresses, IPv4-mapped ones included", () => {
      const internal = [
        ...["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254"],
        ...["::1", "fc00::1", "fd12::1", "fe80::1", "FEBF::1", "[::1]"],
        ...["::ffff:10.0.0.1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe"],
      ];
      for (const ip of internal) expect(banProblem(ip), ip).toBe("internal");
    });

    it("takes any address with ffff before its last 32 bits for an IPv4-mapped one, as Ruby does", () => {
      expect(banProblem("1::ffff:10.0.0.1")).toBe("internal");
      expect(banProblem("1::ffff:8.8.8.8")).toBeNull();
    });

    it("masks an address with its prefix, as Ruby's IPAddr does, and takes one in brackets", () => {
      expect(banProblem("203.0.113.7/24")).toBeNull();
      expect(banProblem("10.0.0.1/8")).toBe("internal");
      // What's left once it's masked is what counts.
      expect(banProblem("10.0.0.1/0")).toBeNull();
      expect(banProblem("fe80::1/10")).toBe("internal");
      expect(banProblem("8.8.8.8/+8")).toBeNull();
      expect(banProblem("[2001:db8::1]")).toBeNull();
      expect(banProblem("[8.8.8.8]")).toBeNull();
    });

    it("finds garbage invalid, and whatever else Rust's parser refuses", () => {
      const invalid = [
        ...["not an ip", "", " 8.8.8.8", "08.8.8.8", "1.2.3", "1.2.3.4.5", "256.0.0.1", "1.2.3.4:80"],
        ...["1:2:3:4:5:6:7:8:9", "1::2::3", "1:2:3:4:5:6:7:1.2.3.4", "1.2.3.4::1", ":::", "1:", ":1", "12345::1"],
        ...["8.8.8.8/", "8.8.8.8/33", "2001:db8::/129", "8.8.8.8/-1", "8.8.8.8/8/8", "[]", "[", "[8.8.8.8"],
      ];
      for (const ip of invalid) expect(banProblem(ip), ip).toBe("invalid");
      for (const ip of ["1:2:3:4:5:6:7:8", "::1:2:3:4:5:6:7", "1:2:3:4:5:6:7::", "1:2:3:4:5:6:1.2.3.4", "0001::1"]) {
        expect(banProblem(ip), ip).toBeNull();
      }
    });
  });
});
