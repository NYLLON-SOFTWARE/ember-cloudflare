import { ASSISTANT_ID, type Card, type Me, type Message, type NewWorkspace, type RoomId, type User } from "@ember/protocol";
import { CALL_ACTIONS, type AgentTools, type App, type AppAnswer, type CallDecision, type ToolPick } from "@ember/protocol/apps";
import { MENTION_CONTENT_TYPE, mentionSgid } from "@ember/richtext";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RESULT_LENGTH } from "../src/apps/mcp";
import { CALL_OUTCOMES, MAX_SHOWN_INPUT_LENGTH, TOO_LONG_TO_SHOW } from "../src/apps/tools";
import { CALL_WAITS_MS } from "../src/apps/waiting-calls";
import { CALL_DECLINED } from "../src/assistant/tool-calls";
import { api, connect, cookieOf, freshDeploy, post, roomSql, roomStub, shown, workspaceSql, type Client, type Session } from "./support";

// Calls of connected apps' tools: @ember or an agent calls one picked for it, the room asks first on a
// card, and the call runs, and the answer goes on, once whoever asked or an administrator allows it. A
// fake MCP server and a fake AI Gateway stand behind `fetch`.

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const API_TOKEN = "an-api-token-with-ai-gateway-run_0123456";
const [CLAUDE, OPUS] = ["anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5"];
const EMBER = { id: ASSISTANT_ID };
const MCP = "http://localhost:3845/mcp";
const MCP_TOKEN = "tracker-secret-token";

const CREATE_ISSUE = { name: "create_issue", title: "Create issue", description: "Opens an issue.", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } };
const SEARCH_ISSUES = { name: "search_issues", description: "Finds issues.", inputSchema: { type: "object" } };

/** A JSON-RPC message the fake MCP server was sent, with the token it came with. */
interface Rpc {
  id?: number;
  method: string;
  params?: { protocolVersion?: string; name?: string; arguments?: unknown };
  authorization: string | null;
}

/** A request the fake AI Gateway was sent that gave its model tools. */
type Asked = Record<string, unknown> & { model: string; tools: Array<{ name: string; description: string; input_schema: unknown }>; messages: Array<{ role: string; content: unknown }> };

/** What the model does in a turn: calls tools, each by the name it was given it by, or answers. */
type Turn = { calls: Array<{ name: string; input: unknown }> } | { text: string };

let rpcs: Rpc[];
let asked: Asked[];
let script: Turn[];
/** The tools the fake server lists, the token it takes, and what it answers a call with: a result, or the error it refuses it with. */
let server: { tools: unknown[]; token: string; result: (call: Rpc) => unknown; refuses?: string };

/** The fake server's answer to `message`. */
function answerTo(message: Rpc): Response {
  const result = (result: unknown) => Response.json({ jsonrpc: "2.0", id: message.id, result });
  if (message.method === "initialize") return result({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "Tracker", version: "1.2.3" } });
  if (message.method === "tools/list") return result({ tools: server.tools });
  if (message.method === "tools/call" && server.refuses) return Response.json({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: server.refuses } });
  if (message.method === "tools/call") return result(server.result(message));
  return message.id === undefined ? new Response(null, { status: 202 }) : Response.json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
}

/** What Claude sends back for `turn`, the `nth` the model was asked for. */
function turnIn(turn: Turn, nth: number): Response {
  const content = "text" in turn ? [{ type: "text", text: turn.text }] : turn.calls.map(({ name, input }, index) => ({ type: "tool_use", id: `call_${nth}_${index}`, name, input }));
  return Response.json({ type: "message", role: "assistant", content, stop_reason: "text" in turn ? "end_turn" : "tool_use", usage: { input_tokens: 1_000, output_tokens: 50 } });
}

