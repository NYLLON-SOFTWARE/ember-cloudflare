import type { Me, NewWorkspace, Reminder, WorkspaceServerFrame } from "@ember/protocol";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REMINDER_PUSH_GRACE_MS, type Workspace } from "../src/workspace";
import { REMINDER_PUSH_RETRY_MS, type WorkspaceStore } from "../src/workspace-store";
import {
  api,
  apiWith,
  connect,
  cookieOf,
  createRoom,
  freshDeploy,
  freshRoom,
  openWorkspaceSocket,
  post,
  pushBrowser,
  settle,
  shown,
  signIn,
  withWorkspaceEnv,
  workspaceSql,
  workspaceStub,
  type PushBrowser,
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

/** Saves a subscription for `session` at Chrome's push service, at `/fcm/send/<label>`, for `browser`'s keys. */
async function subscribe(session: Session, label: string, browser?: PushBrowser): Promise<string> {
  const { p256dh, auth } = browser ?? (await pushBrowser());
  const endpoint = `https://fcm.googleapis.com/fcm/send/${label}`;
  const response = await api("/api/push-subscriptions", { method: "POST", headers: { Cookie: session.cookie }, body: JSON.stringify({ endpoint, p256dhKey: p256dh, authKey: auth }) });
  expect(response.status, await response.clone().text()).toBe(204);
  return endpoint;
}

/** Stands in for every push service, answering each push with `status`, and keeps what was pushed where. */
function pushServices(status: (endpoint: string) => number = () => 201) {
  const pushed: Array<{ endpoint: string; body: Uint8Array }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const endpoint = input instanceof Request ? input.url : String(input);
    pushed.push({ endpoint, body: init!.body as Uint8Array });
    return new Response(null, { status: status(endpoint) });
  });
  return pushed;
}

/** What `socket` has heard, up to the next pong. */
async function heard(socket: WorkspaceSocket): Promise<WorkspaceServerFrame[]> {
  socket.send(JSON.stringify({ type: "ping", nonce: crypto.randomUUID() }));
  const frames: WorkspaceServerFrame[] = [];
  for (let frame = await socket.next(); frame.type !== "pong"; frame = await socket.next()) frames.push(frame);
  return frames;
}

/** A time a reminder may be asked for: a little over the soonest the Workspace takes. */
const soon = () => new Date(Date.now() + 20_000).toISOString();

/** Signs a guest of one room in by their stay's name, whatever EMBER_GUEST_SIGN_IN says of the others. */
async function guestOf(name: string): Promise<Session> {
  const response = await apiWith({ EMBER_GUEST_SIGN_IN: undefined }, "/api/session", { method: "POST", body: JSON.stringify({ name }) });
  expect(response.status, await response.clone().text()).toBe(201);
  return { user: shown(((await response.json()) as { user: Me }).user), cookie: cookieOf(response) };
}

/**
 * The alarm the tests run fires at once, whenever it was set for, so a reminder set for `soon()` isn't
 * due yet when it goes. This is the time passing: every reminder still waiting is due right now.
 */
const makeRemindersDue = () => workspaceSql("UPDATE reminders SET remind_at = ? WHERE reminded_at IS NULL", Date.now() - 1_000);

beforeEach(freshDeploy);

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Stands in for every push service, answering each of the first ten pushes at once and holding every one
 * after until `go`, keeping what was pushed where. The runs push in tens here, so the run that follows
 * the first sits at its first pushes, held, while the test sees what the runs before it left.
 */
