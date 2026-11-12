import { runDurableObjectAlarm } from "cloudflare:test";
import { MAX_SAVED_ITEMS, NOTE_FILES_PATH, SAVED_LIST_FULL, type NoteFile, type SavedItem, type SavedItems, type SavedList, type SavedMark, type SavedMarks, type WorkspaceServerFrame, type ActivityPage } from "@ember/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, connect, createRoom, freshDeploy, freshRoom, openWorkspaceSocket, post, pushBrowser, signIn, upload, workspaceSql, workspaceStub, type Session } from "./support";

const as = (session: Session) => ({ headers: { Cookie: session.cookie } });

/** Keeps something as `session`, answering how the Worker answered. */
const keep = (session: Session, item: unknown) => api("/api/saved", { method: "POST", ...as(session), body: JSON.stringify(item) });

/** Keeps something as `session`, answering the item kept. */
async function kept(session: Session, item: unknown): Promise<SavedItem> {
  const response = await keep(session, item);
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as SavedItem;
}

/** Changes `session`'s item `id`, answering how the Worker answered. */
const change = (session: Session, id: string, changes: unknown) => api(`/api/saved/${id}`, { method: "PATCH", ...as(session), body: JSON.stringify(changes) });

async function changed(session: Session, id: string, changes: unknown): Promise<SavedItem> {
  const response = await change(session, id, changes);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as SavedItem;
}

/** `session`'s list `list`, newest first. */
async function listOf(session: Session, list: SavedList): Promise<SavedItem[]> {
  const response = await api(`/api/saved?list=${list}`, as(session));
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as SavedItems).items;
}

async function marksOf(session: Session): Promise<SavedMark[]> {
  return ((await (await api("/api/saved/marks", as(session))).json()) as SavedMarks).marks;
}

async function countsOf(session: Session): Promise<Omit<SavedMarks, "marks">> {
  const { marks: _, ...counts } = (await (await api("/api/saved/marks", as(session))).json()) as SavedMarks;
  return counts;
}

/** Posts `text` in `room` as `session`, answering the message. */
async function said(room: string, session: Session, text: string) {
  const client = await connect(room, session);
  const message = await post(client, `<p>${text}</p>`);
  client.ws.close();
  return message;
}


/** Sends `text` as a file for a note, as `session`, answering how the Worker answered. */
const sendNoteFile = (session: Session, name: string, text: string) =>
  api(`${NOTE_FILES_PATH}?name=${name}`, { method: "POST", headers: { Cookie: session.cookie, "Content-Type": "text/plain" }, body: text });

/** Makes `id`'s reminder due now and runs the Workspace's alarm, answering where pushes went. */
async function remindNow(id: string): Promise<string[]> {
  const pushed: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    pushed.push(input instanceof Request ? input.url : String(input));
    return new Response(null, { status: 201 });
  });
  await workspaceSql("UPDATE saved_items SET remind_at = ? WHERE id = ?", Date.now() - 1, id);
  await runDurableObjectAlarm(workspaceStub());
  vi.restoreAllMocks();
  return pushed;
}

/** Subscribes `session` to pushes, answering the endpoint. */
async function subscribe(session: Session, label: string): Promise<string> {
  const { p256dh, auth } = await pushBrowser();
  const endpoint = `https://fcm.googleapis.com/fcm/send/${label}`;
  await api("/api/push-subscriptions", { method: "POST", ...as(session), body: JSON.stringify({ endpoint, p256dhKey: p256dh, authKey: auth }) });
  return endpoint;
}

const activityOf = async (session: Session) => ((await (await api("/api/activity", as(session))).json()) as ActivityPage).items;

const inAMinute = () => new Date(Date.now() + 60_000).toISOString();

