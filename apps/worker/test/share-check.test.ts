import { SHARE_CHECK_PATH, type RoomId } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { api, createRoom, direct, signIn, workspaceSql, type Session } from "./support";

// Whether sharing from one room in another, as Files in Ember and Forward do, would reach people who can't
// see the room it's from, for the app to warn first.

const check = (session: Session, sourceRoomId: RoomId, targetRoomId: RoomId) =>
  api(SHARE_CHECK_PATH, { method: "POST", headers: { Cookie: session.cookie }, body: JSON.stringify({ sourceRoomId, targetRoomId }) });

async function widening(session: Session, sourceRoomId: RoomId, targetRoomId: RoomId) {
  const response = await check(session, sourceRoomId, targetRoomId);
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}

describe("Share check", () => {
  it("counts the people in the room shared to who aren't in the private room it's from", async () => {
    const [ada, grace, linus, mary] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus"), await signIn("Mary")];
    const design = await createRoom("design", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const launch = await createRoom("launch", { closedTo: [ada.user.id, grace.user.id, linus.user.id, mary.user.id], as: ada });
    const lobby = await createRoom("lobby", { as: ada });

    expect(await widening(ada, design.id, launch.id)).toEqual({ widens: true, newViewers: 2, names: ["Linus", "Mary"] });
    // An open room takes in everyone active, who can't all see Design.
    expect(await widening(ada, design.id, lobby.id)).toMatchObject({ widens: true });
  });

  it("names three of those it would reach at most, by name", async () => {
    const people = [await signIn("Ada"), await signIn("Zed"), await signIn("Bea"), await signIn("Cy"), await signIn("Dee")];
    const ada = people[0]!;
    const design = await createRoom("design", { closedTo: [ada.user.id], as: ada });
    const launch = await createRoom("launch", { closedTo: people.map(({ user }) => user.id), as: ada });
    expect(await widening(ada, design.id, launch.id)).toEqual({ widens: true, newViewers: 4, names: ["Bea", "Cy", "Dee"] });
  });

  it("doesn't warn when everyone in the room shared to can see the room it's from already", async () => {
    const [ada, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const design = await createRoom("design", { closedTo: [ada.user.id, grace.user.id, linus.user.id], as: ada });
    const same = await createRoom("same", { closedTo: [ada.user.id, grace.user.id, linus.user.id], as: ada });
    const fewer = await createRoom("fewer", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const lobby = await createRoom("lobby", { as: ada });

    expect(await widening(ada, design.id, same.id)).toEqual({ widens: false, newViewers: 0, names: [] });
    expect(await widening(ada, design.id, fewer.id)).toEqual({ widens: false, newViewers: 0, names: [] });
    // A room open to everyone is everyone's to see.
    expect(await widening(ada, lobby.id, design.id)).toEqual({ widens: false, newViewers: 0, names: [] });
  });

  it("counts from a DM's two people, leaving out people who've left", async () => {
    const [ada, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const dm = await direct(ada, grace);
    const launch = await createRoom("launch", { closedTo: [ada.user.id, grace.user.id, linus.user.id], as: ada });
    expect(await widening(grace, dm.id, launch.id)).toEqual({ widens: true, newViewers: 1, names: ["Linus"] });

    await workspaceSql("UPDATE users SET status = 1 WHERE id = ?", linus.user.id);
    expect(await widening(grace, dm.id, launch.id)).toEqual({ widens: false, newViewers: 0, names: [] });
  });

  it("answers only someone in both rooms", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const design = await createRoom("design", { closedTo: [ada.user.id], as: ada });
    const launch = await createRoom("launch", { closedTo: [ada.user.id, grace.user.id], as: ada });

    expect((await check(grace, design.id, launch.id)).status).toBe(404);
    expect((await check(grace, launch.id, design.id)).status).toBe(404);
    expect((await check(ada, "no%20room" as RoomId, launch.id)).status).toBe(404);
    expect((await api(SHARE_CHECK_PATH, { method: "POST", headers: { Cookie: ada.cookie }, body: JSON.stringify({ sourceRoomId: design.id }) })).status).toBe(422);
    expect((await api(SHARE_CHECK_PATH, { method: "POST", body: JSON.stringify({ sourceRoomId: design.id, targetRoomId: launch.id }) })).status).toBe(401);
  });
});
