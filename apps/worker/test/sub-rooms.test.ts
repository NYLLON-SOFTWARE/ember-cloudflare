import { CloseCode, LOST_ACCESS, SUB_ROOM_REFUSED, type RoomId, type RoomSettings, type SharedRoom, type Sidebar, type UserId } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceServerFrame } from "@ember/protocol";
import { api, closeOf, connect, createRoom, direct, freshDeploy, openWorkspaceSocket, signIn, upgrade, workspaceSql, type Session, type WorkspaceSocket } from "./support";

beforeEach(freshDeploy);

const as = (session: Session) => ({ headers: { Cookie: session.cookie } });

const json = (session: Session, method: string, body: unknown) => ({ method, headers: { Cookie: session.cookie }, body: JSON.stringify(body) });

/** Creates a sub-room under `parentId` as `session`, answering the response. */
const createSubRoom = (session: Session, parentId: RoomId, room: Record<string, unknown>) => api("/api/rooms", json(session, "POST", { ...room, parentId }));

/** Creates a sub-room that should be made, answering it. */
async function subRoom(session: Session, parentId: RoomId, name: string, closedTo?: UserId[]): Promise<SharedRoom> {
  const response = await createSubRoom(session, parentId, closedTo ? { kind: "closed", name, memberIds: closedTo } : { kind: "open", name });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { room: SharedRoom }).room;
}

const change = (roomId: RoomId, session: Session, body: unknown) => api(`/api/rooms/${roomId}`, json(session, "PATCH", body));

/** Who's in a room, by id. */
const membersOf = async (roomId: RoomId) =>
  ((await workspaceSql("SELECT user_id FROM memberships WHERE room_id = ? ORDER BY user_id", roomId)) as Array<{ user_id: UserId }>).map((row) => row.user_id);

/** The next frame of `type` on a workspace socket, past any others. */
async function frameOf(socket: WorkspaceSocket, type: WorkspaceServerFrame["type"]): Promise<WorkspaceServerFrame> {
  for (;;) {
    const frame = await socket.next();
    if (frame.type === type) return frame;
  }
}

const ids = (...sessions: Session[]) => sessions.map((session) => session.user.id).sort();

const sidebarOf = async (session: Session) => (await (await api("/api/sidebar", as(session))).json()) as Sidebar;

/** What becomes of a new socket into a room as `session`'s person: let in, or the code and reason it's closed with at once. */
async function reconnecting(roomId: RoomId, session: Session): Promise<"welcome" | { code: number; reason: string }> {
  const ws = (await api(`/api/rooms/${roomId}/socket`, upgrade(session.cookie))).webSocket!;
  ws.accept();
  return new Promise((resolve) => {
    ws.addEventListener("message", () => {
      resolve("welcome");
      ws.close(1000);
    });
    ws.addEventListener("close", ({ code, reason }) => resolve({ code, reason }));
  });
}

/** What becomes of a new socket into a room as `session`'s person: let in, or the code it's closed with at once. */
async function reconnect(roomId: RoomId, session: Session): Promise<"welcome" | number> {
  const found = await reconnecting(roomId, session);
  return found === "welcome" ? found : found.code;
}

/** How a room turns away someone who's no longer in it, though it's still there. */
const lostAccess = { code: CloseCode.NotFound, reason: LOST_ACCESS };

