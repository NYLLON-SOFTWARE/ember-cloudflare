import { feature } from "@ember/parity";
import type { NewRoomForm, RoomId, RoomSettings } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { ACTIVE_PEOPLE, ACTIVE_PEOPLE_IN_ROOM, ROOM_TO_CHANGE } from "../src/workspace-store";
import { api, createRoom, freshDeploy, signIn, workspaceSql, type Session } from "./support";

beforeEach(freshDeploy);

const as = (session: Session) => ({ headers: { Cookie: session.cookie } });

const newRoomForm = (session: Session) => api("/api/rooms/new", as(session));

const settings = (roomId: RoomId, session: Session) => api(`/api/rooms/${roomId}/settings`, as(session));

const change = (roomId: RoomId, session: Session, body: unknown) =>
  api(`/api/rooms/${roomId}`, { method: "PATCH", headers: { Cookie: session.cookie }, body: JSON.stringify(body) });

/** Makes someone an administrator, as only first run can yet. */
const promote = (session: Session) => workspaceSql("UPDATE users SET role = 1 WHERE id = ?", session.user.id);

const nameOf = async (roomId: RoomId) => ((await workspaceSql("SELECT name FROM rooms WHERE id = ?", roomId)) as Array<{ name: string }>)[0]!.name;

/** Adds a DM between `sessions`, as nothing else can yet. */
async function direct(...sessions: Session[]): Promise<RoomId> {
  const id = `direct-${crypto.randomUUID().slice(0, 8)}`;
  await workspaceSql(`INSERT INTO rooms (id, kind, creator_id, created_at, updated_at) VALUES (?, 'direct', ?, 'now', 'now')`, id, sessions[0]!.user.id);
  for (const { user } of sessions) {
    await workspaceSql(`INSERT INTO memberships (room_id, user_id, created_at, updated_at) VALUES (?, ?, 'now', 'now')`, id, user.id);
  }
  return id;
}

describe(feature("rooms.create-open"), () => {
  it("lists everyone active for New room, by name whatever its case", async () => {
    const ada = await signIn("ada");
    const [grace, linus] = [await signIn("Grace"), await signIn("Linus")];
    await workspaceSql("UPDATE users SET status = 1 WHERE id = ?", linus.user.id);

    const response = await newRoomForm(grace);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ people: [ada.user, grace.user] } satisfies NewRoomForm);
  });

  it("asks who's signed in", async () => {
    expect((await api("/api/rooms/new")).status).toBe(401);
  });
});

describe(feature("rooms.settings-page"), () => {
  it("shows a room's settings to whoever made it, with everyone active and whether they're in it", async () => {
    const [ada, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const room = await createRoom("Leads", { closedTo: [ada.user.id, linus.user.id], as: ada });

    const response = await settings(room.id, ada);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      room,
      canAdminister: true,
      people: [
        { ...ada.user, member: true },
        { ...grace.user, member: false },
        { ...linus.user, member: true },
      ],
    } satisfies RoomSettings);
  });

  it("shows other members the same settings, which they can't change", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await createRoom("Design", { as: ada });

    const shown = (await (await settings(room.id, grace)).json()) as RoomSettings;
    expect(shown.canAdminister).toBe(false);
    expect(shown.people).toEqual([
      { ...ada.user, member: true },
      { ...grace.user, member: true },
    ]);
  });

  it("renames a room, trimming the name, and answers it", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Design", { as: ada });

    const response = await change(room.id, ada, { name: "  Product design " });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ room: { ...room, name: "Product design" } });
    expect(await nameOf(room.id)).toBe("Product design");
    expect(await (await change(room.id, ada, {})).json()).toEqual({ room: { ...room, name: "Product design" } });
  });

  it("refuses a name that's blank or too long, keeping the one it has", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Design", { as: ada });
    for (const body of [{ name: " " }, { name: "x".repeat(101) }, null]) {
      const response = await change(room.id, ada, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
    expect(await (await change(room.id, ada, { name: "" })).json()).toEqual({ error: "Name must be 1 to 100 characters" });
    expect(await nameOf(room.id)).toBe("Design");
  });

  it("finds a room and its people with one read each, by their keys", async () => {
    const plan = async (query: string, ...params: string[]) =>
      (await workspaceSql(`EXPLAIN QUERY PLAN ${query}`, ...params)).map((row) => (row as { detail: string }).detail).join("; ");
    const toChange = await plan(ROOM_TO_CHANGE, "room", "user");
    expect(toChange).toMatch(/SEARCH memberships USING (COVERING )?INDEX sqlite_autoindex_memberships_1 \(room_id=\? AND user_id=\?\)/);
    expect(toChange).toMatch(/SEARCH rooms USING INDEX sqlite_autoindex_rooms_1 \(id=\?\)/);
    expect(toChange).toMatch(/SEARCH users USING INDEX sqlite_autoindex_users_1 \(id=\?\)/);
    expect(await plan(ACTIVE_PEOPLE_IN_ROOM, "room")).toMatch(/SEARCH memberships USING (COVERING )?INDEX sqlite_autoindex_memberships_1 \(room_id=\? AND user_id=\?\)/);
    expect(await plan(ACTIVE_PEOPLE)).toContain("SCAN users");
  });
});

describe(feature("rooms.edit-permissions"), () => {
  it("lets the room's creator and administrators change it", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await createRoom("Design", { as: ada });
    await promote(grace);

    expect(((await (await settings(room.id, grace)).json()) as RoomSettings).canAdminister).toBe(true);
    expect((await change(room.id, grace, { name: "Renamed by an administrator" })).status).toBe(200);
    expect((await change(room.id, ada, { name: "Renamed by its creator" })).status).toBe(200);
    expect(await nameOf(room.id)).toBe("Renamed by its creator");
  });

  it("refuses other members before checking what they sent, and changes nothing", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await createRoom("Design", { as: ada });

    for (const body of [{ name: "Mine now" }, { name: " " }]) {
      const response = await change(room.id, grace, body);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Only administrators and the room's creator can change it" });
    }
    expect(await nameOf(room.id)).toBe("Design");
  });

  it("answers 404 to people who aren't in the room, administrators included, and for missing rooms and DMs", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    await promote(grace);
    const room = await createRoom("Leads", { closedTo: [ada.user.id], as: ada });
    const dm = await direct(ada, grace);

    for (const [roomId, session] of [[room.id, grace], ["nowhere", ada], [dm, ada], ["%FF", ada]] as const) {
      for (const response of [await settings(roomId, session), await change(roomId, session, { name: "Renamed" })]) {
        expect(response.status, roomId).toBe(404);
        expect(await response.json()).toEqual({ error: "Room not found or inaccessible" });
      }
    }
    expect(await nameOf(room.id)).toBe("Leads");
  });

  it("asks who's signed in, and refuses changes from other sites", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Design", { as: ada });
    expect((await api(`/api/rooms/${room.id}/settings`)).status).toBe(401);
    expect((await api(`/api/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) })).status).toBe(401);
    const crossSite = await api(`/api/rooms/${room.id}`, {
      method: "PATCH",
      headers: { Cookie: ada.cookie, Origin: "https://evil.test" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(crossSite.status).toBe(422);
    expect(await nameOf(room.id)).toBe("Design");
  });
});
