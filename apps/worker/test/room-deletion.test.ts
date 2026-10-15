import { feature } from "@ember/parity";
import { CloseCode, type RoomId, type Sidebar } from "@ember/protocol";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { EVERYONE, REVOCATIONS_KEPT_MS } from "../src/revocations";
import type { Workspace } from "../src/workspace";
import type { WorkspaceStore } from "../src/workspace-store";
import {
  api,
  closeOf,
  connect,
  createRoom,
  forwardUpgrade,
  freshDeploy,
  post,
  roomSql,
  roomStub,
  settle,
  signIn,
  upgrade,
  workspaceSql,
  workspaceStub,
  type Access,
  type Session,
  type Socket,
} from "./support";

const bindings = env as unknown as Env;

beforeEach(freshDeploy);

const remove = (roomId: RoomId, session: Session) => api(`/api/rooms/${roomId}`, { method: "DELETE", headers: { Cookie: session.cookie } });

/** Makes someone an administrator, as only first run can yet. */
const promote = (session: Session) => workspaceSql("UPDATE users SET role = 1 WHERE id = ?", session.user.id);

/** The ids of the rooms `session`'s person sees listed. */
const listed = async (session: Session) => ((await (await api("/api/sidebar", { headers: { Cookie: session.cookie } })).json()) as Sidebar).rooms.map((room) => room.id);

/** Waits for the Workspace to deliver every revocation it queued, which the rooms have finished with by then. */
const delivered = () => vi.waitFor(async () => expect(await workspaceSql("SELECT count(*) AS n FROM pending_revocations")).toEqual([{ n: 0 }]), { timeout: 5_000 });

const countIn = async (roomId: RoomId, table: "messages" | "boosts" | "message_deletions") =>
  ((await roomSql(roomId, `SELECT count(*) AS n FROM ${table} WHERE room_id = ?`, roomId)) as Array<{ n: number }>)[0]!.n;

/** Posts a message as `client` and deletes it. */
async function deletePosted(client: Socket, body: string): Promise<void> {
  const message = await post(client, body);
  client.send({ type: "message.delete", messageId: message.id });
  await client.next("message.deleted");
}

/** What becomes of a new socket into a room as `session`'s person: let in, or the code it's closed with at once. */
async function reconnect(roomId: RoomId, session: Session): Promise<"welcome" | number> {
  const ws = (await api(`/api/rooms/${roomId}/socket`, upgrade(session.cookie))).webSocket!;
  ws.accept();
  return new Promise((resolve) => {
    ws.addEventListener("message", () => {
      resolve("welcome");
      ws.close(1000);
    });
    ws.addEventListener("close", (event) => resolve(event.code));
  });
}

/** What becomes of a socket the Worker sends on to the room, once the Workspace has let it through: let in, or the code it's closed with. */
async function outcome(roomId: RoomId, access: Access): Promise<"welcome" | number> {
  const ws = (await forwardUpgrade(roomId, access)).webSocket!;
  ws.accept();
  return new Promise((resolve) => {
    ws.addEventListener("message", () => {
      resolve("welcome");
      ws.close(1000);
    });
    ws.addEventListener("close", (event) => resolve(event.code));
  });
}

/** Adds a DM between `sessions`, as nothing else can yet. */
async function direct(...sessions: Session[]): Promise<RoomId> {
  const id = `direct-${crypto.randomUUID().slice(0, 8)}`;
  await workspaceSql(`INSERT INTO rooms (id, kind, creator_id, created_at, updated_at) VALUES (?, 'direct', ?, 'now', 'now')`, id, sessions[0]!.user.id);
  for (const { user } of sessions) {
    await workspaceSql(`INSERT INTO memberships (room_id, user_id, created_at, updated_at) VALUES (?, ?, 'now', 'now')`, id, user.id);
  }
  return id;
}