function heldPushServices() {
  const pushed: Array<{ endpoint: string; body: Uint8Array }> = [];
  let go!: () => void;
  const gate = new Promise<void>((opened) => (go = opened));
  let held = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    pushed.push({ endpoint: input instanceof Request ? input.url : String(input), body: init!.body as Uint8Array });
    const answer = Promise.resolve(new Response(null, { status: 201 }));
    return ++held > 10 ? gate.then(() => answer) : answer;
  });
  return { pushed, go };
}

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

  it("lands in every browser they saved, saying what the message read and where it lives", async () => {
    const pushed = pushServices();
    const room = await freshRoom("landing");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    // Grace has the room open, so Ada's messages mark nothing unread for her tabs here.
    await connect(room, grace, { visible: true });
    const [phones, laptops] = [await pushBrowser(), await pushBrowser()];
    const phone = await subscribe(grace, "grace-phone", phones);
    const laptop = await subscribe(grace, "grace-laptop", laptops);

    const message = await post(ada, "<p>Back to this by noon</p>");
    await remind(grace, room, message.id, soon());
    ada.send({ type: "message.create", clientMessageId: "reply", body: "<p>The reply itself</p>", parentId: message.id });
    const reply = (await ada.next("message.created")).message;
    await remind(grace, room, reply.id, soon());
    await makeRemindersDue();

    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    await vi.waitFor(() => expect(pushed).toHaveLength(4));
    const notices = {
      "Back to this by noon": { title: "Reminder", options: { body: "Back to this by noon", icon: "/account/logo", data: { path: `/rooms/${room}/@${message.id}`, badge: 0 } } },
      "The reply itself": { title: "Reminder", options: { body: "The reply itself", icon: "/account/logo", data: { path: `/rooms/${room}/threads/${message.id}/@${reply.id}`, badge: 0 } } },
    };
    for (const [browser, endpoint] of [[phones, phone], [laptops, laptop]] as const) {
      const received = pushed.filter(({ endpoint: sentTo }) => sentTo === endpoint);
      expect(received).toHaveLength(2);
      const opened = await Promise.all(received.map(async ({ body }) => JSON.parse(await browser.open(body))));
      expect(opened).toEqual(expect.arrayContaining([notices["Back to this by noon"], notices["The reply itself"]]));
    }
    // Told, they aren't set for the alarm again: the next run would have nothing of them to push.
    expect(await runDurableObjectAlarm(workspaceStub())).toBe(false);
    expect(pushed).toHaveLength(4);
  });

  it("tells nothing of a reminder that isn't there any more by its turn to be told", async () => {
    const pushed = pushServices();
    const room = await freshRoom("meanwhile");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    await connect(room, grace, { visible: true });
    const browser = await pushBrowser();
    await subscribe(grace, "grace", browser);
    const tab = await openWorkspaceSocket(grace);

    const firstMessage = await post(ada, "<p>First to tell</p>");
    const secondMessage = await post(ada, "<p>Taken back meanwhile</p>");
    const first = await (await remind(grace, room, firstMessage.id, soon())).json() as { reminder: Reminder };
    const takenBack = await (await remind(grace, room, secondMessage.id, soon())).json() as { reminder: Reminder };
    await makeRemindersDue();
    // The second reminder is gone by its turn, as one dismissed while the first's push waited is. The
    // stand-in holds for the test, since the run that skips it leaves it due, and the run the wake set
    // for that mustn't tell it either.
    let restore!: () => void;
    try {
      await runInDurableObject(workspaceStub(), (workspace: Workspace) => {
        const store = (workspace as unknown as { store: WorkspaceStore }).store;
        const telling = store.reminder.bind(store);
        restore = () => {
          store.reminder = telling;
        };
        store.reminder = (id: string) => (id === takenBack.reminder.id ? Promise.resolve(null) : telling(id));
      });

      expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
      expect(await heard(tab)).toEqual([
        { type: "reminder.due", reminder: expect.objectContaining({ excerpt: "First to tell" }) },
      ]);
      expect(pushed).toHaveLength(1);
      expect(JSON.parse(await browser.open(pushed[0]!.body))).toMatchObject({ options: { body: "First to tell" } });
      // Only the one told is marked so: had the dismissal come later, it would wait to be asked for again.
      expect(await workspaceSql("SELECT id FROM reminders WHERE reminded_at IS NOT NULL")).toEqual([{ id: first.reminder.id }]);
    } finally {
      restore?.();
    }
  });

  it("pushes no reminder to someone who signed in with just a name while EMBER_GUEST_SIGN_IN doesn't let them stay signed in, though they keep their subscription", async () => {
    const pushed = pushServices();
    const room = await freshRoom("guests");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    const browser = await pushBrowser();
    await subscribe(grace, "grace", browser);
    const message = await post(ada, "While guests may stay");
    await remind(grace, room, message.id, soon());
    await makeRemindersDue();

    await withWorkspaceEnv({ EMBER_GUEST_SIGN_IN: undefined }, async () => {
      expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
      expect(pushed).toEqual([]);
      expect(await workspaceSql("SELECT count(*) AS n FROM push_subscriptions")).toEqual([{ n: 1 }]);
      // Told all the same, since the reminder was due and nobody is there to show it to.
      expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE reminded_at IS NOT NULL")).toEqual([{ n: 1 }]);
    });
  });

  it("pushes a reminder to a guest of one room whose stay holds, and none to one whose stay has passed, while open-sign-in guests may not stay signed in", async () => {
    const pushed = pushServices();
    const setUp = await api("/api/first_run", { method: "POST", body: JSON.stringify({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" }) });
    expect(setUp.status).toBe(201);
    const ada = { user: shown(((await setUp.json()) as NewWorkspace).user), cookie: cookieOf(setUp) };
    const made = await api("/api/rooms", { method: "POST", headers: { Cookie: ada.cookie }, body: JSON.stringify({ kind: "open", name: "One room's guests" }) });
    const room = ((await made.json()) as { room: { id: string } }).room.id;
    for (const name of ["Pat", "Drew"]) {
      const added = await api(`/api/rooms/${room}/guests`, { method: "POST", headers: { Cookie: ada.cookie }, body: JSON.stringify({ name, until: new Date(Date.now() + 60_000).toISOString() }) });
      expect(added.status, await added.clone().text()).toBe(201);
    }
    const tab = await connect(room, ada);

    // Their stays sign both in whatever the flag says, and Pat's holds while the reminder comes due.
    const pat = await guestOf("Pat");
    const drew = await guestOf("Drew");
    const browser = await pushBrowser();
    const endpoint = await subscribe(pat, "pat", browser);
    await subscribe(drew, "drew", browser);
    const message = await post(tab, "<p>Back to this</p>");
    await remind(pat, room, message.id, soon());
    await remind(drew, room, message.id, soon());
    // Drew's stay ends before the alarm runs, and their reminders then wait for nobody it pushes.
    await workspaceSql("UPDATE guest_stays SET until_at = ? WHERE user_id = ?", Date.now() - 1, drew.user.id);
    await makeRemindersDue();

    await withWorkspaceEnv({ EMBER_GUEST_SIGN_IN: undefined }, async () => {
      expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
      await vi.waitFor(() => expect(pushed).toHaveLength(1));
      expect(pushed[0]!.endpoint).toBe(endpoint);
      expect(JSON.parse(await browser.open(pushed[0]!.body))).toMatchObject({ options: { body: "Back to this" } });
      // Told all the same, both of them, since both were due.
      expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE reminded_at IS NOT NULL")).toEqual([{ n: 2 }]);
    });
  });

  it("sends no more pushes than one run may, leaving the rest for the next", async () => {
    const room = await freshRoom("budgeting");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    await connect(room, grace, { visible: true });
    // Ten browsers is the most someone saves, and each push is asked after and sent: two of the forty
    // requests one run may spend on the reminders, their queries counted like their pushes. Five
    // reminders ask fifty pushes, so the run buys the read and the first reminder told and pushed,
    // tells the second and leaves it its pushes, and the last three wait whole for the runs after.
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) await subscribe(grace, `grace-${n}`);
    const message = await post(ada, "<p>Tell me at noon</p>");
    for (const n of [1, 2, 3, 4, 5]) await remind(grace, room, message.id, soon());
    await makeRemindersDue();

    const { pushed, go } = heldPushServices();
    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    // The next run sits at its first pushes, held, so what the first left can be seen: the first
    // reminder's ten pushes went whole, and the second's tabs heard it without theirs.
    await vi.waitFor(
      async () => expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE reminded_at IS NOT NULL")).toEqual([{ n: 2 }]),
      { timeout: 10_000 },
    );
    expect(pushed.slice(0, 10).map(({ endpoint }) => endpoint.split("/").at(-1))).toEqual(
      expect.arrayContaining(["grace-1", "grace-2", "grace-3", "grace-4", "grace-5", "grace-6", "grace-7", "grace-8", "grace-9", "grace-10"]),
    );
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE pushed_at IS NOT NULL")).toEqual([{ n: 1 }]);
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE reminded_at IS NULL")).toEqual([{ n: 3 }]);
    // What the runs left, the run the held one's `go` unblocks takes, and the ones its wakes set after.
    go();
    await vi.waitFor(() => expect(pushed).toHaveLength(50), { timeout: 10_000 });
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE pushed_at IS NOT NULL")).toEqual([{ n: 5 }]);
  });

  it("pushes reminders with what the run's other deliveries leave of its budget, and the rest wait for the next run", async () => {
    const room = await freshRoom("sharing");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    await connect(room, grace, { visible: true });
    // Thirty pictures come due the same run, and ten browsers Grace saved make five reminders ask fifty
    // pushes: the pictures take thirty of the forty requests the run may spend, and what's left tells
    // the first reminder, whose pushes wait for the next run — ten requests buy no push, each asked
    // after and sent.
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
      await workspaceSql("INSERT INTO pending_picture_deletions (object_key, due_at) VALUES (?, ?)", `pictures/${n}`, Date.now() - 1_000);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) await subscribe(grace, `grace-${n}`);
    const message = await post(ada, "<p>Tell me after the pictures</p>");
    for (const n of [1, 2, 3, 4, 5]) await remind(grace, room, message.id, soon());
    await makeRemindersDue();

    const { pushed, go } = heldPushServices();
    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    // The next run pushes the first reminder's ten and the one after sits held at its first, so what
    // the pictures left can be seen: the first reminder told and pushed, the second told without its
    // pushes, and three waiting whole.
    await vi.waitFor(
      async () => expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE reminded_at IS NOT NULL")).toEqual([{ n: 2 }]),
      { timeout: 10_000 },
    );
    expect(await workspaceSql("SELECT count(*) AS n FROM pending_picture_deletions")).toEqual([{ n: 0 }]);
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE pushed_at IS NOT NULL")).toEqual([{ n: 1 }]);
    // What the runs left, the run the held one's `go` unblocks takes, and the ones its wakes set after.
    go();
    await vi.waitFor(() => expect(pushed).toHaveLength(50), { timeout: 10_000 });
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE pushed_at IS NOT NULL")).toEqual([{ n: 5 }]);
  });

  it("tells the tabs once though its push failed, and tries the push again only once the wait has passed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let status = 503;
    const pushed = pushServices(() => status);
    const room = await freshRoom("failing");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    await connect(room, grace, { visible: true });
    const tab = await openWorkspaceSocket(grace);
    const browser = await pushBrowser();
    await subscribe(grace, "grace", browser);
    const message = await post(ada, "<p>Tell me though the push fails</p>");
    await remind(grace, room, message.id, soon());
    await makeRemindersDue();

    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    expect(await heard(tab)).toEqual([
      { type: "reminder.due", reminder: expect.objectContaining({ excerpt: "Tell me though the push fails" }) },
    ]);
    // The push didn't reach the browser, so the reminder waits to push again: told, not settled, and
    // when the try was is kept.
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE reminded_at IS NOT NULL")).toEqual([{ n: 1 }]);
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE pushed_at IS NOT NULL")).toEqual([{ n: 0 }]);
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE push_tried_at IS NOT NULL")).toEqual([{ n: 1 }]);

    // A run that comes round before the wait has passed tries nothing: the push service isn't asked
    // again run after run, and however often they come, they say nothing more to the tabs, which have
    // heard it.
    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    expect(pushed).toHaveLength(1);
    expect(await heard(tab)).toEqual([]);

    // Once the wait has passed the push is tried again, and failing once more, it waits again.
    await workspaceSql("UPDATE reminders SET push_tried_at = ?", Date.now() - REMINDER_PUSH_RETRY_MS - 1_000);
    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    expect(pushed).toHaveLength(2);
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE pushed_at IS NOT NULL")).toEqual([{ n: 0 }]);
    expect(await heard(tab)).toEqual([]);

    // Once a push goes out the reminder is settled, and the tabs have still heard it once and only once.
    status = 201;
    await workspaceSql("UPDATE reminders SET push_tried_at = ?", Date.now() - REMINDER_PUSH_RETRY_MS - 1_000);
    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE pushed_at IS NOT NULL")).toEqual([{ n: 1 }]);
    expect(await heard(tab)).toEqual([]);
  });

  it("gives up on pushes that keep failing once the day past its time is spent, and stays told", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pushed = pushServices(() => 503);
    const room = await freshRoom("giving up");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    await connect(room, grace, { visible: true });
    const tab = await openWorkspaceSocket(grace);
    const browser = await pushBrowser();
    await subscribe(grace, "grace", browser);
    const message = await post(ada, "<p>Tell me though the browser never hears</p>");
    await remind(grace, room, message.id, soon());
    await makeRemindersDue();

    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    expect(await heard(tab)).toEqual([
      { type: "reminder.due", reminder: expect.objectContaining({ excerpt: "Tell me though the browser never hears" }) },
    ]);
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE pushed_at IS NOT NULL")).toEqual([{ n: 0 }]);

    // The day past its time is spent: the run that sees it, however soon it comes round, gives the
    // pushes up, the notice having reached the tabs all along.
    await workspaceSql("UPDATE reminders SET remind_at = ?", Date.now() - REMINDER_PUSH_GRACE_MS - 1_000);
    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE pushed_at IS NOT NULL")).toEqual([{ n: 1 }]);
    // Settled, nothing is set for the alarm to try again, and the tabs have heard the notice once.
    expect(await runDurableObjectAlarm(workspaceStub())).toBe(false);
    expect(pushed).toHaveLength(1);
    expect(await heard(tab)).toEqual([]);
  });

  it("sends a reminder its pushes tried again only to the browsers a try didn't reach", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pushed = pushServices((endpoint) => (endpoint.endsWith("/grace-slow") ? 503 : 201));
    const room = await freshRoom("partly");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    await connect(room, grace, { visible: true });
    await subscribe(grace, "grace-fast");
    await subscribe(grace, "grace-slow");
    const message = await post(ada, "<p>Reach the browsers I can</p>");
    await remind(grace, room, message.id, soon());
    await makeRemindersDue();

    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    // The fast browser heard it, and the slow one's push failed: told, not settled, and what the try
    // reached is kept.
    expect(pushed.filter(({ endpoint }) => endpoint.endsWith("/grace-fast"))).toHaveLength(1);
    expect(pushed.filter(({ endpoint }) => endpoint.endsWith("/grace-slow"))).toHaveLength(1);
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE reminded_at IS NOT NULL")).toEqual([{ n: 1 }]);
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE pushed_at IS NOT NULL")).toEqual([{ n: 0 }]);
    const [{ id }] = (await workspaceSql("SELECT id FROM push_subscriptions WHERE endpoint = ?", "https://fcm.googleapis.com/fcm/send/grace-fast")) as [{ id: number }];
    const [{ delivered }] = (await workspaceSql("SELECT delivered FROM reminders")) as [{ delivered: string }];
    expect(JSON.parse(delivered)).toEqual([id]);

    // The wait past, the try again sends the slow browser alone: the fast one is sent no reminder twice.
    await workspaceSql("UPDATE reminders SET push_tried_at = ?", Date.now() - REMINDER_PUSH_RETRY_MS - 1_000);
    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    expect(pushed.filter(({ endpoint }) => endpoint.endsWith("/grace-fast"))).toHaveLength(1);
    expect(pushed.filter(({ endpoint }) => endpoint.endsWith("/grace-slow"))).toHaveLength(2);
    const [{ delivered: kept }] = (await workspaceSql("SELECT delivered FROM reminders")) as [{ delivered: string }];
    expect(JSON.parse(kept)).toEqual([id]);
    expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE pushed_at IS NOT NULL")).toEqual([{ n: 0 }]);
  });

  it("sets the alarm for what's due next even when a query fails", async () => {
    const pushed = pushServices();
    const room = await freshRoom("queries");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    await connect(room, grace, { visible: true });
    const browser = await pushBrowser();
    await subscribe(grace, "grace", browser);
    const message = await post(ada, "<p>Wake for me though the read is lost</p>");
    await remind(grace, room, message.id, soon());
    await makeRemindersDue();

    let restore!: () => void;
    try {
      await runInDurableObject(workspaceStub(), (workspace: Workspace) => {
        const store = (workspace as unknown as { store: WorkspaceStore }).store;
        const reading = store.dueReminders.bind(store);
        restore = () => {
          store.dueReminders = reading;
        };
        store.dueReminders = () => Promise.reject(new Error("The database's answer was lost"));
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      // The read of what's due failed, and the alarm for it was set all the same.
      expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    } finally {
      restore?.();
    }

    // What the failed run left, a later run tells.
    await vi.waitFor(async () => expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE pushed_at IS NOT NULL")).toEqual([{ n: 1 }]), { timeout: 10_000 });
    expect(pushed.length).toBeGreaterThan(0);
  });

  it("sets the alarm for what's due next even when asking what's due fails", async () => {
    const pushed = pushServices();
    const room = await freshRoom("asking");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    await connect(room, grace, { visible: true });
    const browser = await pushBrowser();
    await subscribe(grace, "grace", browser);
    const message = await post(ada, "<p>Wake for me though the asking is lost</p>");
    await remind(grace, room, message.id, soon());
    await makeRemindersDue();

    let restore!: () => void;
    try {
      await runInDurableObject(workspaceStub(), (workspace: Workspace) => {
        const store = (workspace as unknown as { store: WorkspaceStore }).store;
        const asking = store.nextDeliveryDue.bind(store);
        restore = () => {
          store.nextDeliveryDue = asking;
        };
        store.nextDeliveryDue = () => Promise.reject(new Error("The database's answer was lost"));
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      // The asking failed, and the alarm was set for a minute on all the same, which the tests' clock
      // fires at once.
      expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    } finally {
      restore?.();
    }

    // The reminder itself went out on the run that couldn't ask; the wake it set for a minute on
    // finds nothing left when the tests' clock fires it at once, and nothing waits after it.
    await vi.waitFor(async () => expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE pushed_at IS NOT NULL")).toEqual([{ n: 1 }]), { timeout: 10_000 });
    expect(pushed.length).toBeGreaterThan(0);
    expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
    expect(await runDurableObjectAlarm(workspaceStub())).toBe(false);
  });

  it("sets the alarm for what's due next even when a delivery fails", async () => {
    const pushed = pushServices();
    const room = await freshRoom("scheduling");
    const ada = await connect(room, "Ada", { visible: true });
    const grace = await signIn("Grace");
    await connect(room, grace, { visible: true });
    const browser = await pushBrowser();
    await subscribe(grace, "grace", browser);
    const message = await post(ada, "<p>Wake for me whatever happens</p>");
    await remind(grace, room, message.id, soon());
    await makeRemindersDue();

    let restore!: () => void;
    try {
      await runInDurableObject(workspaceStub(), (workspace: Workspace) => {
        const store = (workspace as unknown as { store: WorkspaceStore }).store;
        const telling = store.markReminderTold.bind(store);
        restore = () => {
          store.markReminderTold = telling;
        };
        store.markReminderTold = () => Promise.reject(new Error("The database's answer was lost"));
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      // The delivery failed part way, and the alarm for the reminder it left was set all the same.
      expect(await runDurableObjectAlarm(workspaceStub())).toBe(true);
      expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE reminded_at IS NOT NULL")).toEqual([{ n: 0 }]);
    } finally {
      restore?.();
    }

    // What the failed run left, a later run tells.
    await vi.waitFor(async () => expect(await workspaceSql("SELECT count(*) AS n FROM reminders WHERE reminded_at IS NOT NULL")).toEqual([{ n: 1 }]));
    expect(pushed.length).toBeGreaterThan(0);
  });
});