beforeEach(freshDeploy);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Keeping messages", () => {
  it("adds a message to your to-dos, then moves it to Saved and back, keeping it once", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("Design");
    const message = await said(room, ada, "Ship the deck");

    const todo = await kept(ada, { list: "todo", roomId: room, messageId: message.id });
    expect(todo).toMatchObject({ list: "todo", kind: "message", roomId: room, messageId: message.id, completedAt: null, remindAt: null });
    expect(todo.message?.plainText).toBe("Ship the deck");

    const saved = await kept(ada, { list: "saved", roomId: room, messageId: message.id });
    expect(saved.id).toBe(todo.id);
    expect(saved.list).toBe("saved");
    expect(await listOf(ada, "todo")).toEqual([]);
    expect((await listOf(ada, "saved")).map(({ id }) => id)).toEqual([todo.id]);

    expect((await changed(ada, todo.id, { list: "todo" })).list).toBe("todo");
    expect(await marksOf(ada)).toEqual([{ id: todo.id, list: "todo", messageId: message.id }]);
  });

  it("keeps a file message as its file", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("Design");
    const file = await upload(ada, room, "notes.txt", new TextEncoder().encode("hello"), "text/plain");

    const item = await kept(ada, { list: "saved", roomId: room, messageId: file.id });
    expect(item.kind).toBe("file");
    expect(item.message?.attachment?.name).toBe("notes.txt");
  });

  it("is yours alone: nobody else sees or changes your items", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await freshRoom("Design");
    const message = await said(room, ada, "Mine");
    const item = await kept(ada, { list: "saved", roomId: room, messageId: message.id });

    expect(await listOf(grace, "saved")).toEqual([]);
    expect((await change(grace, item.id, { list: "todo" })).status).toBe(404);
    expect((await api(`/api/saved/${item.id}`, { method: "DELETE", ...as(grace) })).status).toBe(404);
    expect((await api(`/api/saved/${item.id}`, as(grace))).status).toBe(404);
  });

  it("won't keep a message in a room you aren't in, or one the room doesn't have", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const { id: room } = await createRoom("Board", { closedTo: [ada.user.id], as: ada });
    const message = await said(room, ada, "Secret");

    expect((await keep(grace, { list: "saved", roomId: room, messageId: message.id })).status).toBe(404);
    expect((await keep(ada, { list: "saved", roomId: room, messageId: "nope" })).status).toBe(404);
    expect((await keep(ada, { list: "elsewhere", roomId: room, messageId: message.id })).status).toBe(422);
    expect((await api("/api/saved?list=todo")).status).toBe(401);
  });

  it("shows a message as it's edited, and as deleted once it is, until it's cleared", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("Design");
    const client = await connect(room, ada);
    const message = await post(client, "<p>Draft</p>");
    const item = await kept(ada, { list: "todo", roomId: room, messageId: message.id });

    client.send({ type: "message.update", messageId: message.id, body: "<p>Final</p>" });
    await client.next("message.updated");
    expect((await listOf(ada, "todo"))[0]!.message?.plainText).toBe("Final");

    client.send({ type: "message.delete", messageId: message.id });
    await client.next("message.deleted");
    client.ws.close();
    const [deleted] = await listOf(ada, "todo");
    expect(deleted).toMatchObject({ id: item.id, message: null });

    expect((await api(`/api/saved/${item.id}`, { method: "DELETE", ...as(ada) })).status).toBe(204);
    expect(await listOf(ada, "todo")).toEqual([]);
  });

  it("shows items from a room you've left as unavailable", async () => {
    const ada = await signIn("Ada");
    const { id: room } = await createRoom("Board", { closedTo: [ada.user.id], as: ada });
    const message = await said(room, ada, "Before I left");
    const item = await kept(ada, { list: "saved", roomId: room, messageId: message.id });

    await workspaceSql("DELETE FROM memberships WHERE room_id = ? AND user_id = ?", room, ada.user.id);
    const [shown] = await listOf(ada, "saved");
    expect(shown).toMatchObject({ id: item.id, unavailable: true });
    expect(shown!.message).toBeUndefined();
  });

  it("holds up to MAX_SAVED_ITEMS in a list", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("Design");
    const message = await said(room, ada, "One more");
    const now = new Date().toISOString();
    for (let n = 0; n < MAX_SAVED_ITEMS; n++)
      await workspaceSql("INSERT INTO saved_items (id, user_id, list, kind, body, plain_text, created_at, updated_at) VALUES (?, ?, 'saved', 'note', '', '', ?, ?)", `n${n}`, ada.user.id, now, now);

    const response = await keep(ada, { list: "saved", roomId: room, messageId: message.id });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: SAVED_LIST_FULL });
    await kept(ada, { list: "todo", roomId: room, messageId: message.id });
  });

  it("tells every tab of yours what you keep, and nobody else", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await freshRoom("Design");
    const message = await said(room, ada, "Hello");
    const tab = await openWorkspaceSocket(ada);
    const gracesTab = await openWorkspaceSocket(grace);

    const item = await kept(ada, { list: "saved", roomId: room, messageId: message.id });
    expect(await tab.next()).toEqual({ type: "saved.changed", marks: [{ id: item.id, list: "saved", messageId: message.id }], openTodos: 0, overdueTodos: 0, savedItems: 1 } satisfies WorkspaceServerFrame);
    // Grace hears of Ada's message in their room, and of nothing Ada keeps.
    gracesTab.send(JSON.stringify({ type: "ping", nonce: crypto.randomUUID() }));
    const heard: string[] = [];
    for (let frame = await gracesTab.next(); frame.type !== "pong"; frame = await gracesTab.next()) heard.push(frame.type);
    expect(heard).not.toContain("saved.changed");
  });
});