describe("Creating a sub-room", () => {
  it("puts a room under a room, naming its parent wherever the room is read", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const strata = await createRoom("Strata", { as: ada });
    const sales = await subRoom(ada, strata.id, "Sales");

    expect(sales).toEqual({ id: sales.id, kind: "open", name: "Sales", icon: null, parent: { id: strata.id, name: "Strata" } });
    expect((await sidebarOf(grace)).rooms).toContainEqual(expect.objectContaining({ id: sales.id, parent: { id: strata.id, name: "Strata" } }));
    expect((await sidebarOf(grace)).rooms.find((room) => room.id === strata.id)).not.toHaveProperty("parent");
  });

  it("takes into an open sub-room of a private room only the people in its parent, and nobody who joins later", async () => {
    const [ada, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const strata = await createRoom("Strata", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const sales = await subRoom(ada, strata.id, "Sales");

    expect(await membersOf(sales.id)).toEqual(ids(ada, grace));
    expect(await reconnect(sales.id, linus)).toBe(CloseCode.NotFound);
    const alan = await signIn("Alan");
    expect(await membersOf(sales.id)).not.toContain(alan.user.id);
  });

  it("takes into an open sub-room of an open room everyone, as they join too", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const strata = await createRoom("Strata", { as: ada });
    const sales = await subRoom(ada, strata.id, "Sales");
    const linus = await signIn("Linus");

    expect(await membersOf(sales.id)).toEqual(ids(ada, grace, linus));
  });

  it("takes into a private sub-room the people named, who are all in its parent", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const strata = await createRoom("Strata", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const titling = await subRoom(ada, strata.id, "Titling", [ada.user.id, grace.user.id]);

    expect(await membersOf(titling.id)).toEqual(ids(ada, grace));
  });

  it("refuses a private sub-room naming people who aren't in its parent, naming them, and makes nothing", async () => {
    const [ada, grace, linus, alan] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus"), await signIn("Alan")];
    const strata = await createRoom("Strata", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const before = await workspaceSql("SELECT count(*) AS n FROM rooms");

    const one = await createSubRoom(ada, strata.id, { kind: "closed", name: "Titling", memberIds: [ada.user.id, linus.user.id] });
    expect(one.status).toBe(422);
    expect(await one.json()).toEqual({ error: "Linus isn't in Strata, so can't be in its sub-rooms" });
    const two = await createSubRoom(ada, strata.id, { kind: "closed", name: "Titling", memberIds: [linus.user.id, grace.user.id, alan.user.id] });
    expect(await two.json()).toEqual({ error: "Alan and Linus aren't in Strata, so can't be in its sub-rooms" });
    expect(await workspaceSql("SELECT count(*) AS n FROM rooms")).toEqual(before);
  });

  it("refuses a parent that's a sub-room, a DM, or a room its maker isn't in or can't change, making nothing", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const strata = await createRoom("Strata", { as: ada });
    const sales = await subRoom(ada, strata.id, "Sales");
    const hidden = await createRoom("Hidden", { closedTo: [grace.user.id], as: grace });
    const dm = await direct(ada, grace);
    const before = await workspaceSql("SELECT count(*) AS n FROM rooms");

    for (const [parentId, session] of [
      [sales.id, ada],
      [dm.id, ada],
      [hidden.id, ada],
      [strata.id, grace],
      ["nowhere", ada],
    ] as const) {
      const response = await createSubRoom(session, parentId, { kind: "open", name: "Nested" });
      expect(response.status, parentId).toBe(422);
      expect(await response.json()).toEqual({ error: SUB_ROOM_REFUSED });
    }
    expect((await api("/api/rooms", json(ada, "POST", { kind: "open", name: "Bad", parentId: 7 }))).status).toBe(422);
    expect(await workspaceSql("SELECT count(*) AS n FROM rooms")).toEqual(before);
  });
});

