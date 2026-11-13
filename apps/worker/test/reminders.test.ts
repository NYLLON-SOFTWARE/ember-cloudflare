import type { Reminder, WorkspaceServerFrame } from "@ember/protocol";
import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  connect,
  createRoom,
  freshDeploy,
  freshRoom,
  openWorkspaceSocket,
  post,
  settle,
  signIn,
  workspaceSql,
  workspaceStub,
  type Session,
  type WorkspaceSocket,
} from "./support";

/** Asks that `message` come back to `session` at `remindAt`, answering the API's response. */
const remind = (session: Session, roomId: string, messageId: string, remindAt: string) =>
  api("/api/reminders", {
    method: "POST",
    headers: { Cookie: session.cookie },
    body: JSON.stringify({ roomId, messageId, remindAt }),
  });

/** What `socket` has heard, up to the next pong. */
async function heard(socket: WorkspaceSocket): Promise<WorkspaceServerFrame[]> {
  socket.send(JSON.stringify({ type: "ping", nonce: crypto.randomUUID() }));
  const frames: WorkspaceServerFrame[] = [];
  for (let frame = await socket.next(); frame.type !== "pong"; frame = await socket.next()) frames.push(frame);
  return frames;
}

/** A time a reminder may be asked for: a little over the soonest the Workspace takes. */
const soon = () => new Date(Date.now() + 20_000).toISOString();

/**
 * The alarm the tests run fires at once, whenever it was set for, so a reminder set for `soon()` isn't
 * due yet when it goes. This is the time passing: every reminder still waiting is due right now.
 */
const makeRemindersDue = () => workspaceSql("UPDATE reminders SET remind_at = ? WHERE reminded_at IS NULL", Date.now() - 1_000);

beforeEach(freshDeploy);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Reminders", () => {
  it("sets, lists and dismisses a reminder, keeping what the message read", async () => {
    const room = await freshRoom("reminding");
    const ada = await connect(room, "Ada", { visible: true });
    const adaSession = await signIn("Ada");
    const grace = await signIn("Grace");

    const message = await post(ada, "The deploy is at noon");
    const at = soon();
    const response = await remind(grace, room, message.id, at);
    expect(response.status, await response.clone().text()).toBe(201);
    const { reminder } = (await response.json()) as { reminder: Reminder };
    expect(reminder.roomId).toBe(room);
    expect(reminder.messageId).toBe(message.id);
    expect(reminder.creator).toEqual({ id: ada.me.id, name: ada.me.name });
    expect(reminder.excerpt).toBe("The deploy is at noon");
    expect(new Date(reminder.remindAt).getTime()).toBe(new Date(at).getTime());

    const list = await api("/api/reminders", { headers: { Cookie: grace.cookie } });
    expect(((await list.json()) as { reminders: Reminder[] }).reminders).toEqual([reminder]);
    // Someone else's list is theirs alone, and dismisses only what's theirs.
    const adas = await api("/api/reminders", { headers: { Cookie: adaSession.cookie } });
    expect(((await adas.json()) as { reminders: Reminder[] }).reminders).toEqual([]);

    expect(
      (await api(`/api/reminders/${reminder.id}`, { method: "DELETE", headers: { Cookie: adaSession.cookie } })).status,
    ).toBe(404);
    expect(
      (await api(`/api/reminders/${reminder.id}`, { method: "DELETE", headers: { Cookie: grace.cookie } })).status,
    ).toBe(204);
    const emptied = await api("/api/reminders", { headers: { Cookie: grace.cookie } });
    expect(((await emptied.json()) as { reminders: Reminder[] }).reminders).toEqual([]);
  });

  it("refuses what isn't there, times that make no sense, and rooms they aren't in", async () => {
    const room = await freshRoom("refusing");
    const grace = await signIn("Grace");
    const host = await signIn("Host");
    const closed = await createRoom("secrets", { closedTo: [host.user.id], as: host });
    const hostSays = await connect(closed.id, host);
    const message = await post(hostSays, "Between us");

    expect((await remind(grace, closed.id, message.id, soon())).status).toBe(403);
    expect((await remind(grace, room, "nonexistent", soon())).status).toBe(404);
    expect((await remind(grace, room, message.id, new Date(Date.now() - 1_000).toISOString())).status).toBe(422);
    expect((await remind(grace, room, message.id, new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString())).status).toBe(422);
    expect(
      (await api("/api/reminders", { method: "POST", headers: { Cookie: grace.cookie }, body: JSON.stringify({ roomId: room }) })).status,
    ).toBe(400);
    expect((await api("/api/reminders")).status).toBe(401);
  });

  it("tells every tab of theirs when it comes due, and tells it once", async () => {
    const room = await freshRoom("telling");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    // Grace has the room open, so Ada's message marks nothing unread for her tabs here.
    await connect(room, grace, { visible: true });
    const tabs = await Promise.all([openWorkspaceSocket(grace), openWorkspaceSocket(grace)]);

    const message = await post(ada, "Look here later");
    const response = await remind(grace, room, message.id, soon());
    expect(response.status, await response.clone().text()).toBe(201);
    await makeRemindersDue();

    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    for (const tab of tabs) {
      expect(await heard(tab)).toEqual([
        {
          type: "reminder.due",
          reminder: expect.objectContaining({ messageId: message.id, excerpt: "Look here later" }),
        },
      ]);
    }
    // A reminder that has been told stays told: the next alarm has nothing of it left to say.
    for (const tab of tabs) expect(await heard(tab)).toEqual([]);
  });

  it("comes back with what the message read when it was set, even once the message is gone", async () => {
    const room = await freshRoom("keeping");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    // Grace has the room open, so Ada's message marks nothing unread for her tab here.
    await connect(room, grace, { visible: true });
    const tab = await openWorkspaceSocket(grace);

    const message = await post(ada, "Gone by noon");
    const response = await remind(grace, room, message.id, soon());
    expect(response.status, await response.clone().text()).toBe(201);
    ada.send({ type: "message.delete", messageId: message.id });
    await settle(ada);
    await makeRemindersDue();

    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    expect(await heard(tab)).toEqual([
      { type: "reminder.due", reminder: expect.objectContaining({ messageId: message.id, excerpt: "Gone by noon" }) },
    ]);
  });
});
