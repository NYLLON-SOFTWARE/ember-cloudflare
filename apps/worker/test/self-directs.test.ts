import { CloseCode, type DirectRoom, type RoomId, type Sidebar, type WorkspaceServerFrame } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { api, connect, direct, freshDeploy, listedRoom, openWorkspaceSocket, post, roomSql, signIn, startDirect, upgrade, workspaceSql, type Session, type WorkspaceSocket } from "./support";

beforeEach(freshDeploy);

/** The DM a start answered with. */
const startedRoom = async (response: Response) => ((await response.json()) as { room: DirectRoom }).room;

/** The sidebar `session`'s person gets. */
const sidebarOf = async (session: Session) => (await (await api("/api/sidebar", { headers: { Cookie: session.cookie } })).json()) as Sidebar;

/** The DMs `session`'s person sees listed, as the sidebar lists them. */
async function directsOf(session: Session) {
  return (await sidebarOf(session)).rooms.filter((room) => room.kind === "direct");
}

const directCount = async () => ((await workspaceSql("SELECT count(*) AS n FROM rooms WHERE kind = 'direct'")) as Array<{ n: number }>)[0]!.n;

const membershipsOf = (roomId: RoomId) => workspaceSql("SELECT user_id, involvement FROM memberships WHERE room_id = ? ORDER BY user_id", roomId);

/** What becomes of a new socket into a room as `session`'s person: let in, or the code it's closed with at once. */
async function opened(roomId: RoomId, session: Session): Promise<"welcome" | number> {
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

/** Waits until room `room` has nothing left in its log, which it forgets once the Workspace has applied it. */
async function applied(room: RoomId): Promise<void> {
  while ((await roomSql(room, "SELECT seq FROM room_events WHERE room_id = ?", room)).length > 0) await new Promise((resolve) => setTimeout(resolve, 5));
}

/**
 * What `tab` has heard, once the Workspace has applied everything room `room` has logged, if given: the
 * frames that come before a pong.
 */
async function heard(tab: WorkspaceSocket, room?: RoomId): Promise<WorkspaceServerFrame[]> {
  if (room) await applied(room);
  tab.send(JSON.stringify({ type: "ping", nonce: crypto.randomUUID() }));
  const frames: WorkspaceServerFrame[] = [];
  for (let frame = await tab.next(); frame.type !== "pong"; frame = await tab.next()) frames.push(frame);
  return frames;
}

describe("Your DM with yourself", () => {
  it("starts your DM with yourself, you alone in it at the everything level, listed in your sidebar and nobody else's", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const response = await startDirect(ada, []);
    expect(response.status).toBe(201);
    const room = await startedRoom(response);
    expect(room).toEqual({ id: expect.any(String), kind: "direct", members: [{ id: ada.user.id, name: "Ada" }], activeAt: expect.any(String) });
    expect(await membershipsOf(room.id)).toEqual([{ user_id: ada.user.id, involvement: "everything" }]);
    expect(await directsOf(ada)).toEqual([listedRoom(room)]);
    expect(await directsOf(grace)).toEqual([]);
  });

  it("opens the same one again, however it's named", async () => {
    const ada = await signIn("Ada");
    const room = await startedRoom(await startDirect(ada, []));
    for (const userIds of [[], [ada.user.id]]) {
      const response = await startDirect(ada, userIds);
      expect(response.status).toBe(200);
      expect(await startedRoom(response)).toEqual(room);
    }
    expect(await directCount()).toBe(1);
  });

  it("keeps each person's self-DM theirs alone", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const adas = await startedRoom(await startDirect(ada, []));
    const graces = await startedRoom(await startDirect(grace, []));
    expect(graces.id).not.toBe(adas.id);
    expect(await directsOf(ada)).toEqual([listedRoom(adas)]);
    expect(await directsOf(grace)).toEqual([listedRoom(graces)]);
    expect(await directCount()).toBe(2);
    expect(await opened(adas.id, grace)).toBe(CloseCode.NotFound);
    expect(await opened(graces.id, ada)).toBe(CloseCode.NotFound);
  });

  it("carries a note to yourself round the room's socket, and tells your other tabs it's active without marking it unread", async () => {
    const ada = await signIn("Ada");
    const room = await startedRoom(await startDirect(ada, []));
    const [firstTab, secondTab] = [await openWorkspaceSocket(ada), await openWorkspaceSocket(ada)];

    const message = await post(await connect(room.id, ada, { visible: true }), "Note to self");
    expect(message.body).toBe("Note to self");
    // Yours alone, so nobody's tab marks it unread, and both hear it moving the DM.
    const active = { type: "room.active", roomId: room.id, at: message.createdAt };
    expect(await heard(firstTab, room.id)).toEqual([active]);
    expect(await heard(secondTab, room.id)).toEqual([active]);
    expect((await directsOf(ada)).map((listed) => listed.activeAt)).toEqual([message.createdAt]);
  });

  it("leaves the DMs between people one per pair, and the refusals, as they were", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    await startDirect(ada, []);
    await startDirect(grace, []);
    expect(await directCount()).toBe(2);

    // Two starts of the same DM at once still make one between them.
    const responses = await Promise.all([startDirect(ada, [grace.user.id]), startDirect(grace, [ada.user.id])]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const [first, second] = await Promise.all(responses.map(startedRoom));
    expect(first).toEqual(second);
    expect(await directCount()).toBe(3);

    // Whoever starts it, in whatever order it's named, opens the one they have.
    expect((await direct(ada, grace)).id).toBe(first!.id);
    expect(await directCount()).toBe(3);

    for (const userIds of ["ada", [7], null]) expect((await startDirect(ada, userIds)).status).toBe(422);
    expect(await directCount()).toBe(3);
  });
});
