import { type ApiTokenCreated, type ApiTokens, type Me, type Message, type RoomId } from "@ember/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  shown,
  signIn,
  type Session,
  type Socket,
} from "./support";

// The MCP server at /mcp, and the personal access tokens it opens with, which the API tokens section
// of the profile makes. A token acts as its person, within their memberships and no further.

beforeEach(freshDeploy);

afterEach(() => vi.restoreAllMocks());

/** Makes one of `session`'s tokens through the settings route, answering its secret and id. */
async function tokenOf(session: Session, name = "My agent"): Promise<{ token: string; id: string }> {
  const response = await api("/api/account/tokens", { method: "POST", headers: { Cookie: session.cookie }, body: JSON.stringify({ name }) });
  expect(response.status, await response.clone().text()).toBe(201);
  const created = (await response.json()) as ApiTokenCreated;
  expect(created.token).toMatch(/^pat_/);
  return { token: created.token, id: created.id };
}

/** What POST /mcp answers for `body`, opened with `token`, or with none when it's null. */
const mcp = (token: string | null, body: unknown) => mcpRaw(token, JSON.stringify(body));

/** The same, with the request's body as it's sent, for one that isn't JSON at all. */
const mcpRaw = (token: string | null, body: string) =>
  api("/mcp", { method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body });

/** What a tools/call of the tool `name` answers, as its result or its error. */
async function toolOf(token: string, name: string, args: Record<string, unknown> = {}): Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string } }> {
  const response = await mcp(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  expect(response.status).toBe(200);
  return (await response.json()) as { result?: Record<string, unknown>; error?: { code: number; message: string } };
}

/** What a tool said, where the tool itself refused, as its one text. */
const said = ({ result }: { result?: Record<string, unknown> }): string => {
  const content = result!.content as Array<{ type: string; text: string }>;
  return content[0]!.text;
};

/** The initialize the server answers a token with. */
const initialize = (token: string) => mcp(token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "test", version: "1" } } });

/** Waits until room `room` has nothing left in its log for the search index, which it forgets once the index has taken it. */
async function caughtUp(room: RoomId): Promise<void> {
  while ((await roomSql(room, "SELECT seq FROM unindexed_messages WHERE room_id = ?", room)).length > 0) await new Promise((resolve) => setTimeout(resolve, 5));
}

/** Posts `body` in the thread of `parentId`, as a reply that isn't also sent to the room, and waits for it. */
async function postReply(client: Socket, body: string, parentId: string): Promise<Message> {
  const clientMessageId = crypto.randomUUID();
  client.send({ type: "message.create", clientMessageId, body, parentId });
  for (;;) {
    const { message } = await client.next("message.created");
    if (message.clientMessageId === clientMessageId) return message;
  }
}

