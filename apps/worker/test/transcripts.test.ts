import {
  TRANSCRIPT_FORMAT_REFUSED,
  type Message,
  type NewWorkspace,
  type RoomTranscript,
  type Sidebar,
  type WorkspaceTranscript,
} from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { TRANSCRIPT_PAGE } from "../src/store";
import {
  api,
  connect,
  cookieOf,
  createRoom,
  direct,
  freshDeploy,
  freshRoom,
  post,
  roomSql,
  roomStub,
  shown,
  signIn,
  type Session,
  type Socket,
} from "./support";

beforeEach(freshDeploy);

const withCookie = (cookie: string) => ({ headers: { Cookie: cookie } });

/** `GET /api/rooms/<id>/transcript` as `session`, or unsigned in. */
const roomTranscript = (session: Session | null, roomId: string, format?: string) =>
  api(`/api/rooms/${roomId}/transcript${format === undefined ? "" : `?format=${format}`}`, session ? withCookie(session.cookie) : {});

/** `GET /api/transcripts` as `session`, or unsigned in. */
const allTranscripts = (session: Session | null, format?: string) =>
  api(`/api/transcripts${format === undefined ? "" : `?format=${format}`}`, session ? withCookie(session.cookie) : {});

/** A reply in `parent`'s thread as `client`, sent only there unless `alsoSend`. */
async function reply(client: Socket, parent: Pick<Message, "id">, body: string, alsoSend = false): Promise<Message> {
  const clientMessageId = crypto.randomUUID();
  client.send({ type: "message.create", clientMessageId, body, parentId: parent.id, alsoSend });
  for (;;) {
    const { message } = await client.next("message.created");
    if (message.clientMessageId === clientMessageId) return message;
  }
}

/** Ada as the first administrator, with the rooms first-run makes. */
async function administrator(): Promise<Session> {
  const response = await api("/api/first_run", {
    method: "POST",
    body: JSON.stringify({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" }),
  });
  expect(response.status).toBe(201);
  const { user } = (await response.json()) as NewWorkspace;
  return { user: shown(user), cookie: cookieOf(response) };
}

describe("Who may download a transcript", () => {
  it("answers 401 without a session, for a room and for every conversation", async () => {
    const room = await freshRoom("lobby");
    expect((await roomTranscript(null, room)).status).toBe(401);
    expect((await allTranscripts(null)).status).toBe(401);
    expect(await (await roomTranscript(null, room)).json()).toEqual({ error: "Not signed in" });
  });

  it("answers 401 for a session that isn't one", async () => {
    const room = await freshRoom("lobby");
    const forged = { user: { id: "nope", name: "Nope" }, cookie: "__Host-session_token=forged" };
    expect((await roomTranscript(forged, room)).status).toBe(401);
    expect((await allTranscripts(forged)).status).toBe(401);
  });

  it("answers 404 for a room someone isn't in, without its messages", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = await createRoom("Leads", { closedTo: [ada.user.id], as: ada });
    const adaClient = await connect(room.id, ada);
    await post(adaClient, "Only Ada should read this");

    const response = await roomTranscript(grace, room.id, "json");
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "Room not found or inaccessible" });
    expect(body).not.toContain("Only Ada should read this");
  });

  it("answers 404 for a room that isn't there, and for an id that can't be a room's", async () => {
    const ada = await signIn("Ada");
    expect((await roomTranscript(ada, "zzzzzzzzzzzzzzzz")).status).toBe(404);
    expect((await roomTranscript(ada, "not a room")).status).toBe(404);
    expect((await roomTranscript(ada, "A".repeat(20))).status).toBe(404);
  });

  it("lets a member download a private room they're in", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Leads", { closedTo: [ada.user.id], as: ada });
    await post(await connect(room.id, ada), "Leads only");
    const response = await roomTranscript(ada, room.id, "json");
    expect(response.status).toBe(200);
    const body = (await response.json()) as RoomTranscript;
    expect(body.messages.map((message) => message.text)).toEqual(["Leads only"]);
  });
});

