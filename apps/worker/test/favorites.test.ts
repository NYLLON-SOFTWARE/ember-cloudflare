import { feature } from "@ember/parity";
import type { Favorites, RoomId, Sidebar, WorkspaceServerFrame } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_FAVORITES } from "../src/workspace-store";
import { api, createRoom, freshDeploy, openWorkspaceSocket, signIn, workspaceSql, type Session } from "./support";

/** Stars room `roomId` for `session`'s person, or unstars it, as the star in its header does. */
const star = (session: Session, roomId: RoomId, favorite = true) =>
  api(`/api/rooms/${roomId}/favorite`, { method: "PUT", headers: { Cookie: session.cookie }, body: JSON.stringify({ favorite }) });

/** What a star or unstar answers: the person's stars as they are then. */
const answered = async (response: Promise<Response>) => {
  const settled = await response;
  expect(settled.status, await settled.clone().text()).toBe(200);
  return ((await settled.json()) as { favorites: Favorites }).favorites;
};

/** The stars `GET /api/sidebar` gives `session`'s person. */
const favoritesOf = async (session: Session) => ((await (await api("/api/sidebar", { headers: { Cookie: session.cookie } })).json()) as Sidebar).favorites;

/** The rooms `session`'s person has stars on, whether or not they can star them now, in order. */
const storedStars = async (session: Session) =>
  (await workspaceSql("SELECT room_id FROM favorites WHERE user_id = ? ORDER BY position", session.user.id)).map((row) => (row as { room_id: RoomId }).room_id);

/** Hides room `roomId` from `session`'s person, as setting its involvement to Invisible will, or shows it again. */
const hide = (session: Session, roomId: RoomId, hidden = true) =>
  workspaceSql("UPDATE memberships SET involvement = ? WHERE room_id = ? AND user_id = ?", hidden ? "invisible" : "mentions", roomId, session.user.id);

beforeEach(freshDeploy);

