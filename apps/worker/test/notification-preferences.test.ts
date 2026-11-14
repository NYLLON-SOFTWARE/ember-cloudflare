import { MAX_PAUSE_MS, type Involvement, type NotificationSettings, type RoomId, type Sidebar, type WorkspaceServerFrame } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { api, createRoom, direct, freshDeploy, openWorkspaceSocket, signIn, type Session } from "./support";

// Preferences › Notifications: what you're notified about wherever you haven't picked a level, the rooms
// you have, and pausing notifications. pushes.test.ts checks that a pause stops pushes.

const settingsOf = async (session: Session) => (await (await api("/api/users/me/notifications", { headers: { Cookie: session.cookie } })).json()) as NotificationSettings;

const change = (session: Session, changes: unknown) =>
  api("/api/users/me/notifications", { method: "PATCH", headers: { Cookie: session.cookie }, body: JSON.stringify(changes) });

const resetAll = (session: Session) => api("/api/users/me/notifications/reset", { method: "POST", headers: { Cookie: session.cookie } });

const involve = (session: Session, roomId: RoomId, involvement: Involvement | "default") =>
  api(`/api/rooms/${roomId}/involvement`, { method: "PUT", headers: { Cookie: session.cookie }, body: JSON.stringify({ involvement }) });

/** Each of `session`'s rooms' levels, by id, as their sidebar lists them. */
async function levelsOf(session: Session): Promise<Record<RoomId, Involvement>> {
  const sidebar = (await (await api("/api/sidebar", { headers: { Cookie: session.cookie } })).json()) as Sidebar;
  return Object.fromEntries(sidebar.rooms.map((room) => [room.id, room.involvement]));
}

beforeEach(freshDeploy);

describe("Notification preferences", () => {
  it("notifies you of @mentions, DMs and threads until you say otherwise, with nothing paused or picked", async () => {
    const ada = await signIn("Ada");
    expect(await settingsOf(ada)).toEqual({ level: "mentions", pausedUntil: null, chosen: [] });
    expect((await api("/api/users/me/notifications")).status).toBe(401);
  });

  it("moves every room and DM you haven't picked a level in to the new default, telling your tabs, and keeps the ones you picked", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const [design, ops, hidden] = [await createRoom("Design"), await createRoom("Ops"), await createRoom("Hidden")];
    const dm = await direct(ada, grace);
    await involve(ada, ops.id, "nothing");
    await involve(ada, hidden.id, "invisible");
    const tab = await openWorkspaceSocket(ada);

    const answered = await change(ada, { level: "everything" });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ level: "everything", pausedUntil: null, chosen: [ops.id, hidden.id].sort() });
    expect(await tab.next()).toEqual({ type: "room.involvements", involvements: [{ roomId: design.id, involvement: "everything" }] } satisfies WorkspaceServerFrame);
    expect(await levelsOf(ada)).toMatchObject({ [design.id]: "everything", [ops.id]: "nothing", [hidden.id]: "invisible", [dm.id]: "everything" });

    // Nothing turns DMs off too.
    await change(ada, { level: "nothing" });
    expect(await levelsOf(ada)).toMatchObject({ [design.id]: "nothing", [dm.id]: "nothing", [ops.id]: "nothing" });
    // Grace's own levels don't move.
    expect(await levelsOf(grace)).toMatchObject({ [design.id]: "mentions", [dm.id]: "everything" });
  });

  it("starts you at your default in rooms and DMs you join from then on", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    await change(ada, { level: "everything" });
    const later = await createRoom("Later");
    const board = await createRoom("Board", { closedTo: [ada.user.id, grace.user.id], as: grace });
    await change(ada, { level: "nothing" });
    const dm = await direct(grace, ada);
    const levels = await levelsOf(ada);
    expect(levels[later.id]).toBe("nothing");
    expect(levels[board.id]).toBe("nothing");
    expect(levels[dm.id]).toBe("nothing");
    expect((await settingsOf(ada)).chosen).toEqual([]);
  });

  it("follows the default again in one room, or in every room but those you've hidden", async () => {
    const ada = await signIn("Ada");
    const [design, ops, hidden] = [await createRoom("Design"), await createRoom("Ops"), await createRoom("Hidden")];
    for (const [room, level] of [[design, "everything"], [ops, "nothing"], [hidden, "invisible"]] as const) await involve(ada, room.id, level);
    expect((await settingsOf(ada)).chosen).toEqual([design.id, ops.id, hidden.id].sort());

    expect(await (await involve(ada, design.id, "default")).json()).toEqual({ involvement: "mentions" });
    expect((await settingsOf(ada)).chosen).toEqual([ops.id, hidden.id].sort());

    const tab = await openWorkspaceSocket(ada);
    const reset = await resetAll(ada);
    expect(reset.status).toBe(200);
    expect(((await reset.json()) as NotificationSettings).chosen).toEqual([hidden.id]);
    expect(await tab.next()).toEqual({ type: "room.involvements", involvements: [{ roomId: ops.id, involvement: "mentions" }] });
    expect(await levelsOf(ada)).toMatchObject({ [design.id]: "mentions", [ops.id]: "mentions", [hidden.id]: "invisible" });
  });

  it("pauses notifications until a time in the next 120 days, and resumes them", async () => {
    const ada = await signIn("Ada");
    const until = Date.now() + 30 * 60 * 1000;
    expect(await (await change(ada, { pausedUntil: until })).json()).toMatchObject({ pausedUntil: until });
    expect((await settingsOf(ada)).pausedUntil).toBe(until);
    expect(await (await change(ada, { pausedUntil: null })).json()).toMatchObject({ pausedUntil: null });
  });

  it("refuses a level or a time it can't take, and anything else", async () => {
    const ada = await signIn("Ada");
    for (const changes of [{ level: "invisible" }, { pausedUntil: Date.now() - 1 }, { pausedUntil: Date.now() + MAX_PAUSE_MS + 60_000 }, { pausedUntil: "soon" }, { muted: true }, []]) {
      expect((await change(ada, changes)).status, JSON.stringify(changes)).toBe(422);
    }
    expect(await settingsOf(ada)).toEqual({ level: "mentions", pausedUntil: null, chosen: [] });
  });
});