describe(feature("rooms.delete"), () => {
  it("deletes a room for whoever made it, closing every socket in it, whose people find it gone", async () => {
    const [ada, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const [room, annex] = [await createRoom("Design", { as: ada }), await createRoom("Annex", { as: ada })];
    const inRoom = [await connect(room.id, ada), await connect(room.id, ada), await connect(room.id, grace)];
    const linusInAnnex = await connect(annex.id, linus);
    const closes = inRoom.map((client) => closeOf(client.ws));

    const response = await remove(room.id, ada);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    for (const close of await Promise.all(closes)) expect(close).toMatchObject({ code: CloseCode.NotFound, reason: "NotFound" });
    expect(await reconnect(room.id, grace)).toBe(CloseCode.NotFound);
    expect(await workspaceSql("SELECT * FROM rooms WHERE id = ?", room.id)).toEqual([]);
    expect(await workspaceSql("SELECT * FROM memberships WHERE room_id = ?", room.id)).toEqual([]);
    expect(await listed(grace)).toEqual([annex.id]);

    // Everyone else carries on where they were.
    expect((await post(linusInAnnex, "Still in the annex")).body).toBe("Still in the annex");
    await delivered();
  });

  it("deletes the room's messages, their reactions and the deletions it kept for reconnecting tabs, and no other room's", async () => {
    const ada = await signIn("Ada");
    const [room, annex] = [await createRoom("Design", { as: ada }), await createRoom("Annex", { as: ada })];
    const inRoom = await connect(room.id, ada);
    const message = await post(inRoom, "Gone soon");
    inRoom.send({ type: "boost.create", messageId: message.id, content: "👍" });
    await inRoom.next("boost.created");
    await deletePosted(inRoom, "Me too");
    const inAnnex = await connect(annex.id, ada);
    await post(inAnnex, "Staying");
    await deletePosted(inAnnex, "Not staying");
    const closed = closeOf(inRoom.ws);

    expect((await remove(room.id, ada)).status).toBe(204);
    await closed;
    await delivered();
    expect(await countIn(room.id, "messages")).toBe(0);
    expect(await countIn(room.id, "boosts")).toBe(0);
    expect(await countIn(room.id, "message_deletions")).toBe(0);
    expect(await countIn(annex.id, "messages")).toBe(1);
    expect(await countIn(annex.id, "message_deletions")).toBe(1);
    await settle(inAnnex);
  });

  it("lets administrators delete the rooms they're in, and refuses other members, changing nothing", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await createRoom("Design", { as: ada });
    const graceInRoom = await connect(room.id, grace);
    await post(graceInRoom, "Mine to keep");

    const refused = await remove(room.id, grace);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "Only administrators and the room's creator can delete it" });
    expect(await workspaceSql("SELECT id FROM rooms WHERE id = ?", room.id)).toEqual([{ id: room.id }]);
    expect((await post(graceInRoom, "Still here")).body).toBe("Still here");

    await promote(grace);
    const closed = closeOf(graceInRoom.ws);
    expect((await remove(room.id, grace)).status).toBe(204);
    expect(await closed).toMatchObject({ code: CloseCode.NotFound });
    expect(await listed(ada)).toEqual([]);
  });

  it("answers 404 to people who aren't in the room, administrators included, and for missing rooms and DMs", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    await promote(grace);
    const room = await createRoom("Leads", { closedTo: [ada.user.id], as: ada });
    const dm = await direct(ada, grace);

    for (const [roomId, session] of [[room.id, grace], ["nowhere", ada], [dm, ada], ["%FF", ada]] as const) {
      const response = await remove(roomId, session);
      expect(response.status, roomId).toBe(404);
      expect(await response.json()).toEqual({ error: "Room not found or inaccessible" });
    }
    expect(await workspaceSql("SELECT id FROM rooms WHERE id IN (?, ?) ORDER BY id", room.id, dm)).toEqual([room.id, dm].sort().map((id) => ({ id })));
  });

  it("asks who's signed in, and refuses deletions from other sites", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Design", { as: ada });
    expect((await api(`/api/rooms/${room.id}`, { method: "DELETE" })).status).toBe(401);
    const crossSite = await api(`/api/rooms/${room.id}`, { method: "DELETE", headers: { Cookie: ada.cookie, Origin: "https://evil.test" } });
    expect(crossSite.status).toBe(422);
    expect(await listed(ada)).toEqual([room.id]);
  });

  it("still closes the room's sockets when the database saves the deletion but its answer is lost", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Design", { as: ada });
    const closed = closeOf((await connect(room.id, ada)).ws);
    await runInDurableObject(workspaceStub(), (workspace: Workspace) => {
      const store = (workspace as unknown as { store: WorkspaceStore }).store;
      const deleteRoom = store.deleteRoom.bind(store);
      store.deleteRoom = async (...args) => {
        await deleteRoom(...args);
        throw new Error("The database's answer was lost");
      };
    });

    expect((await remove(room.id, ada)).status).toBe(500);
    expect(await closed).toMatchObject({ code: CloseCode.NotFound });
    await delivered();
  });

  it("waits for a change under way to finish before deleting the room", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    await promote(grace);
    const room = await createRoom("Leads", { as: ada });
    // Holds Grace's change between reading who may make it and writing, as D1 can, until Ada's
    // deletion has finished, or for a second if it's waiting for Grace's change.
    const race = { graceHasRead: false, adaIsDone: false };
    await runInDurableObject(workspaceStub(), (workspace: Workspace) => {
      const store = (workspace as unknown as { store: WorkspaceStore }).store;
      const roomToChange = store.roomToChange.bind(store);
      store.roomToChange = async (roomId, userId) => {
        const found = await roomToChange(roomId, userId);
        if (userId !== grace.user.id) return found;
        race.graceHasRead = true;
        for (let waited = 0; !race.adaIsDone && waited < 1_000; waited += 10) await scheduler.wait(10);
        return found;
      };
    });

    // Saved after the deletion, it would add members to a room that's gone, which the database refuses.
    const madePrivate = api(`/api/rooms/${room.id}`, {
      method: "PATCH",
      headers: { Cookie: grace.cookie },
      body: JSON.stringify({ kind: "closed", memberIds: [ada.user.id, grace.user.id] }),
    });
    await vi.waitFor(() => expect(race.graceHasRead).toBe(true));
    const deleted = await remove(room.id, ada);
    race.adaIsDone = true;
    expect((await madePrivate).status).toBe(200);
    expect(deleted.status).toBe(204);
    expect(await workspaceSql("SELECT * FROM rooms WHERE id = ?", room.id)).toEqual([]);
    await delivered();
  });

  it("still deletes the room when it's deleted while a revocation in it is on its way", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await createRoom("Leads", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const adaInRoom = await connect(room.id, ada);
    await post(adaInRoom, "Gone soon");
    const graceInRoom = await connect(room.id, grace);
    // Holds the Workspace's delivery of Grace's revocation, the newest in its outbox, between reading
    // it and delivering it, until the room is deleted, or for a second.
    const race = { alarmHasRead: false, roomIsDeleted: false };
    await runInDurableObject(workspaceStub(), (workspace: Workspace) => {
      const store = (workspace as unknown as { store: WorkspaceStore }).store;
      const dueRevocations = store.dueRevocations.bind(store);
      store.dueRevocations = async (...args) => {
        const due = await dueRevocations(...args);
        if (race.alarmHasRead || !due.some(({ tag }) => tag === grace.user.id)) return due;
        race.alarmHasRead = true;
        for (let waited = 0; !race.roomIsDeleted && waited < 1_000; waited += 10) await scheduler.wait(10);
        return due;
      };
    });
    const closed = [closeOf(adaInRoom.ws), closeOf(graceInRoom.ws)];

    const takeGraceOut = { kind: "closed", memberIds: [ada.user.id] };
    const changed = await api(`/api/rooms/${room.id}`, { method: "PATCH", headers: { Cookie: ada.cookie }, body: JSON.stringify(takeGraceOut) });
    expect(changed.status).toBe(200);
    await vi.waitFor(() => expect(race.alarmHasRead).toBe(true));
    expect((await remove(room.id, ada)).status).toBe(204);
    race.roomIsDeleted = true;

    // Settling Grace's delivery leaves the deletion queued, to be delivered in turn.
    await delivered();
    expect(await countIn(room.id, "messages")).toBe(0);
    const [adaClosed, graceClosed] = await Promise.all(closed);
    expect(adaClosed).toMatchObject({ code: CloseCode.NotFound });
    expect(graceClosed).toMatchObject({ code: CloseCode.Reconnect });
  });

  it("turns away a socket let through at or before the room was deleted, telling it to reconnect", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Design", { as: ada });
    const deletedAt = Date.now();
    await roomStub(room.id).revoke(room.id, [{ tag: EVERYONE, code: CloseCode.NotFound }], deletedAt);

    const laptop = (authorizedAt: number) => ({ user: ada.user, sessionId: "laptop", authorizedAt });
    expect(await outcome(room.id, laptop(deletedAt - 1))).toBe(CloseCode.Reconnect);
    expect(await outcome(room.id, laptop(deletedAt))).toBe(CloseCode.Reconnect);
  });

  it("erases what's left of the room once no socket let through before could still arrive", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Design", { as: ada });
    const inRoom = await connect(room.id, ada);
    await post(inRoom, "Gone soon");
    const closed = closeOf(inRoom.ws);
    const deletedAt = Date.now();
    expect((await remove(room.id, ada)).status).toBe(204);
    await closed;
    await delivered();

    const alarm = await runInDurableObject(roomStub(room.id), (_room, state: DurableObjectState) => state.storage.getAlarm());
    expect(alarm).toBeGreaterThanOrEqual(deletedAt + REVOCATIONS_KEPT_MS);
    expect(await roomSql(room.id, "SELECT tag FROM revocations WHERE room_id = ?", room.id)).toEqual([{ tag: EVERYONE }]);

    expect(await runDurableObjectAlarm(roomStub(room.id))).toBe(true);
    const left = await runInDurableObject(roomStub(room.id), async (_room, state: DurableObjectState) => ({
      tables: state.storage.sql.exec(`SELECT name FROM sqlite_master WHERE name NOT LIKE '\\_cf\\_%' ESCAPE '\\'`).toArray(),
      keys: [...(await state.storage.list()).keys()],
      alarm: await state.storage.getAlarm(),
    }));
    expect(left).toEqual({ tables: [], keys: [], alarm: null });
    if (bindings.STORAGE_BACKEND === "d1") {
      // Where every room's tables are shared.
      expect(await roomSql(room.id, "SELECT tag FROM revocations WHERE room_id = ?", room.id)).toEqual([]);
      expect(await countIn(room.id, "messages")).toBe(0);
    }
  });
});

describe(feature("rooms.legacy-rooms"), () => {
  it("doesn't bring back a room it registered once it's deleted", async () => {
    const ada = await signIn("Ada");
    await promote(ada);
    const id = `legacy-${crypto.randomUUID().slice(0, 8)}`;
    await workspaceStub().registerLegacyRooms([id]);
    expect(await listed(ada)).toEqual([id]);

    expect((await remove(id, ada)).status).toBe(204);
    await workspaceStub().registerLegacyRooms([id]);
    expect(await workspaceSql("SELECT * FROM rooms WHERE id = ?", id)).toEqual([]);
    expect(await workspaceSql("SELECT id FROM deleted_rooms")).toEqual([{ id }]);
    expect(await listed(ada)).toEqual([]);
  });
});