beforeEach(async () => {
  await freshDeploy();
  rpcs = [];
  asked = [];
  script = [];
  server = { tools: [CREATE_ISSUE, SEARCH_ISSUES], token: MCP_TOKEN, result: () => ({ content: [{ type: "text", text: "Opened #12." }] }) };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).hostname !== "localhost") {
      const body = (await request.json()) as Asked;
      if (!body.tools) return turnIn({ text: "Hello!" }, 0);
      asked.push(body);
      return turnIn(script.shift() ?? { text: "Hello, team!" }, asked.length);
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const message = { ...((await request.json()) as Rpc), authorization: request.headers.get("Authorization") };
    rpcs.push(message);
    return message.authorization === `Bearer ${server.token}` ? answerTo(message) : new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  });
});
afterEach(() => vi.restoreAllMocks());

const as = (session: Session) => ({ Cookie: session.cookie });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The tools picked for @ember, by their names, as its page offers them now. */
async function pick(administrator: Session, ...names: string[]): Promise<void> {
  const { apps } = (await (await api(`/api/account/agents/${ASSISTANT_ID}/tools`, { headers: as(administrator) })).json()) as AgentTools;
  const tools = apps.flatMap(({ id, tools }) => tools.filter(({ name }) => names.includes(name)).map(({ name, fingerprint }): ToolPick => ({ appId: id, name, fingerprint })));
  const picked = await api(`/api/account/agents/${ASSISTANT_ID}/tools`, { method: "PUT", headers: as(administrator), body: JSON.stringify({ tools }) });
  expect(picked.status, await picked.clone().text()).toBe(200);
}

/**
 * Sets Ember up with Ada as its administrator and Ember AI answering with Claude, Tracker connected,
 * and its create_issue picked for @ember, answering her session, the app, the general room, and her there.
 */
async function setUp(): Promise<{ ada: Session; tracker: App; general: RoomId; inGeneral: Client }> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" }) });
  expect(response.status).toBe(201);
  const ada = { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
  const [{ id: general }] = (await workspaceSql("SELECT id FROM rooms WHERE name = 'general'")) as [{ id: RoomId }];
  const on = await api("/api/account/assistant", { method: "PUT", headers: as(ada), body: JSON.stringify({ accountId: ACCOUNT_ID, apiToken: API_TOKEN, model: CLAUDE }) });
  expect(on.status, await on.clone().text()).toBe(200);
  const connected = await api("/api/account/apps", { method: "POST", headers: as(ada), body: JSON.stringify({ name: "Tracker", url: MCP, token: MCP_TOKEN }) });
  expect(connected.status, await connected.clone().text()).toBe(201);
  const { app: tracker } = (await connected.json()) as AppAnswer;
  await pick(ada, "create_issue");
  rpcs.length = 0;
  return { ada, tracker, general, inGeneral: await connect(general, ada) };
}

/** Someone joins with the join link, as a member, signed in. */
async function join(name: string): Promise<Session> {
  const [{ join_code: joinCode }] = (await workspaceSql("SELECT join_code FROM accounts")) as [{ join_code: string }];
  const response = await api(`/api/join/${joinCode}`, { method: "POST", body: JSON.stringify({ name, emailAddress: `${name.split(" ")[0]!.toLowerCase()}@example.com`, password: "nanoseconds" }) });
  expect(response.status, await response.clone().text()).toBe(201);
  return { user: shown(((await response.json()) as { user: Me }).user), cookie: cookieOf(response) };
}

/** Asks @ember `question` in the room `client` is in, answering what it posts next: its answer, or the card for a call. */
async function ask(client: Client, question = "open an issue for the login bug"): Promise<Message> {
  const mention = `<action-text-attachment sgid="${mentionSgid(EMBER.id)}" content-type="${MENTION_CONTENT_TYPE}"></action-text-attachment>`;
  await post(client, `<p>${mention} ${question}</p>`);
  return fromEmber(client);
}

/** The next message @ember posts in the room `client` is in. */
async function fromEmber(client: Client): Promise<Message> {
  for (;;) {
    const { message } = await client.next("message.created");
    if (message.creator.id === EMBER.id) return message;
  }
}

/** Clicks the button of `card` that answers its call with `decision`, as `client`, answering the click's id. */
function click(client: Client, card: Pick<Message, "id">, decision: CallDecision): string {
  const clickId = crypto.randomUUID();
  client.send({ type: "card.click", clickId, messageId: card.id, actionId: CALL_ACTIONS[decision], blockId: "ember.call" });
  return clickId;
}