describe("To-dos of your own", () => {
  it("gives a file to one note only, and deletes those no note takes within a day", async () => {
    const ada = await signIn("Ada");
    const file = (await (await sendNoteFile(ada, "a.txt", "aaa")).json()) as NoteFile;
    await kept(ada, { list: "todo", body: "", fileIds: [file.id] });
    expect((await keep(ada, { list: "todo", body: "", fileIds: [file.id] })).status).toBe(422);

    const unused = (await (await sendNoteFile(ada, "b.txt", "bbb")).json()) as NoteFile;
    await workspaceSql("UPDATE note_uploads SET created_at = ?", Date.now() - 25 * 60 * 60 * 1000);
    await runDurableObjectAlarm(workspaceStub());
    expect((await api(unused.url)).status).toBe(404);
    expect((await api(file.url)).status).toBe(200);
  });

  it("takes so many files waiting for notes, and puts a file back when its note can't be kept", async () => {
    const ada = await signIn("Ada");
    for (let n = 0; n < 20; n++) expect((await sendNoteFile(ada, `f${n}.txt`, "x")).status).toBe(201);
    expect((await sendNoteFile(ada, "more.txt", "x")).status).toBe(429);

    const [{ key }] = (await workspaceSql("SELECT key FROM note_uploads LIMIT 1")) as [{ key: string }];
    expect((await keep(ada, { list: "todo", body: "<p>x</p>", fileIds: [key], remindAt: "2000-01-01T00:00:00.000Z" })).status).toBe(422);
    expect((await keep(ada, { list: "todo", body: "", fileIds: [key] })).status).toBe(201);
  });

  it("refuses a note of nothing a reader could see, made or changed so", async () => {
    const ada = await signIn("Ada");
    expect((await keep(ada, { list: "todo", body: "<p>\u200B\u200B</p>" })).status).toBe(422);
    const note = await kept(ada, { list: "todo", body: "<p>Keep me</p>" });
    expect((await change(ada, note.id, { body: "<p> </p>" })).status).toBe(422);
    expect((await listOf(ada, "todo"))[0]!.plainText).toBe("Keep me");
  });

  it("keeps a note with its text, completes it and reopens it", async () => {
    const ada = await signIn("Ada");
    const note = await kept(ada, { list: "todo", body: "<p>Call <strong>Grace</strong></p>" });
    expect(note).toMatchObject({ list: "todo", kind: "note", plainText: "Call Grace", files: [] });
    expect(note.body).toContain("<strong>Grace</strong>");

    expect(await countsOf(ada)).toEqual({ openTodos: 1, overdueTodos: 0, savedItems: 0 });
    expect((await changed(ada, note.id, { completed: true })).completedAt).not.toBeNull();
    expect(await countsOf(ada)).toEqual({ openTodos: 0, overdueTodos: 0, savedItems: 0 });
    expect((await changed(ada, note.id, { completed: false, body: "<p>Call Lin</p>" })).plainText).toBe("Call Lin");
    // A note moves to Saved, and back, as a message does.
    expect((await changed(ada, note.id, { list: "saved" })).list).toBe("saved");
    expect((await listOf(ada, "saved")).map(({ kind }) => kind)).toEqual(["note"]);
    expect((await changed(ada, note.id, { list: "todo" })).list).toBe("todo");
    expect(await marksOf(ada)).toEqual([]);
  });

  it("refuses an empty note, and a note in Saved", async () => {
    const ada = await signIn("Ada");
    expect((await keep(ada, { list: "todo", body: "<p> </p>" })).status).toBe(422);
    expect((await keep(ada, { list: "saved", body: "<p>x</p>" })).status).toBe(422);
  });

  it("carries files you upload for it, and no one else's, served at signed addresses", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const sent = await api(`${NOTE_FILES_PATH}?name=list.txt`, { method: "POST", headers: { Cookie: ada.cookie, "Content-Type": "text/plain" }, body: "milk, eggs" });
    expect(sent.status, await sent.clone().text()).toBe(201);
    const file = (await sent.json()) as NoteFile;
    expect(file).toMatchObject({ name: "list.txt", contentType: "text/plain", byteSize: 10 });
    expect(await (await api(file.url)).text()).toBe("milk, eggs");

    expect((await keep(grace, { list: "todo", body: "", fileIds: [file.id] })).status).toBe(422);
    const note = await kept(ada, { list: "todo", body: "", fileIds: [file.id] });
    expect(note.files?.map(({ name }) => name)).toEqual(["list.txt"]);

    expect((await changed(ada, note.id, { fileIds: [], body: "<p>Done</p>" })).files).toEqual([]);
    expect((await api(file.url)).status).toBe(404);
  });
});