describe("A room's transcript", () => {
  it("writes an empty room as Markdown with its name and no messages", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Quiet", { as: ada });
    const response = await roomTranscript(ada, room.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("Content-Disposition")).toContain("Quiet.md");
    const text = await response.text();
    expect(text).toMatch(/^# Quiet\n\nExported .+\n$/);
    expect(text).not.toContain("**");
  });

  it("writes JSON with the room, authors, times, plain text, markup, and no messages when there are none", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Quiet", { as: ada });
    const response = await roomTranscript(ada, room.id, "json");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain("Quiet.json");
    const body = (await response.json()) as RoomTranscript;
    expect(body.room).toEqual({ id: room.id, name: "Quiet", kind: "open" });
    expect(body.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.messages).toEqual([]);
  });

  it("includes every message, oldest first, with its author, time, text and markup", async () => {
    const room = await freshRoom("chat");
    const ada = await connect(room, "Ada");
    const first = await post(ada, "<p>Hello</p>");
    const second = await post(ada, "<p>Later</p>");
    const body = (await (await roomTranscript(ada.session, room, "json")).json()) as RoomTranscript;
    expect(body.messages.map((message) => message.id)).toEqual([first.id, second.id]);
    expect(body.messages[0]).toMatchObject({
      id: first.id,
      author: ada.me,
      createdAt: first.createdAt,
      text: "Hello",
      body: "<p>Hello</p>",
    });
  });

  it("puts thread replies with their parent, including replies sent only to the thread", async () => {
    const room = await freshRoom("threads");
    const ada = await connect(room, "Ada");
    const parent = await post(ada, "<p>Shall we ship it?</p>");
    const onlyThere = await reply(ada, parent, "<p>Yes</p>");
    const alsoRoom = await reply(ada, parent, "<p>And tell the room</p>", true);
    const later = await post(ada, "<p>Shipped.</p>");

    const json = (await (await roomTranscript(ada.session, room, "json")).json()) as RoomTranscript;
    expect(json.messages.map((message) => message.id)).toEqual([parent.id, onlyThere.id, alsoRoom.id, later.id]);
    expect(json.messages[1]).toMatchObject({ id: onlyThere.id, parentId: parent.id, alsoSent: false, text: "Yes" });
    expect(json.messages[2]).toMatchObject({ id: alsoRoom.id, parentId: parent.id, alsoSent: true, text: "And tell the room" });

    const markdown = await (await roomTranscript(ada.session, room)).text();
    expect(markdown.indexOf("Shall we ship it?")).toBeLessThan(markdown.indexOf("Yes"));
    expect(markdown.indexOf("Yes")).toBeLessThan(markdown.indexOf("And tell the room"));
    expect(markdown.indexOf("And tell the room")).toBeLessThan(markdown.indexOf("Shipped."));
    expect(markdown).toContain("> **Ada** ·");
    expect(markdown).toMatch(/^> Yes$/m);
    expect(markdown.match(/And tell the room/g)).toHaveLength(1);
  });

  it("includes a deleted parent kept for its replies", async () => {
    const room = await freshRoom("kept");
    const ada = await connect(room, "Ada");
    const parent = await post(ada, "<p>Original</p>");
    await reply(ada, parent, "<p>Still here</p>");
    ada.send({ type: "message.delete", messageId: parent.id });
    await ada.next("message.updated");

    const json = (await (await roomTranscript(ada.session, room, "json")).json()) as RoomTranscript;
    expect(json.messages[0]).toMatchObject({ id: parent.id, deleted: true, text: "" });
    expect(json.messages[1]).toMatchObject({ text: "Still here", parentId: parent.id });
    expect(await (await roomTranscript(ada.session, room)).text()).toContain("_Deleted._");
  });

  it("includes every message past one page, in order", async () => {
    const room = await freshRoom("long");
    const ada = await signIn("Ada");
    await connect(room, ada);
    const count = TRANSCRIPT_PAGE + 5;
    for (let i = 0; i < count; i++) {
      const id = `m${String(i).padStart(4, "0")}`;
      await roomSql(
        room,
        `INSERT INTO messages (id, room_id, client_message_id, creator_id, creator_name, body, plain_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Ada', '<p>n</p>', ?, '2026-11-13T12:00:00.000Z', '2026-11-13T12:00:00.000Z')`,
        id,
        room,
        id,
        ada.user.id,
        `message ${i}`,
      );
    }
    const json = (await (await roomTranscript(ada, room, "json")).json()) as RoomTranscript;
    expect(json.messages).toHaveLength(count);
    expect(json.messages[0]!.text).toBe("message 0");
    expect(json.messages.at(-1)!.text).toBe(`message ${count - 1}`);
    expect(await (await roomTranscript(ada, room)).text()).toContain(`message ${count - 1}`);
  });

  it("reads a room longer than one page a page at a time, and the download is complete", async () => {
    const room = await freshRoom("paged");
    const ada = await signIn("Ada");
    await connect(room, ada);
    const count = TRANSCRIPT_PAGE + 5;
    for (let i = 0; i < count; i++) {
      const id = `p${String(i).padStart(4, "0")}`;
      await roomSql(
        room,
        `INSERT INTO messages (id, room_id, client_message_id, creator_id, creator_name, body, plain_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Ada', '<p>n</p>', ?, '2026-11-13T12:00:00.000Z', '2026-11-13T12:00:00.000Z')`,
        id,
        room,
        id,
        ada.user.id,
        `page ${i}`,
      );
    }
    const first = await roomStub(room).transcriptPage(room);
    expect(first.messages.length).toBeLessThanOrEqual(TRANSCRIPT_PAGE);
    expect(first.messages).toHaveLength(TRANSCRIPT_PAGE);
    expect(first.after).toBe(first.messages.at(-1)!.id);
    const second = await roomStub(room).transcriptPage(room, first.after);
    expect(second.messages).toHaveLength(5);
    expect(second.after).toBeUndefined();
    expect(second.messages.at(-1)!.text).toBe("page 104");
    expect(JSON.stringify(first).length).toBeLessThan(JSON.stringify([...first.messages, ...second.messages]).length);

    const json = (await (await roomTranscript(ada, room, "json")).json()) as RoomTranscript;
    expect(json.messages).toHaveLength(count);
    expect(json.messages.map((message) => message.text)).toEqual([...first.messages, ...second.messages].map((message) => message.text));
    expect(await (await roomTranscript(ada, room)).text()).toContain("page 104");
  });

  it("writes a live image-only message as an image, not as deleted, without its file's address", async () => {
    const room = await freshRoom("photos");
    const ada = await signIn("Ada");
    await connect(room, ada);
    await roomSql(
      room,
      `INSERT INTO messages (id, room_id, client_message_id, creator_id, creator_name, body, plain_text, created_at, updated_at, attachment)
       VALUES ('m1-img', ?, 'm1-img', ?, 'Ada', '', '', '2026-11-13T12:00:00.000Z', '2026-11-13T12:00:00.000Z', ?)`,
      room,
      ada.user.id,
      JSON.stringify({ id: "secret-file-key", name: "photo.png", contentType: "image/png", byteSize: 12, url: "/files/secret-file-key", downloadUrl: "/files/secret-file-key?download=1" }),
    );
    await roomSql(
      room,
      `INSERT INTO messages (id, room_id, client_message_id, creator_id, creator_name, body, plain_text, created_at, updated_at, deleted)
       VALUES ('m2-gone', ?, 'm2-gone', ?, 'Ada', '', '', '2026-11-13T12:00:01.000Z', '2026-11-13T12:00:01.000Z', 1)`,
      room,
      ada.user.id,
    );

    const json = (await (await roomTranscript(ada, room, "json")).json()) as RoomTranscript;
    expect(json.messages[0]).toMatchObject({ id: "m1-img", text: "", attachment: "image" });
    expect(json.messages[0]!.deleted).toBeUndefined();
    expect(json.messages[1]).toMatchObject({ id: "m2-gone", deleted: true, text: "" });
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain("secret-file-key");
    expect(serialized).not.toContain("downloadUrl");
    expect(serialized).not.toContain("/files/");

    const markdown = await (await roomTranscript(ada, room)).text();
    expect(markdown).toContain("_Image._");
    expect(markdown).toContain("_Deleted._");
    expect(markdown.indexOf("_Image._")).toBeLessThan(markdown.indexOf("_Deleted._"));
    expect(markdown).not.toContain("secret-file-key");
  });

  it("refuses a format that isn't Markdown or JSON", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const response = await roomTranscript(ada, room, "csv");
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: TRANSCRIPT_FORMAT_REFUSED });
  });

  it("names a DM for the other person, and leaves join codes out of an administrator's export", async () => {
    const ada = await administrator();
    const grace = await signIn("Grace");
    const ping = await direct(ada, grace);
    await post(await connect(ping.id, ada), "<p>Hello Grace</p>");

    const json = (await (await roomTranscript(ada, ping.id, "json")).json()) as RoomTranscript;
    expect(json.room).toEqual({ id: ping.id, name: "Grace", kind: "direct" });
    expect(json.messages[0]!.text).toBe("Hello Grace");

    const sidebar = (await (await api("/api/sidebar", withCookie(ada.cookie))).json()) as Sidebar;
    const joinCode = sidebar.invitation?.joinCode;
    expect(joinCode).toBeTruthy();
    const markdown = await (await roomTranscript(ada, ping.id)).text();
    expect(markdown).not.toContain(joinCode);
    expect(JSON.stringify(json)).not.toContain(joinCode);
  });
});

