import type { RoomId } from "@ember/protocol";
import {
  CANVAS_CHANGED,
  EMPTY_CANVAS,
  MAX_ROOM_TABS,
  roomLibraryPath,
  roomTabPath,
  roomTabsPath,
  TAB_LIMIT_REACHED,
  type FileMarks,
  type Library,
  type OpenedTab,
  type RoomTab,
} from "@ember/protocol/library";
import { beforeEach, describe, expect, it } from "vitest";
import { linksOf } from "../src/library";
import { api, connect, createRoom, freshDeploy, freshRoom, post, recordedImage, roomSql, signIn, upload, workspaceSql, type Session } from "./support";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until room `room` has nothing left in its log for the search index, which the library reads. */
async function caughtUp(room: RoomId): Promise<void> {
  while ((await roomSql(room, "SELECT seq FROM unindexed_messages WHERE room_id = ?", room)).length > 0) await sleep(5);
}

/** What `session`'s request to `path` answers, with `body` as JSON. */
const asking = (session: Session, path: string, method = "GET", body?: unknown) =>
  api(path, { method, headers: { Cookie: session.cookie }, ...(body !== undefined && { body: JSON.stringify(body) }) });

async function ok<T>(response: Response, status = 200): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(status);
  return response.json() as Promise<T>;
}

const filesOf = async (session: Session) => ok<Library>(await asking(session, "/api/files"));
const tabsOf = async (session: Session, room: RoomId) => (await ok<{ tabs: RoomTab[] }>(await asking(session, roomTabsPath(room)))).tabs;
const addTab = (session: Session, room: RoomId, tab: unknown) => asking(session, roomTabsPath(room), "POST", tab);

beforeEach(freshDeploy);

describe("The Files page", () => {
  it("lists the files sent in the rooms you're in, newest first, and none from rooms you aren't", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const open = await freshRoom("files-open");
    const closed = (await createRoom("files-closed", { closedTo: [grace.user.id], as: grace })).id;
    const first = await upload(ada, open, "Moon landing.jpg", recordedImage("moon-thumb.jpg"));
    const second = await upload(grace, open, "Budget.csv", new TextEncoder().encode("a,b\n1,2\n"), "text/csv");
    const hidden = await upload(grace, closed, "Secret plans.pdf", new TextEncoder().encode("%PDF-1.4\n"), "application/pdf");
    await Promise.all([caughtUp(open), caughtUp(closed)]);

    const { files, links } = await filesOf(ada);
    expect(files.map(({ id }) => id)).toEqual([second.attachment.id, first.attachment.id]);
    expect(links).toEqual([]);
    expect(files[0]).toMatchObject({ kind: "file", name: "Budget.csv", type: "spreadsheets", roomId: open, owner: { id: grace.user.id }, messageId: second.id, starred: false, viewedAt: null });
    expect(files[1]!.file).toMatchObject({ id: first.attachment.id, url: first.attachment.url, downloadUrl: first.attachment.downloadUrl });
    expect((await filesOf(grace)).files.map(({ id }) => id)).toContain(hidden.attachment.id);
  });

  it("keeps what you star and open, only for files in your rooms", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await freshRoom("files-marks");
    const closed = (await createRoom("files-marks-closed", { closedTo: [grace.user.id], as: grace })).id;
    const file = await upload(ada, room, "Moon landing.jpg", recordedImage("moon-thumb.jpg"));
    await caughtUp(room);
    const fileId = file.attachment.id;
    expect(await ok<FileMarks>(await asking(ada, "/api/files/marks", "PUT", { fileId, roomId: room, starred: true }))).toEqual({ starred: true, viewedAt: null });
    const viewed = await ok<FileMarks>(await asking(ada, "/api/files/marks", "PUT", { fileId, roomId: room, viewed: true }));
    expect(viewed).toMatchObject({ starred: true, viewedAt: expect.any(String) });
    expect((await filesOf(ada)).files[0]).toMatchObject({ id: fileId, starred: true, viewedAt: viewed.viewedAt });
    expect((await filesOf(grace)).files[0]).toMatchObject({ id: fileId, starred: false, viewedAt: null });

    expect((await asking(ada, "/api/files/marks", "PUT", { fileId, roomId: closed, starred: true })).status).toBe(404);
    expect((await asking(ada, "/api/files/marks", "PUT", { fileId, roomId: room })).status).toBe(422);
    expect((await api("/api/files")).status).toBe(401);
  });
});