describe("Reminders", () => {
  it("says nothing of a room its person has been taken out of, and takes the reminder back", async () => {
    const [ada, leo] = [await signIn("Ada"), await signIn("Leo")];
    await subscribe(leo, "leo");
    const { id: room } = await createRoom("Board", { closedTo: [ada.user.id, leo.user.id], as: ada });
    const message = await said(room, ada, "Secret plans");
    const item = await kept(leo, { list: "todo", roomId: room, messageId: message.id });
    await changed(leo, item.id, { remindAt: inAMinute() });
    const tab = await openWorkspaceSocket(leo);
    await workspaceSql("DELETE FROM memberships WHERE room_id = ? AND user_id = ?", room, leo.user.id);

    expect(await remindNow(item.id)).toEqual([]);
    const heard: WorkspaceServerFrame[] = [];
    tab.send(JSON.stringify({ type: "ping", nonce: crypto.randomUUID() }));
    for (let frame = await tab.next(); frame.type !== "pong"; frame = await tab.next()) heard.push(frame);
    expect(heard.map(({ type }) => type)).not.toContain("activity.added");
    expect(JSON.stringify(heard)).not.toContain("Secret plans");
    expect(await activityOf(leo)).toEqual([]);
    expect((await countsOf(leo)).overdueTodos).toBe(0);
  });

  it("doesn't remind of a completed to-do, nor of a deleted message", async () => {
    const ada = await signIn("Ada");
    await subscribe(ada, "ada");
    const done = await kept(ada, { list: "todo", body: "<p>Done already</p>" });
    await changed(ada, done.id, { remindAt: inAMinute(), completed: true });
    expect(await remindNow(done.id)).toEqual([]);

    const room = await freshRoom("Design");
    const client = await connect(room, ada);
    const message = await post(client, "<p>Gone soon</p>");
    const item = await kept(ada, { list: "todo", roomId: room, messageId: message.id });
    await changed(ada, item.id, { remindAt: inAMinute() });
    client.send({ type: "message.delete", messageId: message.id });
    await client.next("message.deleted");
    client.ws.close();
    expect(await remindNow(item.id)).toEqual([]);
    expect(await activityOf(ada)).toEqual([]);
    expect((await listOf(ada, "todo")).map(({ remindAt }) => remindAt)).toEqual([null, null]);
  });

  it("takes a to-do's reminder away as it moves to Saved, which takes none", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("Design");
    const message = await said(room, ada, "Later");
    const item = await kept(ada, { list: "todo", roomId: room, messageId: message.id });
    await changed(ada, item.id, { remindAt: inAMinute() });
    expect((await changed(ada, item.id, { list: "saved" })).remindAt).toBeNull();
    expect((await changed(ada, item.id, { remindAt: inAMinute() })).remindAt).toBeNull();
  });

  it("reminds of a message with its text, in its room", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("Design");
    const message = await said(room, ada, "Review the deck");
    const item = await kept(ada, { list: "todo", roomId: room, messageId: message.id });
    await changed(ada, item.id, { remindAt: new Date(Date.now() + 60_000).toISOString() });
    await workspaceSql("UPDATE saved_items SET remind_at = ? WHERE id = ?", Date.now() - 1, item.id);
    await runDurableObjectAlarm(workspaceStub());

    const activity = (await (await api("/api/activity", as(ada))).json()) as ActivityPage;
    expect(activity.items).toMatchObject([{ kind: "reminder", roomId: room, messageId: message.id, preview: "Review the deck", content: item.id }]);
  });

  it("refuses a reminder in the past", async () => {
    const ada = await signIn("Ada");
    const note = await kept(ada, { list: "todo", body: "<p>Later</p>" });
    expect((await change(ada, note.id, { remindAt: new Date(Date.now() - 60_000).toISOString() })).status).toBe(422);
  });

  it("pushes a reminder once it's due, and clears it", async () => {
    const ada = await signIn("Ada");
    const { p256dh, auth } = await pushBrowser();
    const endpoint = "https://fcm.googleapis.com/fcm/send/ada";
    await api("/api/push-subscriptions", { method: "POST", ...as(ada), body: JSON.stringify({ endpoint, p256dhKey: p256dh, authKey: auth }) });
    const note = await kept(ada, { list: "todo", body: "<p>Stand-up</p>" });
    const remindAt = new Date(Date.now() + 60_000).toISOString();
    expect((await changed(ada, note.id, { remindAt })).remindAt).toBe(remindAt);

    const pushed: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      pushed.push(input instanceof Request ? input.url : String(input));
      return new Response(null, { status: 201 });
    });
    const tab = await openWorkspaceSocket(ada);
    await workspaceSql("UPDATE saved_items SET remind_at = ? WHERE id = ?", Date.now() - 1, note.id);
    await runDurableObjectAlarm(workspaceStub());

    expect(pushed).toEqual([endpoint]);
    const added = await tab.next();
    expect(added).toMatchObject({ type: "activity.added", items: [{ kind: "reminder", roomId: "", messageId: null, actorId: ada.user.id, preview: "Stand-up", content: note.id, read: false }] });
    expect(await tab.next()).toEqual({ type: "saved.changed", marks: [], openTodos: 1, overdueTodos: 1, savedItems: 0 });
    // It keeps its time, gone off, and is overdue until it's completed or given another reminder.
    expect((await listOf(ada, "todo"))[0]).toMatchObject({ remindAt: expect.any(String), reminded: true });
    expect(pushed).toEqual([endpoint]);
    await runDurableObjectAlarm(workspaceStub());
    expect(pushed).toEqual([endpoint]);
    const later = new Date(Date.now() + 120_000).toISOString();
    expect(await changed(ada, note.id, { remindAt: later })).not.toHaveProperty("reminded");
    expect((await countsOf(ada)).overdueTodos).toBe(0);
    const activity = (await (await api("/api/activity", as(ada))).json()) as ActivityPage;
    expect(activity.items.map(({ kind, content }) => [kind, content])).toEqual([["reminder", note.id]]);
  });
});