describe("Moving a room under a parent, or out", () => {
  it("takes out of the room everyone who isn't in its new parent, closing their sockets there", async () => {
    const [ada, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const strata = await createRoom("Strata", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const inventory = await createRoom("Inventory", { as: ada });
    const closed = closeOf((await connect(inventory.id, linus)).ws);
    const gone = await openWorkspaceSocket(linus);

    const response = await change(inventory.id, ada, { parentId: strata.id });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ room: { ...inventory, parent: { id: strata.id, name: "Strata" } } });
    expect(await membersOf(inventory.id)).toEqual(ids(ada, grace));
    expect(await closed).toMatchObject({ code: CloseCode.Reconnect });
    expect(await frameOf(gone, "room.gone")).toEqual({ type: "room.gone", roomId: inventory.id, lostAccess: true });
    expect(await reconnecting(inventory.id, linus)).toEqual(lostAccess);
  });

  it("opens a room taken out from under its parent to everyone, when it's open to everyone it can take in", async () => {
    const [ada, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const strata = await createRoom("Strata", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const sales = await subRoom(ada, strata.id, "Sales");

    const response = await change(sales.id, ada, { parentId: null });
    expect(await response.json()).toEqual({ room: { id: sales.id, kind: "open", name: "Sales", icon: null } });
    expect(await membersOf(sales.id)).toEqual(ids(ada, grace, linus));
  });

  it("refuses to put a room with sub-rooms under another, a room under itself or under a sub-room", async () => {
    const ada = await signIn("Ada");
    const [strata, other] = [await createRoom("Strata", { as: ada }), await createRoom("Other", { as: ada })];
    const sales = await subRoom(ada, strata.id, "Sales");

    for (const [roomId, parentId] of [
      [strata.id, other.id],
      [other.id, other.id],
      [other.id, sales.id],
    ]) {
      const response = await change(roomId!, ada, { parentId });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: SUB_ROOM_REFUSED });
    }
    expect(await workspaceSql("SELECT id, parent_id FROM rooms WHERE id IN (?, ?) ORDER BY id", strata.id, other.id)).toEqual(
      [
        { id: strata.id, parent_id: null },
        { id: other.id, parent_id: null },
      ].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
  });

  it("offers as parents the rooms its person can change that aren't sub-rooms, and none to a room with sub-rooms", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const strata = await createRoom("Strata", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const inventory = await createRoom("Inventory", { as: ada });
    await createRoom("Grace's", { as: grace });
    const sales = await subRoom(ada, strata.id, "Sales");

    const shown = (await (await api(`/api/rooms/${inventory.id}/settings`, as(ada))).json()) as RoomSettings;
    expect(shown.subRooms).toBe(0);
    expect(shown.parents).toEqual([{ id: strata.id, name: "Strata", icon: null, everyone: false, memberIds: ids(ada, grace) }]);
    const parent = (await (await api(`/api/rooms/${strata.id}/settings`, as(ada))).json()) as RoomSettings;
    expect(parent).toMatchObject({ subRooms: 1, parents: [] });
    expect(((await (await api(`/api/rooms/${sales.id}/settings`, as(ada))).json()) as RoomSettings).room.parent).toEqual({ id: strata.id, name: "Strata" });
  });
});

describe("Who's in a parent decides who can be in its sub-rooms", () => {
  it("takes whoever a parent no longer takes in out of its sub-rooms, closing their sockets there", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const strata = await createRoom("Strata", { as: ada });
    const [sales, titling] = [await subRoom(ada, strata.id, "Sales"), await subRoom(ada, strata.id, "Titling", [ada.user.id, grace.user.id])];
    const closed = closeOf((await connect(titling.id, grace)).ws);
    const told = await openWorkspaceSocket(grace);

    expect((await change(strata.id, ada, { kind: "closed", memberIds: [ada.user.id] })).status).toBe(200);
    expect(await membersOf(sales.id)).toEqual(ids(ada));
    expect(await membersOf(titling.id)).toEqual(ids(ada));
    expect(await closed).toMatchObject({ code: CloseCode.Reconnect });
    const frames = [await frameOf(told, "room.gone"), await frameOf(told, "room.gone"), await frameOf(told, "room.gone")];
    expect(frames.map((frame) => (frame as { roomId: RoomId }).roomId).sort()).toEqual([strata.id, sales.id, titling.id].sort());
    expect(frames.every((frame) => (frame as { lostAccess?: true }).lostAccess)).toBe(true);
    expect(await reconnecting(sales.id, grace)).toEqual(lostAccess);
    expect(await reconnecting(titling.id, grace)).toEqual(lostAccess);
  });

  it("puts a parent's new people in its open sub-rooms, but not its private ones", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const strata = await createRoom("Strata", { closedTo: [ada.user.id], as: ada });
    const [sales, titling] = [await subRoom(ada, strata.id, "Sales"), await subRoom(ada, strata.id, "Titling", [ada.user.id])];
    const told = await openWorkspaceSocket(grace);

    await change(strata.id, ada, { kind: "closed", memberIds: [ada.user.id, grace.user.id] });
    expect(await membersOf(sales.id)).toEqual(ids(ada, grace));
    expect(await membersOf(titling.id)).toEqual(ids(ada));
    expect(await frameOf(told, "rooms.reordered")).toEqual({ type: "rooms.reordered" });
  });

  it("takes someone leaving a parent out of its sub-rooms too", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const strata = await createRoom("Strata", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const sales = await subRoom(ada, strata.id, "Sales");

    expect((await api(`/api/rooms/${strata.id}/membership`, { method: "DELETE", headers: { Cookie: grace.cookie } })).status).toBeLessThan(300);
    expect(await membersOf(sales.id)).toEqual(ids(ada));
    expect(await reconnecting(sales.id, grace)).toEqual(lostAccess);
  });

  it("lets a sub-room's private list name only people in its parent", async () => {
    const [ada, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const strata = await createRoom("Strata", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const sales = await subRoom(ada, strata.id, "Sales", [ada.user.id]);

    await change(sales.id, ada, { kind: "closed", memberIds: [ada.user.id, grace.user.id, linus.user.id] });
    expect(await membersOf(sales.id)).toEqual(ids(ada, grace));
    await change(sales.id, ada, { kind: "open" });
    expect(await membersOf(sales.id)).toEqual(ids(ada, grace));
  });

  it("has the people of a renamed parent's sub-rooms read them again, with its new name", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const strata = await createRoom("Strata", { as: ada });
    const sales = await subRoom(ada, strata.id, "Sales");
    const told = await openWorkspaceSocket(grace);

    await change(strata.id, ada, { name: "Strata Motors" });
    expect(await frameOf(told, "rooms.reordered")).toEqual({ type: "rooms.reordered" });
    expect((await sidebarOf(grace)).rooms.find((room) => room.id === sales.id)).toMatchObject({ parent: { id: strata.id, name: "Strata Motors" } });
  });
});

