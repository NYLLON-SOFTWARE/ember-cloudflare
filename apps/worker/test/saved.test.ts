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

async function openTodosOf(session: Session): Promise<number> {
  return ((await (await api("/api/saved/marks", as(session))).json()) as SavedMarks).openTodos;
}

/** Posts `text` in `room` as `session`, answering the message. */
async function said(room: string, session: Session, text: string) {
  const client = await connect(room, session);
  const message = await post(client, `<p>${text}</p>`);
  client.ws.close();
  return message;
}

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
    expect(await tab.next()).toEqual({ type: "saved.changed", marks: [{ id: item.id, list: "saved", messageId: message.id }], openTodos: 0 } satisfies WorkspaceServerFrame);
    expect(await gracesTab.answers()).toBe(true);
  });
});

describe("To-dos of your own", () => {
  it("keeps a note with its text, completes it and reopens it", async () => {
    const ada = await signIn("Ada");
    const note = await kept(ada, { list: "todo", body: "<p>Call <strong>Grace</strong></p>" });
    expect(note).toMatchObject({ list: "todo", kind: "note", plainText: "Call Grace", files: [] });
    expect(note.body).toContain("<strong>Grace</strong>");

    expect(await openTodosOf(ada)).toBe(1);
    expect((await changed(ada, note.id, { completed: true })).completedAt).not.toBeNull();
    expect(await openTodosOf(ada)).toBe(0);
    expect((await changed(ada, note.id, { completed: false, body: "<p>Call Lin</p>" })).plainText).toBe("Call Lin");
    expect((await change(ada, note.id, { list: "saved" })).status).toBe(422);
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
    expect(await tab.next()).toEqual({ type: "saved.changed", marks: [], openTodos: 1 });
    expect((await listOf(ada, "todo"))[0]!.remindAt).toBeNull();
    const activity = (await (await api("/api/activity", as(ada))).json()) as ActivityPage;
    expect(activity.items.map(({ kind, content }) => [kind, content])).toEqual([["reminder", note.id]]);
  });
});
