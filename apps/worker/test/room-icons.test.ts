import { feature } from "@ember/parity";
import type { Room, RoomId, RoomSettings, Sidebar } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { api, createRoom, freshDeploy, signIn, workspaceSql, type Session } from "./support";

beforeEach(freshDeploy);

const ICON_REFUSED = { error: 'Icon must be one of the room icons, or "" for the default' };

const change = (roomId: RoomId, session: Session, body: unknown) =>
  api(`/api/rooms/${roomId}`, { method: "PATCH", headers: { Cookie: session.cookie }, body: JSON.stringify(body) });

/** The rooms `session`'s person sees listed, by id, with their icons. */
const icons = async (session: Session) =>
  Object.fromEntries(((await (await api("/api/sidebar", { headers: { Cookie: session.cookie } })).json()) as Sidebar).rooms.map((room) => [room.id, room.icon]));

const stored = async (roomId: RoomId) => (await workspaceSql("SELECT name, icon FROM rooms WHERE id = ?", roomId))[0];

/** Adds a DM between `sessions`, as nothing else can yet. */
async function direct(...sessions: Session[]): Promise<RoomId> {
  const id = `direct-${crypto.randomUUID().slice(0, 8)}`;
  await workspaceSql(`INSERT INTO rooms (id, kind, creator_id, created_at, updated_at) VALUES (?, 'direct', ?, 'now', 'now')`, id, sessions[0]!.user.id);
  for (const { user } of sessions) {
    await workspaceSql(`INSERT INTO memberships (room_id, user_id, created_at, updated_at) VALUES (?, ?, 'now', 'now')`, id, user.id);
  }
  return id;
}

describe(feature("rooms.icons"), () => {
  it("makes a room with the icon chosen, or the default `#` with none or \"\", and lists it for everyone in it", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const coffee = await createRoom("Coffee", { icon: "coffee", as: ada });
    const plain = await createRoom("Plain", { as: ada });
    const reset = await createRoom("Leads", { icon: "", closedTo: [ada.user.id, grace.user.id], as: ada });

    expect([coffee.icon, plain.icon, reset.icon]).toEqual(["coffee", null, null]);
    expect(await icons(grace)).toEqual({ [coffee.id]: "coffee", [plain.id]: null, [reset.id]: null });
    const settings = (await (await api(`/api/rooms/${coffee.id}/settings`, { headers: { Cookie: grace.cookie } })).json()) as RoomSettings;
    expect(settings.room.icon).toBe("coffee");
  });

  it('changes a room\'s icon, keeps it when a change leaves it out, switching access included, and goes back to `#` with ""', async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Design", { as: ada });

    expect(((await (await change(room.id, ada, { icon: "rocket" })).json()) as { room: Room }).room).toEqual({ ...room, icon: "rocket" });
    expect(await stored(room.id)).toEqual({ name: "Design", icon: "rocket" });
    expect((await change(room.id, ada, { name: "Launch", kind: "open" })).status).toBe(200);
    expect(await stored(room.id)).toEqual({ name: "Launch", icon: "rocket" });
    // Making it private keeps it too.
    expect(((await (await change(room.id, ada, { kind: "closed", memberIds: [ada.user.id] })).json()) as { room: Room }).room.icon).toBe("rocket");
    expect(await stored(room.id)).toEqual({ name: "Launch", icon: "rocket" });
    expect(((await (await change(room.id, ada, { icon: "" })).json()) as { room: Room }).room.icon).toBeNull();
    expect(await stored(room.id)).toEqual({ name: "Launch", icon: null });
  });

  it("refuses an icon that isn't exactly one, making and changing nothing", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Design", { icon: "coffee", as: ada });

    for (const icon of ["Coffee", "../coffee", null]) {
      const changed = await change(room.id, ada, { name: "Renamed", icon });
      expect(changed.status).toBe(422);
      expect(await changed.json()).toEqual(ICON_REFUSED);
      const made = await api("/api/rooms", { method: "POST", headers: { Cookie: ada.cookie }, body: JSON.stringify({ kind: "open", name: "Another", icon }) });
      expect(made.status).toBe(422);
    }
    expect(await stored(room.id)).toEqual({ name: "Design", icon: "coffee" });
    expect(Object.keys(await icons(ada))).toEqual([room.id]);
  });

  it("refuses other members before checking the icon, and DMs, which have none", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await createRoom("Design", { as: ada });
    const dm = await direct(ada, grace);

    expect((await change(room.id, grace, { icon: "not-an-icon" })).status).toBe(403);
    expect((await change(room.id, grace, { icon: "coffee" })).status).toBe(403);
    expect((await change(dm, ada, { icon: "coffee" })).status).toBe(404);
    expect(await workspaceSql("SELECT id, icon FROM rooms WHERE icon IS NOT NULL")).toEqual([]);
  });

  it("records no change when the icon stays as it is", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Design", { icon: "coffee", as: ada });
    await workspaceSql("UPDATE rooms SET updated_at = 'then' WHERE id = ?", room.id);

    expect((await change(room.id, ada, { name: "Design", icon: "coffee" })).status).toBe(200);
    expect(await workspaceSql("SELECT updated_at FROM rooms WHERE id = ?", room.id)).toEqual([{ updated_at: "then" }]);
    expect((await change(room.id, ada, { icon: "" })).status).toBe(200);
    expect(await workspaceSql("SELECT updated_at FROM rooms WHERE id = ?", room.id)).not.toEqual([{ updated_at: "then" }]);
  });
});