describe("Deleting a parent", () => {
  it("makes its sub-rooms rooms of their own, keeping who's in them, and a sub-room open to a private parent's people private to them", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const strata = await createRoom("Strata", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const [sales, titling] = [await subRoom(ada, strata.id, "Sales"), await subRoom(ada, strata.id, "Titling", [ada.user.id])];
    const told = await openWorkspaceSocket(grace);

    expect((await api(`/api/rooms/${strata.id}`, { method: "DELETE", headers: { Cookie: ada.cookie } })).status).toBe(204);
    expect(await workspaceSql("SELECT id, kind, parent_id FROM rooms WHERE id IN (?, ?) ORDER BY name", sales.id, titling.id)).toEqual([
      { id: sales.id, kind: "closed", parent_id: null },
      { id: titling.id, kind: "closed", parent_id: null },
    ]);
    expect(await membersOf(sales.id)).toEqual(ids(ada, grace));
    expect(await membersOf(titling.id)).toEqual(ids(ada));
    await frameOf(told, "rooms.reordered");
    expect((await sidebarOf(grace)).rooms.find((room) => room.id === sales.id)).not.toHaveProperty("parent");
  });

  it("tells its people it was deleted, rather than that they lost access", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const strata = await createRoom("Strata", { closedTo: [ada.user.id, grace.user.id], as: ada });
    await subRoom(ada, strata.id, "Sales");
    const told = await openWorkspaceSocket(grace);

    await api(`/api/rooms/${strata.id}`, { method: "DELETE", headers: { Cookie: ada.cookie } });
    expect(await frameOf(told, "room.gone")).toEqual({ type: "room.gone", roomId: strata.id });
    expect(await reconnecting(strata.id, grace)).toEqual({ code: CloseCode.NotFound, reason: "NotFound" });
  });

  it("keeps an open parent's open sub-rooms open", async () => {
    const ada = await signIn("Ada");
    const strata = await createRoom("Strata", { as: ada });
    const sales = await subRoom(ada, strata.id, "Sales");

    await api(`/api/rooms/${strata.id}`, { method: "DELETE", headers: { Cookie: ada.cookie } });
    expect(await workspaceSql("SELECT kind, parent_id FROM rooms WHERE id = ?", sales.id)).toEqual([{ kind: "open", parent_id: null }]);
  });
});