describe("Every conversation", () => {
  it("writes only the rooms the caller is in, never another private room's messages", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const leads = await createRoom("Leads", { closedTo: [ada.user.id], as: ada });
    const lobby = await createRoom("Lobby");
    await post(await connect(leads.id, ada), "Ada's secret");
    await post(await connect(lobby.id, grace), "In the lobby");

    const graceJson = (await (await allTranscripts(grace, "json")).json()) as WorkspaceTranscript;
    expect(graceJson.rooms.map((room) => room.room.name)).toEqual(["Lobby"]);
    expect(JSON.stringify(graceJson)).not.toContain("Ada's secret");
    expect(JSON.stringify(graceJson)).toContain("In the lobby");
    expect(JSON.stringify(graceJson)).not.toContain("Leads");

    const adaJson = (await (await allTranscripts(ada, "json")).json()) as WorkspaceTranscript;
    expect(adaJson.rooms.map((room) => room.room.name).sort()).toEqual(["Leads", "Lobby"]);
    expect(JSON.stringify(adaJson)).toContain("Ada's secret");
    expect(JSON.stringify(adaJson)).toContain("In the lobby");

    const markdown = await (await allTranscripts(grace)).text();
    expect(markdown).toMatch(/^# Your conversations\n/);
    expect(markdown).toContain("# Lobby");
    expect(markdown).not.toContain("# Leads");
    expect(markdown).not.toContain("Ada's secret");
  });

  it("writes an empty file when the caller is in no rooms yet", async () => {
    const ada = await signIn("Ada");
    const json = (await (await allTranscripts(ada, "json")).json()) as WorkspaceTranscript;
    expect(json.rooms).toEqual([]);
    expect(await (await allTranscripts(ada)).text()).toMatch(/^# Your conversations\n\nExported .+\n$/);
  });

  it("answers 401 unsigned in and 422 for a format that isn't Markdown or JSON", async () => {
    expect((await allTranscripts(null, "json")).status).toBe(401);
    const ada = await signIn("Ada");
    const response = await allTranscripts(ada, "csv");
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: TRANSCRIPT_FORMAT_REFUSED });
  });
});