describe("A room's Files & links", () => {
  it("lists the room's files and the links its messages hold, only to its members", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = (await createRoom("library-closed", { closedTo: [ada.user.id], as: ada })).id;
    const socket = await connect(room, ada);
    await post(socket, '<p>See <a href="https://example.com/guide">the field guide</a> and https://example.org/maps.</p>');
    const file = await upload(ada, room, "Moon landing.jpg", recordedImage("moon-thumb.jpg"));
    await caughtUp(room);
    const { files, links } = await ok<Library>(await asking(ada, roomLibraryPath(room)));
    expect(files.map(({ id }) => id)).toEqual([file.attachment.id]);
    expect(links.map(({ url, title }) => ({ url, title }))).toEqual([
      { url: "https://example.com/guide", title: "the field guide" },
      { url: "https://example.org/maps", title: "https://example.org/maps" },
    ]);
    expect((await asking(grace, roomLibraryPath(room))).status).toBe(404);
  });

  it("finds each link once, by what it says", () => {
    expect(linksOf({ body: '<a href="https://a.example/?x=1&amp;y=2">A &amp; B</a>', plainText: "A & B https://a.example/?x=1&y=2 http://b.example/c." })).toEqual([
      { url: "https://a.example/?x=1&y=2", title: "A & B" },
      { url: "http://b.example/c", title: "http://b.example/c" },
    ]);
    expect(linksOf({ body: '<a href="mailto:ada@example.com">mail</a>', plainText: "mail" })).toEqual([]);
  });
});