describe("Personal access tokens", () => {
  it("are made with a name, shown once, listed without their secret, and used", async () => {
    const ada = await signIn("Ada");
    const { token, id } = await tokenOf(ada, "Deploy bot");

    const listed = await api("/api/account/tokens", { headers: { Cookie: ada.cookie } });
    expect(listed.status).toBe(200);
    const { tokens } = (await listed.json()) as ApiTokens;
    expect(tokens).toEqual([{ id, name: "Deploy bot", createdAt: expect.any(Number), lastUsedAt: null, revokedAt: null }]);

    const rooms = await freshRoom("used-here");
    const response = await toolOf(token, "list_rooms");
    expect(response.result).toEqual({ rooms: [expect.objectContaining({ id: rooms })] });
    // Using it kept when it was last used.
    const after = (await (await api("/api/account/tokens", { headers: { Cookie: ada.cookie } })).json()) as ApiTokens;
    expect(after.tokens[0]!.lastUsedAt).not.toBeNull();
  });

  it("are revoked, which stops the next request with them, and 404 for one that was never theirs", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const { token, id } = await tokenOf(ada);
    expect(await toolOf(token, "list_rooms").then(({ result }) => result)).toBeDefined();

    const revoked = await api(`/api/account/tokens/${id}`, { method: "DELETE", headers: { Cookie: ada.cookie } });
    expect(revoked.status).toBe(204);
    const refused = await mcp(token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(refused.status).toBe(401);

    const someoneElses = await api(`/api/account/tokens/${id}`, { method: "DELETE", headers: { Cookie: grace.cookie } });
    expect(someoneElses.status).toBe(404);
  });

  it("are refused past ten failed tries from the one address, as sign-in is", async () => {
    for (const n of [...Array(10).keys()]) {
      const attempt = await mcp(`pat_wrong${n}`, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(attempt.status, `try ${n}`).toBe(401);
    }
    const limited = await mcp("pat_wrong-once-more", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(limited.status).toBe(429);
  });
});

describe("The MCP server", () => {
  it("answers initialize with a revision it speaks, and lists its tools", async () => {
    const ada = await signIn("Ada");
    const { token } = await tokenOf(ada);
    const response = await initialize(token);
    expect(response.status).toBe(200);
    const { result } = (await response.json()) as { result: Record<string, unknown> };
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.serverInfo).toMatchObject({ name: "ember", title: "Ember" });
    const listed = await mcp(token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const { tools } = ((await listed.json()) as { result: { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> } }).result;
    expect(tools.map(({ name }) => name)).toEqual(["list_rooms", "get_room_history", "search_messages", "get_thread", "get_people", "post_message"]);
    for (const tool of tools) expect(tool.inputSchema.type).toBe("object");
    // A client asking for a revision this server doesn't speak hears the newest one it does.
    const other = await mcp(token, { jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(((await other.json()) as { result: Record<string, unknown> }).result.protocolVersion).toBe("2025-06-18");
  });

  it("refuses a request with no token, an unknown one, and a malformed body, and answers GET with 405 and a notification with nothing", async () => {
    await signIn("Ada");
    expect((await mcp(null, { jsonrpc: "2.0", id: 1, method: "initialize" })).status).toBe(401);
    expect((await mcp("pat_nobody", { jsonrpc: "2.0", id: 1, method: "initialize" })).status).toBe(401);
    // Who's asking comes first, so a body nobody could read answers 401 without a token, and 400 with one.
    expect((await mcpRaw(null, "not JSON")).status).toBe(401);
    const { token } = await tokenOf(await signIn("Grace"));
    expect((await mcpRaw(token, "not JSON")).status).toBe(400);
    expect((await api("/mcp", { method: "GET" })).status).toBe(405);
    const notification = await mcp(token, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe("");
    const ping = await mcp(token, { jsonrpc: "2.0", id: 3, method: "ping" });
    expect(((await ping.json()) as { result: Record<string, unknown> }).result).toEqual({});
  });

  it("refuses a method and a tool it doesn't have", async () => {
    const { token } = await tokenOf(await signIn("Ada"));
    const method = await mcp(token, { jsonrpc: "2.0", id: 1, method: "resources/list" });
    expect(((await method.json()) as { error: { code: number } }).error.code).toBe(-32601);
    const tool = await toolOf(token, "delete_workspace");
    expect(tool.error!.code).toBe(-32601);
  });

  it("lists the rooms its person is in, and neither a room they're not in nor a DM they're out of", async () => {
    const host = await signIn("Host");
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const shared = await freshRoom("shared");
    const secret = await createRoom("secret", { closedTo: [ada.user.id], as: host });
    await direct(host, ada);
    const { token } = await tokenOf(grace);
    const { result } = await toolOf(token, "list_rooms");
    const listed = result!.rooms as Array<{ id: string; kind: string; name: string; unread: boolean }>;
    expect(listed.map(({ id }) => id)).not.toContain(secret.id);
    expect(listed.filter(({ id }) => id === shared)).toHaveLength(1);
    // Every room it names is one its person can open.
    for (const room of listed) expect(room.id).not.toBe(secret.id);
  });

  it("reads a room's history oldest first, with permalinks, and pages from a message", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const room = await freshRoom("history");
    const client = await connect(room, ada);
    const first = await post(client, "first message");
    const second = await post(client, "second message");
    const { token } = await tokenOf(grace);

    const { result } = await toolOf(token, "get_room_history", { room_id: room });
    const messages = result!.messages as Array<{ id: string; author: { id: string; name: string }; plain_text: string; permalink: string }>;
    expect(messages.map(({ id, plain_text }) => ({ id, plain_text }))).toEqual([
      { id: first.id, plain_text: "first message" },
      { id: second.id, plain_text: "second message" },
    ]);
    expect(messages[0]!.author).toEqual(shown(ada.user));
    expect(messages[0]!.permalink).toBe(`https://ember.test/rooms/${room}/@${first.id}`);
    expect(result!.hasMore).toBe(false);

    // One more before the first, so the page from it can be asked for.
    const newer = await post(client, "newest message");
    const paged = await toolOf(token, "get_room_history", { room_id: room, after: first.id, limit: 2 });
    const newerMessages = paged.result!.messages as Array<{ id: string }>;
    expect(newerMessages.map(({ id }) => id)).toEqual([second.id, newer.id]);
    expect(paged.result!.hasNewer).toBe(false);
  });

  it("reads a thread a message has, parent first", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const room = await freshRoom("threaded");
    const client = await connect(room, ada);
    const parent = await post(client, "a question");
    const reply = await postReply(client, "an answer", parent.id);
    const { token } = await tokenOf(grace);
    const { result } = await toolOf(token, "get_thread", { room_id: room, message_id: parent.id });
    expect((result!.parent as { id: string }).id).toBe(parent.id);
    expect((result!.replies as Array<{ id: string; thread_id: string }>).map(({ id, thread_id }) => ({ id, thread_id }))).toEqual([
      { id: reply.id, thread_id: parent.id },
    ]);
    // A reply has no thread of its own.
    const replyThread = await toolOf(token, "get_thread", { room_id: room, message_id: reply.id });
    expect(said(replyThread as never)).toBe("Room not found or inaccessible");
  });

  it("refuses the history, thread and posting of a room its person isn't in, saying only that it can't be found", async () => {
    const host = await signIn("Host");
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const secret = await createRoom("secret", { closedTo: [ada.user.id], as: host });
    const client = await connect(secret.id, ada);
    await post(client, "hidden from Grace");
    await direct(host, ada);
    const { token } = await tokenOf(grace);
    for (const tool of [["get_room_history", { room_id: secret.id }], ["get_thread", { room_id: secret.id, message_id: "whatever" }], ["post_message", { room_id: secret.id, body: "let me in" }]]) {
      const [name, args] = tool as [string, Record<string, unknown>];
      const refused = await toolOf(token, name, args);
      expect(said(refused as never), `${name}`).toBe("Room not found or inaccessible");
      expect(refused.result!.isError).toBe(true);
    }
    // The DM is just as far.
    const dm = (await direct(host, ada)).id;
    expect(said((await toolOf(token, "get_room_history", { room_id: dm })) as never)).toBe("Room not found or inaccessible");
  });

  it("searches the rooms its person is in, and only those", async () => {
    const host = await signIn("Host");
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const shared = await freshRoom("searched");
    const secret = await createRoom("secrets", { closedTo: [ada.user.id], as: host });
    const inShared = await connect(shared, ada);
    const inSecret = await connect(secret.id, ada);
    await post(inShared, "My hovercraft is full of eels");
    await post(inSecret, "the sycamore is where we hide");
    await caughtUp(shared);
    await caughtUp(secret.id);
    const { token } = await tokenOf(grace);

    const found = await toolOf(token, "search_messages", { query: "hovercraft" });
    const matches = found.result!.matches as Array<{ message: { plain_text: string } }>;
    expect(matches.map(({ message }) => message.plain_text)).toEqual(["My hovercraft is full of eels"]);

    const nothing = await toolOf(token, "search_messages", { query: "sycamore" });
    expect(nothing.result!.matches).toEqual([]);

    // Keeping to a room they're in narrows the search; one they're not in refuses.
    const inRoom = await toolOf(token, "search_messages", { query: "hovercraft", room_id: shared });
    expect(((inRoom.result!.matches as unknown[])!).length).toBe(1);
    const elsewhere = await toolOf(token, "search_messages", { query: "hovercraft", room_id: secret.id });
    expect(said(elsewhere as never)).toBe("Room not found or inaccessible");
  });

  it("posts as its person, in a room they're in, even in a thread, and not in one they're not", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const room = await freshRoom("posted-in");
    const client = await connect(room, ada);
    const parent = await post(client, "what should we build?");
    const { token } = await tokenOf(grace);

    const posted = await toolOf(token, "post_message", { room_id: room, body: "a treehouse" });
    const message = posted.result!.message as { id: string; author: { id: string }; plain_text: string; permalink: string };
    expect(message.author).toEqual(shown(grace.user));
    expect(message.plain_text).toBe("a treehouse");
    expect(message.permalink).toBe(`https://ember.test/rooms/${room}/@${message.id}`);

    const replied = await toolOf(token, "post_message", { room_id: room, body: "with a rope ladder", thread_id: parent.id });
    expect(((replied.result!.message as { thread_id: string }).thread_id)).toBe(parent.id);

    // What it posted is there for the room, as a reply in the thread.
    const thread = await toolOf(token, "get_thread", { room_id: room, message_id: parent.id });
    expect((thread.result!.replies as Array<{ plain_text: string }>).map(({ plain_text }) => plain_text)).toEqual(["with a rope ladder"]);

    const secret = await createRoom("secret", { closedTo: [ada.user.id], as: ada });
    const refused = await toolOf(token, "post_message", { room_id: secret.id, body: "not allowed" });
    expect(said(refused as never)).toBe("Room not found or inaccessible");
  });

  it("refuses a message with nothing in it, and one too long, as the composer's path does", async () => {
    const grace = await signIn("Grace");
    const room = await freshRoom("bodies");
    const { token } = await tokenOf(grace);
    expect(said((await toolOf(token, "post_message", { room_id: room, body: "   " })) as never)).toBe("Your message is empty.");
    // More plain text than a message can have, which the room itself refuses.
    const tooLong = await toolOf(token, "post_message", { room_id: room, body: "x".repeat(10_001) });
    expect(said(tooLong as never)).toContain("up to");
    // More markup than the tool takes at all, refused before a room is asked.
    const absurd = await toolOf(token, "post_message", { room_id: room, body: "x".repeat(100_001) });
    expect(absurd.error!.code).toBe(-32602);
  });

  it("shows the people directory, without anyone's email address", async () => {
    await signIn("Host");
    await signIn("Ada");
    const grace = await signIn("Grace");
    const { token } = await tokenOf(grace);
    const { result } = await toolOf(token, "get_people");
    const people = result!.people as Array<Record<string, unknown>>;
    expect(people.map(({ name }) => name).sort()).toEqual(["Ada", "Grace", "Host"]);
    for (const person of people) expect(Object.keys(person).sort()).toEqual(["id", "name", "role", "status"]);
  });
});