/** The card `client` hears has changed, once it has. */
async function changed(client: Client, card: Pick<Message, "id">): Promise<Message> {
  for (;;) {
    const { message } = await client.next("message.updated");
    if (message.id === card.id) return message;
  }
}

const CALL: Turn = { calls: [{ name: "Tracker__create_issue", input: { title: "Login fails" } }] };
const buttonsOf = (cards: Card[] | undefined) => (cards ?? []).flatMap(({ parts }) => parts).flatMap((part) => (part.kind === "buttons" ? part.buttons : []));
const waiting = (room: RoomId) => roomSql(room, "SELECT message_id FROM waiting_calls WHERE room_id = ?", room);
const calls = () => rpcs.filter(({ method }) => method === "tools/call");
/** What the model was told each call of its last round came to. */
const told = () => (asked.at(-1)!.messages.at(-1)!.content as Array<{ tool_use_id: string; content: string; is_error?: boolean }>).map(({ content, is_error }) => [content, is_error === true]);

describe("A call of a connected app's tool", () => {
  it("waits on a card in the room, and runs once whoever asked allows it, with what the model called it with, and the answer goes on", async () => {
    const { general, inGeneral, ada } = await setUp();
    script = [CALL, { text: "I opened #12 for it." }];

    const card = await ask(inGeneral);
    expect(card.plainText).toBe(
      ["Ember wants to use Tracker", 'create_issue, with:\n{\n  "title": "Login fails"\n}', "Ada Lovelace or an administrator can allow this call. It goes to Tracker with the token an administrator connected it with.", "Allow once · Deny"].join("\n"),
    );
    expect(buttonsOf(card.cards)).toEqual([
      { text: "Allow once", action: { id: CALL_ACTIONS.allow, blockId: "ember.call" }, style: "primary" },
      { text: "Deny", action: { id: CALL_ACTIONS.deny, blockId: "ember.call" } },
    ]);
    // The model was given the picked tool alone of the app's, beside the room's search, by its app's name and its own.
    expect(asked[0]!.tools.map(({ name }) => name)).toEqual(["search_messages", "Tracker__create_issue"]);
    const [, given] = asked[0]!.tools;
    expect(given!.description).toBe(
      [
        "A tool of Tracker, an app this workspace's administrators connected. Each call waits until the person you're answering allows it, so call it only when they asked for what it does, with what they'd expect.",
        "Tracker calls it: Create issue",
        "Tracker describes it: Opens an issue.",
      ].join("\n"),
    );
    expect(given!.input_schema).toEqual(CREATE_ISSUE.inputSchema);
    // Nothing has reached the app, and the model isn't asked on.
    expect(rpcs).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(await waiting(general)).toEqual([{ message_id: card.id }]);

    const clickId = click(inGeneral, card, "allow");
    const allowed = await changed(inGeneral, card);
    expect(buttonsOf(allowed.cards)).toEqual([]);
    expect(allowed.plainText).toBe(["Ember wants to use Tracker", 'create_issue, with:\n{\n  "title": "Login fails"\n}', CALL_OUTCOMES.allow(ada.user.name)].join("\n"));
    expect(await inGeneral.next("card.clicked")).toEqual({ type: "card.clicked", clickId });

    const answer = await fromEmber(inGeneral);
    expect(answer.plainText).toBe("I opened #12 for it.");
    // The call went to the app's own address, with its token, by the tool's own name, once the server still listed it as it was picked.
    expect(rpcs.map(({ method }) => method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    expect(calls().map(({ params, authorization }) => [params, authorization])).toEqual([[{ name: "create_issue", arguments: { title: "Login fails" } }, `Bearer ${MCP_TOKEN}`]]);
    expect(told()).toEqual([["Opened #12.", false]]);
    expect(JSON.stringify(asked)).not.toContain(MCP_TOKEN);
    expect(JSON.stringify(asked)).not.toContain("localhost");
    expect(await waiting(general)).toEqual([]);
  });

  it("isn't run when it's not allowed, which the model is told, and each call of an answer asks for itself", async () => {
    const { general, inGeneral, ada } = await setUp();
    script = [{ calls: [...CALL.calls, { name: "Tracker__create_issue", input: { title: "Logout fails" } }] }, { text: "I opened one of the two." }];

    const first = await ask(inGeneral);
    click(inGeneral, first, "deny");
    expect((await changed(inGeneral, first)).plainText).toContain(CALL_OUTCOMES.deny(ada.user.name));
    // The second call of the same turn asks on a card of its own, the model not asked meanwhile.
    const second = await fromEmber(inGeneral);
    expect(second.plainText).toContain('"title": "Logout fails"');
    expect(asked).toHaveLength(1);
    expect(calls()).toEqual([]);
    expect(await waiting(general)).toEqual([{ message_id: second.id }]);

    click(inGeneral, second, "allow");
    expect((await fromEmber(inGeneral)).plainText).toBe("I opened one of the two.");
    expect(calls().map(({ params }) => params?.arguments)).toEqual([{ title: "Logout fails" }]);
    expect(told()).toEqual([
      [CALL_DECLINED, true],
      ["Opened #12.", false],
    ]);
  });

  it("is answered by whoever asked or an administrator, and by nobody else in the room", async () => {
    const { general, inGeneral } = await setUp();
    const [grace, hal] = [await join("Grace Hopper"), await join("Hal Abelson")];
    const [graceThere, halThere] = [await connect(general, grace), await connect(general, hal)];
    script = [CALL, { text: "Done." }, CALL, { text: "Done again." }];

    const card = await ask(graceThere);
    expect(card.plainText).toContain("Grace Hopper or an administrator can allow this call.");
    const refused = click(halThere, card, "allow");
    expect(await halThere.next("error")).toMatchObject({ clickId: refused, message: "Only Grace Hopper or an administrator can answer that" });
    expect(calls()).toEqual([]);
    expect(await waiting(general)).toEqual([{ message_id: card.id }]);

    click(graceThere, card, "allow");
    expect((await fromEmber(graceThere)).plainText).toBe("Done.");

    // An administrator answers one someone else asked for.
    const next = await ask(graceThere);
    click(inGeneral, next, "allow");
    expect((await changed(graceThere, next)).plainText).toContain(CALL_OUTCOMES.allow("Ada Lovelace"));
    expect((await fromEmber(graceThere)).plainText).toBe("Done again.");
    expect(calls()).toHaveLength(2);
  });

  /** Has the calls that wait in `room` have waited `ms` longer than they have. */
  const age = (room: RoomId, ms: number) =>
    roomSql(room, "UPDATE waiting_calls SET asked_at = asked_at - ?, call = json_set(call, '$.askedAt', json_extract(call, '$.askedAt') - ?) WHERE room_id = ?", ms, ms, room);

  it("is forgotten once it has waited too long, by the room's alarm, which has its card say so in place of its buttons, and leaves those that haven't", async () => {
    const { general, inGeneral } = await setUp();
    script = [CALL, CALL];
    const old = await ask(inGeneral);
    await age(general, CALL_WAITS_MS + 1);
    const recent = await ask(inGeneral);

    expect(await runDurableObjectAlarm(roomStub(general))).toBe(true);
    const late = await changed(inGeneral, old);
    expect(late.plainText).toContain(CALL_OUTCOMES.late());
    expect(buttonsOf(late.cards)).toEqual([]);
    expect(await waiting(general)).toEqual([{ message_id: recent.id }]);
    // Nothing of the conversation is kept for it, and the alarm is set for the one that still waits.
    expect(await roomSql(general, "SELECT count(*) AS kept FROM waiting_calls WHERE call LIKE '%open an issue%'")).toEqual([{ kept: 1 }]);
    await age(general, CALL_WAITS_MS + 1);
    expect(await runDurableObjectAlarm(roomStub(general))).toBe(true);
    expect((await changed(inGeneral, recent)).plainText).toContain(CALL_OUTCOMES.late());
    expect(await waiting(general)).toEqual([]);
    expect(await runDurableObjectAlarm(roomStub(general))).toBe(false);
    expect(calls()).toEqual([]);
    expect(asked).toHaveLength(2);
  });

  it("is forgotten in time when it starts to wait as the alarm finds nothing left to come back for", async () => {
    const { general, inGeneral } = await setUp();
    script = [CALL];
    const card = await ask(inGeneral);
    const [{ call }] = (await roomSql(general, "SELECT call FROM waiting_calls WHERE room_id = ?", general)) as [{ call: string }];
    await age(general, CALL_WAITS_MS + 1);
    // As the alarm has forgotten the late call, another starts to wait, as a card just posted has it: kept, with the alarm set for it.
    type Room = { forgetLateCalls(room: RoomId): Promise<number | null>; waitingCallsFor(room: RoomId): { keep(messageId: string, call: unknown): Promise<void> }; wakeAt(room: RoomId, time: number): Promise<boolean> };
    await runInDurableObject(roomStub(general), (instance) => {
      const room = instance as unknown as Room;
      const forgetLateCalls = room.forgetLateCalls.bind(room);
      room.forgetLateCalls = async (roomId) => {
        room.forgetLateCalls = forgetLateCalls;
        const next = await forgetLateCalls(roomId);
        const waits = { ...(JSON.parse(call) as { askedAt: number }), askedAt: Date.now() };
        await room.waitingCallsFor(roomId).keep(card.id, waits);
        await room.wakeAt(roomId, waits.askedAt + CALL_WAITS_MS + 1);
        return next;
      };
    });
    expect(await runDurableObjectAlarm(roomStub(general))).toBe(true);
    expect((await changed(inGeneral, card)).plainText).toContain(CALL_OUTCOMES.late());
    expect(await waiting(general)).toEqual([{ message_id: card.id }]);

    // The alarm comes back for it.
    await age(general, CALL_WAITS_MS + 1);
    expect(await runDurableObjectAlarm(roomStub(general))).toBe(true);
    expect(await waiting(general)).toEqual([]);
  });

  it("is forgotten in time while the room's deliveries keep failing, as when the search index is away", async () => {
    const { general, inGeneral } = await setUp();
    vi.spyOn(console, "error").mockImplementation(() => {});
    script = [CALL];
    const card = await ask(inGeneral);
    // The room's alarm finds the search index away, and comes back for it.
    const away = { getByName: () => ({ apply: () => Promise.reject(new Error("The search index is away")) }) };
    await runInDurableObject(roomStub(general), (room) => {
      const object = room as unknown as { env: Record<string, unknown> };
      object.env = { ...object.env, SEARCH_INDEX: away };
    });
    expect(await runDurableObjectAlarm(roomStub(general))).toBe(true);
    expect(await waiting(general)).toEqual([{ message_id: card.id }]);

    await age(general, CALL_WAITS_MS + 1);
    await post(inGeneral, "<p>Something else for the index.</p>");
    expect(await runDurableObjectAlarm(roomStub(general))).toBe(true);
    const late = await changed(inGeneral, card);
    expect(late.plainText).toContain(CALL_OUTCOMES.late());
    expect(buttonsOf(late.cards)).toEqual([]);
    expect(await waiting(general)).toEqual([]);
    // The index still hasn't taken the room's messages.
    expect(await roomSql(general, "SELECT count(*) AS unindexed FROM unindexed_messages WHERE room_id = ?", general)).not.toEqual([{ unindexed: 0 }]);
  });

  it("waits on, to be answered again, when the room has no turn left for the answer to go on in", async () => {
    const { general, inGeneral, ada } = await setUp();
    script = [CALL, { text: "I opened #12 for it." }];
    const card = await ask(inGeneral);
    /** Has the room's queue of answers say whether it's full. */
    const queueIsFull = (full: boolean | undefined) =>
      runInDurableObject(roomStub(general), (room) => {
        const { answers } = room as unknown as { answers: object };
        if (full === undefined) delete (answers as { full?: boolean }).full;
        else Object.defineProperty(answers, "full", { value: full, configurable: true });
      });

    await queueIsFull(true);
    const busy = click(inGeneral, card, "allow");
    expect(await inGeneral.next("error")).toMatchObject({ clickId: busy, message: "Too many questions are waiting for answers in this room. Try again in a moment" });
    expect(await waiting(general)).toEqual([{ message_id: card.id }]);
    expect(calls()).toEqual([]);
    expect(asked).toHaveLength(1);

    // Its card is as it was, and allows it once there's a turn.
    await queueIsFull(undefined);
    click(inGeneral, card, "allow");
    expect((await changed(inGeneral, card)).plainText).toContain(CALL_OUTCOMES.allow(ada.user.name));
    expect((await fromEmber(inGeneral)).plainText).toBe("I opened #12 for it.");
    expect(calls()).toHaveLength(1);
    expect(await waiting(general)).toEqual([]);
  });

  it("shows what it's called with as it's written, so that a name like :tada: isn't shown as an emoji the app isn't sent", async () => {
    const { inGeneral } = await setUp();
    script = [{ calls: [{ name: "Tracker__create_issue", input: { title: ":tada: Login &amp; logout <b>fail</b>" } }] }, { text: "Opened." }];

    const card = await ask(inGeneral);
    expect(card.plainText).toContain('"title": ":tada: Login &amp; logout <b>fail</b>"');
    expect(card.body).not.toContain("🎉");
    click(inGeneral, card, "allow");
    expect((await fromEmber(inGeneral)).plainText).toBe("Opened.");
    expect(calls().map(({ params }) => params?.arguments)).toEqual([{ title: ":tada: Login &amp; logout <b>fail</b>" }]);
  });

  it("isn't run by a click that comes once it has waited too long, which its card says, and the answer is dropped", async () => {
    const { general, inGeneral } = await setUp();
    script = [CALL];
    const card = await ask(inGeneral);
    await age(general, CALL_WAITS_MS + 1);

    const clickId = click(inGeneral, card, "allow");
    expect((await changed(inGeneral, card)).plainText).toContain(CALL_OUTCOMES.late());
    expect(await inGeneral.next("error")).toMatchObject({ clickId, message: "That waited too long to be allowed. Ask again" });
    await sleep(50);
    expect(calls()).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(await waiting(general)).toEqual([]);
  });

  it("isn't run once the tool isn't the agent's as it was picked: taken away, or described another way by its server since", async () => {
    const { general, inGeneral, ada } = await setUp();
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Taken away while the call waits: nothing is asked of the app.
    script = [CALL, { text: "I couldn't." }];
    const card = await ask(inGeneral);
    await pick(ada);
    click(inGeneral, card, "allow");
    expect((await fromEmber(inGeneral)).plainText).toBe("I couldn't.");
    expect(told()).toEqual([["Not run: Tracker__create_issue isn't one of your tools any more.", true]]);
    expect(rpcs).toEqual([]);

    // Described another way by its server, which Ember finds as it calls: the tool is listed, but not called.
    await pick(ada, "create_issue");
    rpcs.length = 0;
    script = [CALL, { text: "I couldn't either." }];
    const again = await ask(inGeneral);
    server.tools = [{ ...CREATE_ISSUE, description: "Opens an issue, and emails everyone." }];
    click(inGeneral, again, "allow");
    expect((await fromEmber(inGeneral)).plainText).toBe("I couldn't either.");
    expect(told()).toEqual([["Not run: create_issue has changed since an administrator looked at it.", true]]);
    expect(calls()).toEqual([]);
    expect(await waiting(general)).toEqual([]);
  });

  it("goes nowhere once Ember AI answers with another model, which @ember says, or is turned off", async () => {
    const { general, inGeneral, ada } = await setUp();
    script = [CALL];
    const card = await ask(inGeneral);
    const moved = await api("/api/account/assistant", { method: "PUT", headers: as(ada), body: JSON.stringify({ accountId: ACCOUNT_ID, apiToken: API_TOKEN, model: OPUS }) });
    expect(moved.status, await moved.clone().text()).toBe(200);
    click(inGeneral, card, "allow");
    await inGeneral.next("card.clicked");
    expect((await fromEmber(inGeneral)).plainText).toBe("I can't go on from that call: my model was changed while it waited. Ask me again.");
    expect(calls()).toEqual([]);

    script = [CALL];
    const again = await ask(inGeneral);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await api("/api/account/assistant", { method: "DELETE", headers: as(ada) })).status).toBe(200);
    const clickId = click(inGeneral, again, "allow");
    expect(await inGeneral.next("card.clicked")).toEqual({ type: "card.clicked", clickId });
    await sleep(50);
    expect(calls()).toEqual([]);
    expect(await waiting(general)).toEqual([]);
  });

  it("tells the model what the app answered, in text, that it failed, or that it refused the call, cut to what a model is given", async () => {
    const { inGeneral } = await setUp();
    const results: unknown[] = [
      { content: [{ type: "text", text: " Opened #12. " }, { type: "image", data: "AAAA", mimeType: "image/png" }, { type: "resource_link", uri: "https://tracker.example/12", name: "12" }] },
      { content: [], structuredContent: { number: 12 } },
      { content: [{ type: "text", text: "No such project." }], isError: true },
      { content: [{ type: "text", text: "x".repeat(MAX_RESULT_LENGTH + 1) }] },
      {},
    ];
    const expected = [
      ["Opened #12.\n\n(A picture, which Ember doesn't pass on.)\n\n(A link: https://tracker.example/12)", false],
      ['{"number":12}', false],
      ["No such project.", true],
      [`${"x".repeat(MAX_RESULT_LENGTH)}\n(Cut here: the rest is longer than Ember passes on.)`, false],
      ["(The tool answered with nothing.)", false],
    ];
    for (const [index, result] of results.entries()) {
      server.result = () => result;
      script = [CALL, { text: `Answer ${index}` }];
      click(inGeneral, await ask(inGeneral), "allow");
      expect((await fromEmber(inGeneral)).plainText).toBe(`Answer ${index}`);
      expect(told(), String(index)).toEqual([expected[index]]);
    }
  });

  it("tells the model why a call came to nothing: the app refused it, dropped the tool, or didn't take Ember's token", async () => {
    const { inGeneral } = await setUp();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const goesWrong: Array<[() => void, string]> = [
      [() => (server.refuses = "title is too short"), "create_issue refused the call: title is too short"],
      [() => (server.tools = [SEARCH_ISSUES]), "Not run: localhost:3845 no longer has a tool named create_issue."],
      [() => (server.token = "another-token"), "Not run: localhost:3845 didn't take that token."],
    ];
    for (const [index, [wrong, expected]] of goesWrong.entries()) {
      script = [CALL, { text: `Answer ${index}` }];
      const card = await ask(inGeneral);
      wrong();
      click(inGeneral, card, "allow");
      expect((await fromEmber(inGeneral)).plainText).toBe(`Answer ${index}`);
      expect(told(), String(index)).toEqual([[expected, true]]);
      expect(JSON.stringify(asked)).not.toContain(MCP_TOKEN);
      server.refuses = undefined;
    }
  });

  it("is never asked for with more than its card shows, which the model is told, so that nobody allows what they couldn't read", async () => {
    const { general, inGeneral } = await setUp();
    // As JSON, `{\n  "title": "…"\n}` is 17 characters around the title.
    const longest = "x".repeat(MAX_SHOWN_INPUT_LENGTH - 17);
    script = [{ calls: [{ name: "Tracker__create_issue", input: { title: `${longest}x` } }] }, { calls: [{ name: "Tracker__create_issue", input: { title: longest } }] }];

    const card = await ask(inGeneral);
    expect(asked).toHaveLength(2);
    expect((asked[1]!.messages.at(-1)!.content as Array<{ content: string; is_error?: boolean }>).map(({ content, is_error }) => [content, is_error])).toEqual([[TOO_LONG_TO_SHOW, true]]);
    expect(card.plainText).toContain(`"title": "${longest}"`);
    expect(await waiting(general)).toEqual([{ message_id: card.id }]);
    expect(calls()).toEqual([]);
  });

  it("isn't given to a model with nothing picked for @ember, whose answers are as they were", async () => {
    const { inGeneral, ada } = await setUp();
    await pick(ada);
    expect((await ask(inGeneral)).plainText).toBe("Hello, team!");
    expect(asked[0]!.tools.map(({ name }) => name)).toEqual(["search_messages"]);
  });
});