describe("Room tabs", () => {
  it("adds links, folders and canvases after each other, which members rename, reorder and remove", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("tabs");
    const link = await ok<OpenedTab>(await addTab(ada, room, { kind: "link", title: "Guide", url: "https://example.com/guide" }));
    expect(link.tab).toMatchObject({ kind: "link", title: "Guide", url: "https://example.com/guide", creator: { id: ada.user.id } });
    const folder = await ok<OpenedTab>(await addTab(ada, room, { kind: "folder", title: "Plans" }));
    expect(folder.items).toEqual([]);
    const canvas = await ok<OpenedTab>(await addTab(ada, room, { kind: "canvas", title: "Notes" }));
    expect(canvas.canvas).toMatchObject({ body: EMPTY_CANVAS, version: 0, updatedBy: { id: ada.user.id } });
    expect((await tabsOf(ada, room)).map(({ title }) => title)).toEqual(["Guide", "Plans", "Notes"]);

    expect((await ok<OpenedTab>(await asking(ada, roomTabPath(room, folder.tab.id), "PATCH", { title: " Roadmap " }))).tab.title).toBe("Roadmap");
    const order = [canvas.tab.id, link.tab.id, folder.tab.id];
    expect((await ok<{ tabs: RoomTab[] }>(await asking(ada, `${roomTabsPath(room)}/order`, "PUT", { tabIds: order }))).tabs.map(({ id }) => id)).toEqual(order);
    expect((await asking(ada, roomTabPath(room, link.tab.id), "DELETE")).status).toBe(204);
    expect((await tabsOf(ada, room)).map(({ title }) => title)).toEqual(["Notes", "Roadmap"]);
    expect((await asking(ada, roomTabPath(room, link.tab.id))).status).toBe(404);
  });

  it("refuses links that aren't web addresses, nameless tabs, and more than a room holds", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("tabs-refused");
    expect((await addTab(ada, room, { kind: "link", title: "Run", url: "javascript:alert(1)" })).status).toBe(422);
    expect((await addTab(ada, room, { kind: "canvas", title: " " })).status).toBe(422);
    expect((await addTab(ada, room, { kind: "table", title: "Data" })).status).toBe(422);
    for (let n = 0; n < MAX_ROOM_TABS; n++) await ok(await addTab(ada, room, { kind: "folder", title: `Folder ${n}` }));
    const full = await addTab(ada, room, { kind: "folder", title: "One more" });
    expect(full.status).toBe(422);
    expect(await full.json()).toEqual({ error: TAB_LIMIT_REACHED });
  });

  it("holds files sent in the room, signed, and never a file from another", async () => {
    const ada = await signIn("Ada");
    const [room, other] = [await freshRoom("tabs-files"), await freshRoom("tabs-files-other")];
    const file = await upload(ada, room, "Moon landing.jpg", recordedImage("moon-thumb.jpg"));
    const elsewhere = await upload(ada, other, "Elsewhere.jpg", recordedImage("moon-thumb.jpg"));
    const tab = await ok<OpenedTab>(await addTab(ada, room, { kind: "file", title: "Moon", messageId: file.id }));
    expect(tab.tab.file).toEqual({ messageId: file.id, file: file.attachment });
    expect((await addTab(ada, room, { kind: "file", title: "Elsewhere", messageId: elsewhere.id })).status).toBe(422);

    const folder = await ok<OpenedTab>(await addTab(ada, room, { kind: "folder", title: "Pictures" }));
    const items = `${roomTabPath(room, folder.tab.id)}/items`;
    const withFile = await ok<OpenedTab>(await asking(ada, items, "POST", { kind: "file", title: "Moon", messageId: file.id }));
    const withLink = await ok<OpenedTab>(await asking(ada, items, "POST", { kind: "link", title: "NASA", url: "https://www.nasa.gov" }));
    expect(withFile.items![0]!.file).toEqual({ messageId: file.id, file: file.attachment });
    expect(withLink.items!.map(({ title }) => title)).toEqual(["Moon", "NASA"]);
    const removed = await ok<OpenedTab>(await asking(ada, `${items}/${withFile.items![0]!.id}`, "DELETE"));
    expect(removed.items!.map(({ title }) => title)).toEqual(["NASA"]);
    expect((await asking(ada, `${roomTabPath(room, tab.tab.id)}/items`, "POST", { kind: "link", title: "x", url: "https://x.example" })).status).toBe(404);
  });

  it("saves a canvas over the version it changed, refusing a save over an older one, and lists it on the Files page", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await freshRoom("tabs-canvas");
    const { tab } = await ok<OpenedTab>(await addTab(ada, room, { kind: "canvas", title: "Launch notes" }));
    const canvasPath = `${roomTabPath(room, tab.id)}/canvas`;
    const body = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Liftoff" }] }] });
    const saved = await ok<OpenedTab>(await asking(grace, canvasPath, "PUT", { body, version: 0 }));
    expect(saved.canvas).toMatchObject({ body, version: 1, updatedBy: { id: grace.user.id } });
    const stale = await asking(ada, canvasPath, "PUT", { body: EMPTY_CANVAS, version: 0 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: CANVAS_CHANGED, canvas: { body, version: 1 } });
    expect((await asking(ada, canvasPath, "PUT", { body: "not a doc", version: 1 })).status).toBe(422);
    expect((await ok<OpenedTab>(await asking(ada, roomTabPath(room, tab.id)))).canvas!.body).toBe(body);
    expect((await filesOf(ada)).files).toEqual([expect.objectContaining({ id: tab.id, kind: "canvas", name: "Launch notes", type: "documents", roomId: room })]);
  });

  it("are only the room's members' to see and change, and go with the room", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = (await createRoom("tabs-closed", { closedTo: [ada.user.id], as: ada })).id;
    const { tab } = await ok<OpenedTab>(await addTab(ada, room, { kind: "canvas", title: "Private" }));
    expect((await asking(grace, roomTabsPath(room))).status).toBe(404);
    expect((await addTab(grace, room, { kind: "folder", title: "Mine" })).status).toBe(404);
    expect((await asking(grace, roomTabPath(room, tab.id), "DELETE")).status).toBe(404);
    expect((await api(roomTabsPath(room))).status).toBe(401);

    await asking(ada, "/api/files/marks", "PUT", { fileId: tab.id, roomId: room, starred: true });
    expect((await asking(ada, `/api/rooms/${room}`, "DELETE")).status).toBe(204);
    expect(await workspaceSql("SELECT id FROM room_tabs WHERE room_id = ?", room)).toEqual([]);
    expect(await workspaceSql("SELECT file_id FROM file_marks WHERE room_id = ?", room)).toEqual([]);
  });
});