describe(feature("sidebar.favorites"), () => {
  it("stars a room for you alone, after your other stars, answering your stars in order", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const design = await createRoom("Design");
    const ops = await createRoom("Ops");

    expect(await answered(star(ada, ops.id))).toEqual({ rooms: [ops.id], version: 1 });
    expect(await answered(star(ada, design.id))).toEqual({ rooms: [ops.id, design.id], version: 2 });
    expect(await favoritesOf(ada)).toEqual({ rooms: [ops.id, design.id], version: 2 });
    expect(await favoritesOf(grace)).toEqual({ rooms: [], version: 0 });
  });

  it("keeps a starred room's place when it's starred again, and unstars it", async () => {
    const ada = await signIn("Ada");
    const design = await createRoom("Design");
    const ops = await createRoom("Ops");
    await star(ada, ops.id);
    await star(ada, design.id);

    expect(await answered(star(ada, ops.id))).toEqual({ rooms: [ops.id, design.id], version: 3 });
    expect(await answered(star(ada, ops.id, false))).toEqual({ rooms: [design.id], version: 4 });
    // Unstarring it again is answered the same, as ember-rust saves the list it has either way.
    expect(await answered(star(ada, ops.id, false))).toEqual({ rooms: [design.id], version: 5 });
    expect(await answered(star(ada, ops.id))).toEqual({ rooms: [design.id, ops.id], version: 6 });
  });

  it("tells every tab of yours what your stars are now, and nobody else", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const design = await createRoom("Design");
    const tabs = [await openWorkspaceSocket(ada), await openWorkspaceSocket(ada)];
    const gracesTab = await openWorkspaceSocket(grace);

    await star(ada, design.id);
    const changed: WorkspaceServerFrame = { type: "favorites.changed", favorites: { rooms: [design.id], version: 1 } };
    for (const tab of tabs) expect(await tab.next()).toEqual(changed);
    expect(await gracesTab.answers()).toBe(true);
  });

  it("lists your stars in your sidebar, whose ETag changes with them", async () => {
    const ada = await signIn("Ada");
    const design = await createRoom("Design");
    const before = await api("/api/sidebar", { headers: { Cookie: ada.cookie } });

    await star(ada, design.id);
    const after = await api("/api/sidebar", { headers: { Cookie: ada.cookie, "If-None-Match": before.headers.get("ETag")! } });
    expect(after.status).toBe(200);
    expect(((await after.json()) as Sidebar).favorites).toEqual({ rooms: [design.id], version: 1 });
  });

  it("answers 403, changing nothing, for a DM, a room you've hidden or aren't in, or one that doesn't exist", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const secret = await createRoom("Secret", { closedTo: [grace.user.id] });
    const hidden = await createRoom("Hidden");
    await hide(ada, hidden.id);
    // DMs can't be made yet, so this one is written as ember-rust stores them, with no name.
    const direct = `direct-${crypto.randomUUID()}`;
    await workspaceSql("INSERT INTO rooms (id, kind, created_at, updated_at) VALUES (?, 'direct', 'now', 'now')", direct);
    await workspaceSql("INSERT INTO memberships (room_id, user_id, created_at, updated_at) VALUES (?, ?, 'now', 'now')", direct, ada.user.id);

    for (const roomId of [direct, hidden.id, secret.id, "no-such-room"]) {
      for (const favorite of [true, false]) expect((await star(ada, roomId, favorite)).status, `${roomId}, ${favorite}`).toBe(403);
    }
    expect(await favoritesOf(ada)).toEqual({ rooms: [], version: 0 });
    expect(await storedStars(ada)).toEqual([]);
  });

  it("answers 400 for an id that isn't a room's, or a favorite that isn't true or false", async () => {
    const ada = await signIn("Ada");
    const design = await createRoom("Design");
    const put = (roomId: string, body: string) => api(`/api/rooms/${roomId}/favorite`, { method: "PUT", headers: { Cookie: ada.cookie }, body });

    const unreadable = await put("Not%20a%20room", JSON.stringify({ favorite: true }));
    expect(unreadable.status).toBe(400);
    expect(await unreadable.json()).toEqual({ error: "invalid room ID" });
    for (const body of [JSON.stringify({ favorite: "true" }), JSON.stringify({ favorite: 1 }), "{}", "null", "[true]", "true", "not JSON"]) {
      const response = await put(design.id, body);
      expect(response.status, body).toBe(400);
      expect(await response.json()).toEqual({ error: "favorite must be true or false" });
    }
    expect(await favoritesOf(ada)).toEqual({ rooms: [], version: 0 });
  });

  it("answers 401 to someone signed out, whatever they send", async () => {
    for (const roomId of [(await createRoom("Design")).id, "Not%20a%20room"]) {
      const response = await api(`/api/rooms/${roomId}/favorite`, { method: "PUT", body: "not JSON" });
      expect(response.status).toBe(401);
    }
  });

  it("leaves out stars on rooms you've since left or hidden, or that were deleted, and drops them at your next star", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const design = await createRoom("Design");
    const secret = await createRoom("Secret", { closedTo: [ada.user.id, grace.user.id], as: grace });
    const hidden = await createRoom("Hidden");
    const gone = await createRoom("Gone", { as: grace });
    for (const room of [secret, hidden, gone]) await star(ada, room.id);

    const takeAdaOut = await api(`/api/rooms/${secret.id}`, {
      method: "PATCH",
      headers: { Cookie: grace.cookie },
      body: JSON.stringify({ kind: "closed", memberIds: [grace.user.id] }),
    });
    expect(takeAdaOut.status).toBe(200);
    await hide(ada, hidden.id);
    expect((await api(`/api/rooms/${gone.id}`, { method: "DELETE", headers: { Cookie: grace.cookie } })).status).toBe(204);

    expect(await favoritesOf(ada)).toEqual({ rooms: [], version: 3 });
    // As in ember-rust, they're kept until then, so a room shown again is starred again.
    await hide(ada, hidden.id, false);
    expect(await favoritesOf(ada)).toEqual({ rooms: [hidden.id], version: 3 });
    await hide(ada, hidden.id);
    // A star that's refused drops nothing.
    expect((await star(ada, secret.id)).status).toBe(403);
    expect(await storedStars(ada)).toEqual([secret.id, hidden.id, gone.id]);

    expect(await answered(star(ada, design.id))).toEqual({ rooms: [design.id], version: 4 });
    expect(await storedStars(ada)).toEqual([design.id]);
  });

  it(`refuses a new star past ${MAX_FAVORITES.toLocaleString("en")}, counting only rooms you can star, but stars again one you've starred`, async () => {
    const ada = await signIn("Ada");
    const extra = await createRoom("Extra");
    // As many starred rooms as anyone can have, written at once.
    const starred = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${MAX_FAVORITES})`;
    await workspaceSql(`${starred} INSERT INTO rooms (id, kind, name, created_at, updated_at) SELECT 'many-' || i, 'open', 'Many ' || i, 'now', 'now' FROM n`);
    await workspaceSql(`${starred} INSERT INTO memberships (room_id, user_id, created_at, updated_at) SELECT 'many-' || i, ?, 'now', 'now' FROM n`, ada.user.id);
    await workspaceSql(`${starred} INSERT INTO favorites (user_id, room_id, position) SELECT ?, 'many-' || i, i FROM n`, ada.user.id);

    expect((await star(ada, extra.id)).status).toBe(403);
    expect((await answered(star(ada, "many-1"))).rooms).toHaveLength(MAX_FAVORITES);

    await hide(ada, "many-2");
    const favorites = await answered(star(ada, extra.id));
    expect(favorites.rooms).toHaveLength(MAX_FAVORITES);
    expect(favorites.rooms).not.toContain("many-2");
    expect(favorites.rooms.at(-1)).toBe(extra.id);
  });
});
