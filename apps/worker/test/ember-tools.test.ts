import { ASSISTANT_ID, type Message, type NewWorkspace, type RoomId, type User } from "@ember/protocol";
import type { AgentAnswer, AgentSettings, NewAgent } from "@ember/protocol/agents";
import { maxTokensAt, DEFAULT_LEVELS, type ModelFormat } from "@ember/protocol/assistant";
import { MENTION_CONTENT_TYPE, mentionSgid } from "@ember/richtext";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTES, ROOM_MESSAGES_READ } from "../src/assistant/answers";
import { askOnce, type Gateway, type Question } from "../src/assistant/gateway";
import { MAX_FOUND_LENGTH, MESSAGES_FOUND } from "../src/assistant/room-search";
import { goingOn, NO_CALLS_LEFT, resultsOf, TOOL_CALLS_PER_ANSWER, toolCallsIn, toolsIn, ToolError, withRoom, type EmberTool } from "../src/assistant/tool-calls";
import type { Env } from "../src/env";
import { answerWithKeptModel, api, connect, cookieOf, createRoom, freshDeploy, post, roomSql, shown, workspaceSql, type Client, type Session } from "./support";

// The tools Ember runs for @ember and the agents: a model that calls one is asked again with what the
// call came to, in its format, for as many calls as an answer may make. The first searches the room.

const bindings = env as unknown as Env;
const EMBER = { id: ASSISTANT_ID };
const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const API_TOKEN = "an-api-token-with-ai-gateway-run_0123456";
const [CLAUDE, GPT, GROK, GLM] = ["anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol", "xai/grok-4.7", "@cf/zai-org/glm-4.7-flash"];

/** A request the fake AI Gateway was sent. */
interface Asked {
  url: string;
  body: Record<string, unknown> & { tools?: unknown[]; messages?: unknown[]; input?: unknown[] };
}

/** What a model does in a turn: calls the room's search for each of `calls`, or answers `text`. */
type Turn = { calls: string[]; written?: number } | { text: string };

/** The format of the API at `url`, as its answers come. */
const shapeOf = (url: string) => (url.endsWith("/messages") ? "messages" : url.endsWith("/responses") ? "responses" : "chat");

/** What a model sends back for `turn`, the `nth` of an answer, in the format of the API at `url`: its thinking, then its calls of `search_messages`, or its answer. */
function turnIn(url: string, turn: Turn, nth: number): Response {
  const shape = shapeOf(url);
  const calls = "calls" in turn ? turn.calls.map((words, index) => ({ id: `call_${nth}_${index}`, words })) : [];
  const written = "calls" in turn ? (turn.written ?? 50) : 50;
  if (shape === "messages") {
    const content = "text" in turn ? [{ type: "text", text: turn.text }] : [THOUGHT, { type: "text", text: "I'll look." }, ...calls.map(({ id, words }) => ({ type: "tool_use", id, name: "search_messages", input: { words } }))];
    return Response.json({ type: "message", role: "assistant", content, stop_reason: "text" in turn ? "end_turn" : "tool_use", usage: { input_tokens: 1_000, output_tokens: written } });
  }
  if (shape === "responses") {
    const output =
      "text" in turn
        ? [{ type: "message", role: "assistant", content: [{ type: "output_text", text: turn.text }] }]
        : [REASONED, ...calls.map(({ id, words }) => ({ type: "function_call", id: `fc_${id}`, call_id: id, name: "search_messages", arguments: JSON.stringify({ words }), status: "completed" }))];
    return Response.json({ object: "response", status: "completed", output, usage: { input_tokens: 1_000, output_tokens: written } });
  }
  const message =
    "text" in turn
      ? { role: "assistant", content: turn.text }
      : { role: "assistant", content: null, tool_calls: calls.map(({ id, words }) => ({ id, type: "function", function: { name: "search_messages", arguments: JSON.stringify({ words }) } })) };
  return Response.json({ object: "chat.completion", choices: [{ index: 0, message, finish_reason: "text" in turn ? "stop" : "tool_calls" }], usage: { prompt_tokens: 1_000, completion_tokens: written } });
}

/** Anthropic's model's thinking, and OpenAI's, which each asks to have back as it was. */
const THOUGHT = { type: "thinking", thinking: "The launch was set earlier.", signature: "sig" };
const REASONED = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "sealed" };

let asked: Asked[];
/** What the model does in each turn of its answers to questions with Ember's tools, in order, and then says hello. */
let script: Turn[];
/** What the fake AI Gateway answers a request, in place of the script, if anything. */
let refusing: (asked: Asked) => Response | null;

beforeEach(async () => {
  await freshDeploy();
  asked = [];
  script = [];
  refusing = () => null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const sent = { url: request.url, body: (await request.json()) as Asked["body"] };
    asked.push(sent);
    const refused = refusing(sent);
    if (refused) return refused;
    const turn = sent.body.tools ? script.shift() : undefined;
    return turnIn(sent.url, turn ?? { text: "Hello, team!" }, asked.length);
  });
});

afterEach(() => vi.restoreAllMocks());

const as = (session: Session) => ({ Cookie: session.cookie });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sets Ember up with Ada as its administrator and Ember AI answering with `model`, answering her session, the general room, and her there. */
async function setUp(model: string): Promise<{ ada: Session; general: RoomId; inGeneral: Client }> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" }) });
  expect(response.status).toBe(201);
  const ada = { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
  const [{ id: general }] = (await workspaceSql("SELECT id FROM rooms WHERE name = 'general'")) as [{ id: RoomId }];
  const set = await api("/api/account/assistant", { method: "PUT", headers: as(ada), body: JSON.stringify({ accountId: ACCOUNT_ID, apiToken: API_TOKEN, model }) });
  expect(set.status, await set.clone().text()).toBe(200);
  asked.length = 0;
  return { ada, general, inGeneral: await connect(general, ada) };
}

/** Waits until room `room` has nothing left in its log for the search index. */
async function caughtUp(room: RoomId): Promise<void> {
  while ((await roomSql(room, "SELECT seq FROM unindexed_messages WHERE room_id = ?", room)).length > 0) await sleep(5);
}

/** Writes enough in the room `client` is in that what was written there before isn't read with a question asked next. */
async function moveOn(client: Client): Promise<void> {
  for (let n = 1; n < ROOM_MESSAGES_READ; n++) await post(client, `<p>Onwards ${n}</p>`);
}

/** Asks `bot` `question` in the room `client` is in, once the search index has what was written there, answering the question and what the bot said. */
async function ask(client: Client, room: RoomId, bot: Pick<User, "id">, question = "when is the launch?"): Promise<{ question: Message; answer: Message }> {
  await caughtUp(room);
  const mention = `<action-text-attachment sgid="${mentionSgid(bot.id)}" content-type="${MENTION_CONTENT_TYPE}"></action-text-attachment>`;
  const sent = await post(client, `<p>${mention} ${question}</p>`);
  for (;;) {
    const { message } = await client.next("message.created");
    if (message.creator.id === bot.id) return { question: sent, answer: message };
  }
}

/** The requests that asked a model a question in a room, which give it Ember's tools, or would. */
const answers = () => asked.filter(({ body }) => JSON.stringify(body).includes("when is the launch?"));

const SEARCH_DESCRIBED = { name: "search_messages", description: expect.stringContaining("Searches the messages of the room you're asked in") as string };
const SEARCH_TAKES = { type: "object", properties: { words: { type: "string", description: expect.any(String) as string } }, required: ["words"], additionalProperties: false };

describe("A tool Ember runs", () => {
  it("is called by Claude, which is asked again with what it said, its thinking too, and what the room's search found", async () => {
    const { general, inGeneral } = await setUp(CLAUDE);
    const said = await post(inGeneral, "<p>The launch moved to March 3.</p>");
    await moveOn(inGeneral);
    script = [{ calls: ["launch"], written: 300 }, { text: "The launch is on March 3." }];

    const { answer } = await ask(inGeneral, general, EMBER);
    expect(answer.plainText).toBe("The launch is on March 3.");

    const [first, second] = answers();
    expect(answers()).toHaveLength(2);
    expect(first!.url).toMatch(/\/anthropic\/v1\/messages$/);
    expect(first!.body.tools).toEqual([{ ...SEARCH_DESCRIBED, input_schema: SEARCH_TAKES }]);
    expect(first!.body).not.toHaveProperty("tool_choice");
    const when = `${said.createdAt.slice(0, 10)} ${said.createdAt.slice(11, 16)} UTC`;
    expect(second!.body.messages).toEqual([
      ...first!.body.messages!,
      { role: "assistant", content: [THOUGHT, { type: "text", text: "I'll look." }, { type: "tool_use", id: "call_1_0", name: "search_messages", input: { words: "launch" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1_0", content: `The only message with those words:\n\n[${when}] Ada Lovelace: The launch moved to March 3.` }] },
    ]);
    // The answer's turns share its tokens.
    expect(second!.body).toMatchObject({ max_tokens: maxTokensAt(DEFAULT_LEVELS) - 300, tools: first!.body.tools });
    expect(second!.body).not.toHaveProperty("tool_choice");
  });

  it("is called by GPT in Responses, whose thinking Ember asks for in a form it can send back with the call's result", async () => {
    const { general, inGeneral } = await setUp(GPT);
    await post(inGeneral, "<p>The launch moved to March 3.</p>");
    await moveOn(inGeneral);
    script = [{ calls: ["launch"], written: 300 }, { text: "The launch is on March 3." }];

    const { answer } = await ask(inGeneral, general, EMBER);
    expect(answer.plainText).toBe("The launch is on March 3.");

    const [first, second] = answers();
    expect(answers()).toHaveLength(2);
    expect(first!.url).toMatch(/\/openai\/responses$/);
    expect(first!.body).toMatchObject({ tools: [{ type: "function", ...SEARCH_DESCRIBED, parameters: SEARCH_TAKES }], store: false, include: ["reasoning.encrypted_content"] });
    expect(second!.body.input).toEqual([
      ...first!.body.input!,
      REASONED,
      { type: "function_call", id: "fc_call_1_0", call_id: "call_1_0", name: "search_messages", arguments: '{"words":"launch"}', status: "completed" },
      { type: "function_call_output", call_id: "call_1_0", output: expect.stringContaining("Ada Lovelace: The launch moved to March 3.") as string },
    ]);
    expect(second!.body).toMatchObject({ max_output_tokens: maxTokensAt(DEFAULT_LEVELS) - 300, store: false });
  });

  it("is called by Grok in Chat Completions, through Cloudflare's REST API", async () => {
    const { general, inGeneral } = await setUp(GROK);
    await post(inGeneral, "<p>The launch moved to March 3.</p>");
    await moveOn(inGeneral);
    script = [{ calls: ["launch"], written: 300 }, { text: "The launch is on March 3." }];

    const { answer } = await ask(inGeneral, general, EMBER);
    expect(answer.plainText).toBe("The launch is on March 3.");

    const [first, second] = answers();
    expect(answers()).toHaveLength(2);
    expect(first!.url).toMatch(/\/ai\/v1\/chat\/completions$/);
    expect(first!.body.tools).toEqual([{ type: "function", function: { ...SEARCH_DESCRIBED, parameters: SEARCH_TAKES } }]);
    expect(second!.body.messages).toEqual([
      ...first!.body.messages!,
      { role: "assistant", content: null, tool_calls: [{ id: "call_1_0", type: "function", function: { name: "search_messages", arguments: '{"words":"launch"}' } }] },
      { role: "tool", tool_call_id: "call_1_0", content: expect.stringContaining("Ada Lovelace: The launch moved to March 3.") as string },
    ]);
    expect(second!.body).toMatchObject({ max_completion_tokens: maxTokensAt(DEFAULT_LEVELS) - 300 });
  });

  it("runs as many calls as an answer may make, tells the model of the rest that it has none left, and then has it answer", async () => {
    const { general, inGeneral } = await setUp(CLAUDE);
    script = [{ calls: ["one", "two", "three"] }, { calls: ["four", "five", "six"] }, { text: "I found nothing." }];

    const { answer } = await ask(inGeneral, general, EMBER);
    expect(answer.plainText).toBe("I found nothing.");

    expect(TOOL_CALLS_PER_ANSWER).toBe(5);
    const [, second, third] = answers();
    expect(answers()).toHaveLength(3);
    expect(second!.body).not.toHaveProperty("tool_choice");
    expect(third!.body).toMatchObject({ tool_choice: { type: "none" } });
    const results = (third!.body.messages!.at(-1) as { content: Array<{ content: string; is_error?: boolean }> }).content;
    expect(results.map(({ content, is_error }) => [content, is_error])).toEqual([
      ["No message in this room has those words.", undefined],
      ["No message in this room has those words.", undefined],
      [NO_CALLS_LEFT, true],
    ]);
  });

  describe("called by a model that searches the web too", () => {
    const tool: EmberTool = { name: "search_messages", description: "Searches the room.", takes: { type: "object" }, run: async () => "Nothing." };
    const question: Question = { instructions: "Answer.", turns: [{ role: "user", text: "when is the launch?" }], maxTokens: 1_000, webTools: ["search", "read"], tools: [tool] };
    const gatewayFor = (model: string, format: ModelFormat): Gateway => ({ accountId: ACCOUNT_ID, apiToken: API_TOKEN, model, format });
    /** What the fake AI Gateway answers each request in turn, as JSON. */
    const answering = (bodies: unknown[]) => {
      refusing = () => Response.json(bodies.shift());
    };

    it("leaves Claude the searches and pages its earlier turns didn't use, and has it answer once it has used one up", async () => {
      const searched = (id: string) => [{ type: "server_tool_use", id, name: "web_search", input: { query: "launch" } }, { type: "web_search_tool_result", tool_use_id: id, content: [] }];
      const calling = (id: string) => ({ type: "tool_use", id, name: "search_messages", input: { words: "launch" } });
      const turn = (content: unknown[], stop_reason = "tool_use") => ({ type: "message", role: "assistant", content, stop_reason, usage: { input_tokens: 1_000, output_tokens: 50 } });
      answering([
        turn([...searched("srv_1"), ...searched("srv_2"), calling("call_1")]),
        turn([...searched("srv_3"), ...searched("srv_4"), ...searched("srv_5"), calling("call_2")]),
        turn([{ type: "text", text: "Nobody said." }], "end_turn"),
      ]);

      const answered = await askOnce(bindings, gatewayFor(CLAUDE, "anthropic"), question, AbortSignal.timeout(5_000));
      expect(answered).toMatchObject({ text: "Nobody said." });

      const usesOf = ({ body }: Asked) => (body.tools as Array<{ name: string; max_uses?: number }>).map(({ name, max_uses }) => [name, max_uses]);
      expect(asked.map(usesOf)).toEqual([
        [["web_search", 5], ["web_fetch", 3], ["search_messages", undefined]],
        [["web_search", 3], ["web_fetch", 3], ["search_messages", undefined]],
        [["web_search", 1], ["web_fetch", 3], ["search_messages", undefined]],
      ]);
      expect(asked.map(({ body }) => body.tool_choice)).toEqual([undefined, undefined, { type: "none" }]);
    });

    it("leaves GPT, and Grok at xAI's endpoint, the searches their earlier turns didn't make", async () => {
      const search = { type: "web_search_call", id: "ws_1", status: "completed" };
      const call = { type: "function_call", id: "fc_1", call_id: "call_1", name: "search_messages", arguments: "{}", status: "completed" };
      const turn = (output: unknown[]) => ({ object: "response", status: "completed", output, usage: { input_tokens: 1_000, output_tokens: 50 } });
      const said = { type: "message", role: "assistant", content: [{ type: "output_text", text: "Nobody said." }] };

      answering([turn([search, search, call]), turn([search, search, search, call]), turn([said])]);
      expect(await askOnce(bindings, gatewayFor(GPT, "openai"), question, AbortSignal.timeout(5_000))).toMatchObject({ text: "Nobody said." });
      expect(asked.map(({ body }) => [body.max_tool_calls, body.tool_choice])).toEqual([[5, undefined], [3, undefined], [1, "none"]]);

      asked.length = 0;
      answering([turn([search, call]), turn([said])]);
      expect(await askOnce(bindings, gatewayFor(GROK, "xai"), question, AbortSignal.timeout(5_000))).toMatchObject({ text: "Nobody said." });
      expect(asked.map(({ body }) => [body.max_turns, body.tool_choice])).toEqual([[5, undefined], [4, undefined]]);
    });

    it("runs Grok's searches of the web in Chat Completions with the room's, through Cloudflare's Web Search API, and lists the pages they found", async () => {
      const page = { url: "https://example.com/launch", title: "Launch day", description: "The launch is on March 3." };
      const call = (id: string, name: string, args: Record<string, string>) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
      const turn = (message: Record<string, unknown>) => ({ object: "chat.completion", choices: [{ index: 0, message, finish_reason: "tool_calls" in message ? "tool_calls" : "stop" }], usage: { completion_tokens: 50 } });
      const answers = [
        turn({ role: "assistant", content: null, tool_calls: [call("call_1", "web_search", { query: "launch date" }), call("call_2", "search_messages", { words: "launch" })] }),
        turn({ role: "assistant", content: "It's on March 3." }),
      ];
      refusing = ({ url }) => Response.json(url.endsWith("/ai/websearch/") ? { success: true, result: { items: [page] } } : answers.shift());

      const answered = await askOnce(bindings, gatewayFor(GROK, "chat"), question, AbortSignal.timeout(5_000));
      expect(answered).toMatchObject({ text: "It's on March 3.", sources: [{ url: page.url, title: page.title }] });
      expect(asked.map(({ url }) => new URL(url).pathname)).toEqual([
        `/client/v4/accounts/${ACCOUNT_ID}/ai/v1/chat/completions`,
        `/client/v4/accounts/${ACCOUNT_ID}/ai/websearch/`,
        `/client/v4/accounts/${ACCOUNT_ID}/ai/v1/chat/completions`,
      ]);
      // Only Ember's tool for searching the web is given, as Chat Completions has no tool for reading pages.
      expect((asked[0]!.body.tools as Array<{ function: { name: string } }>).map(({ function: { name } }) => name)).toEqual(["web_search", "search_messages"]);
      expect(asked[1]!.body).toMatchObject({ query: "launch date", options: { gateway: { id: "default" } } });
      expect(asked[2]!.body.messages!.slice(-2)).toEqual([
        { role: "tool", tool_call_id: "call_1", content: expect.stringContaining(`1. Launch day\n${page.url}\nThe launch is on March 3.`) as string },
        { role: "tool", tool_call_id: "call_2", content: "Nothing." },
      ]);
    });

    it("leaves a model refused going on from a call the searches and tokens its turns didn't use, as it's asked again without Ember's tools", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const refusal = () => Response.json({ type: "error", error: { type: "invalid_request_error", message: "messages.2: unexpected `tool_result`" } }, { status: 400 });
      const searched = (id: string) => [{ type: "server_tool_use", id, name: "web_search", input: { query: "launch" } }, { type: "web_search_tool_result", tool_use_id: id, content: [] }];
      const calling = { type: "tool_use", id: "call_1", name: "search_messages", input: { words: "launch" } };
      const turn = (content: unknown[], stop_reason: string, written: number) => ({ type: "message", role: "assistant", content, stop_reason, usage: { input_tokens: 1_000, output_tokens: written } });
      // Claude searches the web twice and calls the room's search, pauses going on, and is refused carrying that on.
      const answers = [
        () => Response.json(turn([...searched("srv_1"), ...searched("srv_2"), calling], "tool_use", 50)),
        () => Response.json(turn([{ type: "text", text: "Let me see." }], "pause_turn", 40)),
        refusal,
        () => Response.json(turn([{ type: "text", text: "Nobody said." }], "end_turn", 10)),
      ];
      refusing = () => answers.shift()!();

      expect(await askOnce(bindings, gatewayFor(CLAUDE, "anthropic"), question, AbortSignal.timeout(5_000))).toMatchObject({ text: "Nobody said." });
      const last = asked.at(-1)!.body;
      expect(asked).toHaveLength(4);
      expect((last.tools as Array<{ name: string; max_uses?: number }>).map(({ name, max_uses }) => [name, max_uses])).toEqual([["web_search", 3], ["web_fetch", 3]]);
      expect(last).toMatchObject({ max_tokens: question.maxTokens - 90, messages: asked[0]!.body.messages });
      expect(last).not.toHaveProperty("tool_choice");

      // GPT, whose searches are capped by the request, is left those it didn't make.
      asked.length = 0;
      const call = { type: "function_call", id: "fc_1", call_id: "call_1", name: "search_messages", arguments: "{}", status: "completed" };
      const search = { type: "web_search_call", id: "ws_1", status: "completed" };
      const said = { type: "message", role: "assistant", content: [{ type: "output_text", text: "Nobody said." }] };
      const responded = (output: unknown[]) => () => Response.json({ object: "response", status: "completed", output, usage: { input_tokens: 1_000, output_tokens: 50 } });
      answers.push(responded([search, search, call]), () => Response.json({ error: { type: "invalid_request_error", message: "Unknown parameter: input[3]" } }, { status: 400 }), responded([said]));
      expect(await askOnce(bindings, gatewayFor(GPT, "openai"), question, AbortSignal.timeout(5_000))).toMatchObject({ text: "Nobody said." });
      expect(asked.map(({ body }) => [body.max_tool_calls, (body.tools as unknown[]).length, body.max_output_tokens])).toEqual([
        [5, 2, question.maxTokens],
        [3, 2, question.maxTokens - 50],
        [3, 1, question.maxTokens - 50],
      ]);
    });
  });

  it("says it couldn't answer when the model calls a tool with too few of the answer's tokens left to go on", async () => {
    const { general, inGeneral } = await setUp(GPT);
    script = [{ calls: ["launch"], written: maxTokensAt(DEFAULT_LEVELS) - 10 }];
    const { answer } = await ask(inGeneral, general, EMBER);
    expect(answer.plainText).toBe(NOTES["out of room"]);
    expect(answers()).toHaveLength(1);
  });

  it("is left out when the model's request is refused with it, after everything else that might have been refused", async () => {
    const { general, inGeneral } = await setUp(CLAUDE);
    vi.spyOn(console, "error").mockImplementation(() => {});
    refusing = ({ body }) => (body.tools ? Response.json({ type: "error", error: { type: "invalid_request_error", message: "tools.0: Extra inputs are not permitted" } }, { status: 400 }) : null);

    const { answer } = await ask(inGeneral, general, EMBER);
    expect(answer.plainText).toBe("Hello, team!");
    expect(answers().map(({ body }) => [body.tools !== undefined, "thinking" in body])).toEqual([
      [true, true],
      [true, false],
      [false, false],
    ]);
  });

  it("is left out for the rest of an answer whose model is refused going on from a call, which is asked once more, as it was, in the tokens the answer has left", async () => {
    const { general, inGeneral } = await setUp(CLAUDE);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const goesOn = ({ body }: Asked) => JSON.stringify(body.messages).includes("tool_result");
    refusing = (sent) => (goesOn(sent) ? Response.json({ type: "error", error: { type: "invalid_request_error", message: "messages.2: unexpected `tool_result`" } }, { status: 400 }) : null);
    script = [{ calls: ["launch"], written: 300 }];

    const { answer } = await ask(inGeneral, general, EMBER);
    expect(answer.plainText).toBe("Hello, team!");
    expect(answers().map(({ body }) => [body.tools !== undefined, "thinking" in body, body.max_tokens])).toEqual([
      [true, true, maxTokensAt(DEFAULT_LEVELS)],
      [true, true, maxTokensAt(DEFAULT_LEVELS) - 300],
      [false, true, maxTokensAt(DEFAULT_LEVELS) - 300],
    ]);
    expect(answers()[2]!.body.messages).toEqual(answers()[0]!.body.messages);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("again without Ember's tools, as it was refused going on from a call of one"));

    // Refused without them too, it isn't asked another way.
    asked.length = 0;
    script = [{ calls: ["launch"] }];
    refusing = (sent) => (goesOn(sent) || !sent.body.tools ? Response.json({ type: "error", error: { type: "invalid_request_error", message: "messages: unexpected" } }, { status: 400 }) : null);
    const { answer: note } = await ask(inGeneral, general, EMBER);
    expect(note.plainText).not.toBe("Hello, team!");
    expect(answers()).toHaveLength(3);
  });

  it("isn't given to a model kept from before Ember offered only its own, or to an agent someone tries", async () => {
    const { ada, general, inGeneral } = await setUp(CLAUDE);
    await answerWithKeptModel({ id: GLM, name: "GLM-4.7 Flash", format: "chat", thinkingLevels: ["off"] });
    await ask(inGeneral, general, EMBER);
    expect(answers().map(({ body }) => body.tools)).toEqual([undefined]);

    asked.length = 0;
    const trial = { name: "Scout", instructions: "Help out.", model: CLAUDE, thinking: "off", length: "short", webSearch: false, question: "when is the launch?" };
    const tried = await api("/api/account/agents/trials", { method: "POST", headers: as(ada), body: JSON.stringify(trial) });
    expect(tried.status, await tried.clone().text()).toBe(200);
    expect(answers().map(({ body }) => body.tools)).toEqual([undefined]);
  });

  it("is given to an agent asked in a room", async () => {
    const { ada, general, inGeneral } = await setUp(CLAUDE);
    const agent: NewAgent = { name: "Scout", description: "Helps out", instructions: "Help out.", model: GPT, thinking: "off", length: "short", webSearch: false, rooms: null };
    const made = await api("/api/account/agents", { method: "POST", headers: as(ada), body: JSON.stringify(agent) });
    expect(made.status, await made.clone().text()).toBe(201);
    const scout = ((await made.json()) as AgentAnswer).agent as AgentSettings;
    asked.length = 0;
    script = [{ calls: ["launch"] }, { text: "Nobody said." }];

    const { answer } = await ask(inGeneral, general, { id: scout.id });
    expect(answer.plainText).toBe("Nobody said.");
    expect(answers().map(({ body }) => (body.tools as Array<{ name: string }>).map(({ name }) => name))).toEqual([["search_messages"], ["search_messages"]]);
  });
});

describe("The room's search", () => {
  /** What the search answers Claude's call for `words` in an answer to a question asked in `room`. */
  async function searching(client: Client, room: RoomId, words: string): Promise<{ found: string; question: Message }> {
    asked.length = 0;
    script = [{ calls: [words] }, { text: "Done." }];
    const { question } = await ask(client, room, EMBER);
    const results = (answers()[1]!.body.messages!.at(-1) as { content: Array<{ content: string }> }).content;
    return { found: results[0]!.content, question };
  }

  it("finds only the room's own messages, newest first, in its threads too", async () => {
    const { ada, general, inGeneral } = await setUp(CLAUDE);
    const elsewhere = await createRoom("elsewhere");
    const inElsewhere = await connect(elsewhere.id, ada);
    await post(inElsewhere, "<p>The launch is a secret here.</p>");
    await caughtUp(elsewhere.id);
    const first = await post(inGeneral, "<p>The launch moved to March 3.</p>");
    inGeneral.send({ type: "message.create", clientMessageId: crypto.randomUUID(), body: "<p>Is the launch party on too?</p>", parentId: first.id });
    await inGeneral.next("message.created");
    await moveOn(inGeneral);

    const { found } = await searching(inGeneral, general, "launch");
    const lines = found.split("\n\n");
    expect(lines).toEqual([
      "All 2 messages with those words, newest first:",
      expect.stringMatching(/^\[\d{4}-\d\d-\d\d \d\d:\d\d UTC, in a thread\] Ada Lovelace: Is the launch party on too\?$/),
      expect.stringMatching(/^\[\d{4}-\d\d-\d\d \d\d:\d\d UTC\] Ada Lovelace: The launch moved to March 3\.$/),
    ]);
  });

  it("leaves out the messages the model was given with the question, however many match, and finds what was written before them", async () => {
    const { general, inGeneral } = await setUp(CLAUDE);
    await post(inGeneral, "<p>The launch moved to March 3.</p>");
    for (let n = 1; n < ROOM_MESSAGES_READ; n++) await post(inGeneral, `<p>Is the launch still on? Asking for the ${n}th time.</p>`);

    const { found } = await searching(inGeneral, general, "launch");
    expect(found).toMatch(/^The only message with those words:\n\n\[.+\] Ada Lovelace: The launch moved to March 3\.$/);
  });

  it("says so when only the messages the model was given match", async () => {
    const { general, inGeneral } = await setUp(CLAUDE);
    await post(inGeneral, "<p>The launch moved to March 3.</p>");

    const { found } = await searching(inGeneral, general, "launch");
    expect(found).toBe("No message in this room has those words, but for those of the conversation you were given.");
    expect((await searching(inGeneral, general, "kumquat")).found).toBe("No message in this room has those words.");
  });

  it("leaves out a thread's messages when it's asked in the thread, but not the room's", async () => {
    const { general, inGeneral } = await setUp(CLAUDE);
    const first = await post(inGeneral, "<p>The launch moved to March 3.</p>");
    await post(inGeneral, "<p>The launch party is at noon.</p>");
    await caughtUp(general);
    asked.length = 0;
    script = [{ calls: ["launch"] }, { text: "Done." }];
    const mention = `<action-text-attachment sgid="${mentionSgid(EMBER.id)}" content-type="${MENTION_CONTENT_TYPE}"></action-text-attachment>`;
    inGeneral.send({ type: "message.create", clientMessageId: crypto.randomUUID(), body: `<p>${mention} when is the launch?</p>`, parentId: first.id });
    for (;;) if ((await inGeneral.next("message.created")).message.creator.id === EMBER.id) break;

    const results = (answers()[1]!.body.messages!.at(-1) as { content: Array<{ content: string }> }).content;
    expect(results[0]!.content).toMatch(/^The only message with those words:\n\n\[.+\] Ada Lovelace: The launch party is at noon\.$/);
  });

  it("answers the newest of many matches, saying there are more, and the start of a long one", async () => {
    const { general, inGeneral } = await setUp(CLAUDE);
    for (let n = 1; n <= MESSAGES_FOUND + 2; n++) await post(inGeneral, `<p>Kumquat count ${n}</p>`);
    await post(inGeneral, `<p>Kumquat ${"very ".repeat(200)}long</p>`);
    await moveOn(inGeneral);

    const { found } = await searching(inGeneral, general, "kumquat");
    const [count, long, ...rest] = found.split("\n\n");
    expect(count).toBe(`The newest ${MESSAGES_FOUND} messages with those words, of more:`);
    expect(long!.endsWith("…")).toBe(true);
    expect(long!.slice(long!.indexOf("Kumquat")).length).toBe(MAX_FOUND_LENGTH);
    expect(rest.map((line) => line.split(": ")[1])).toEqual(Array.from({ length: MESSAGES_FOUND - 1 }, (_, index) => `Kumquat count ${MESSAGES_FOUND + 2 - index}`));
  });

  it("tells the model what it needs when it's called without words", async () => {
    const { general, inGeneral } = await setUp(CLAUDE);
    const { found } = await searching(inGeneral, general, " ?! ");
    expect(found).toBe("Give the words to find, as `words`.");
  });
});

describe("What a model's calls come to", () => {
  const echo: EmberTool = { name: "echo", description: "Says it back.", takes: { type: "object" }, run: async ({ said }) => `You said ${String(said)}` };
  const broken: EmberTool = {
    name: "broken",
    description: "Fails.",
    takes: { type: "object" },
    run: async ({ how }) => {
      throw how === "politely" ? new ToolError("Not that way.") : new TypeError("secret detail");
    },
  };

  it("tells the model of a tool that isn't there, of what isn't an object, why a tool couldn't, and only that one failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = [
      { id: "1", name: "echo", input: '{"said":"hi"}' },
      { id: "2", name: "echo", input: { said: "ho" } },
      { id: "3", name: "echo", input: "" },
      { id: "4", name: "nothing", input: "{}" },
      { id: "5", name: "echo", input: "[1]" },
      { id: "6", name: "echo", input: '{"said":' },
      { id: "7", name: "broken", input: { how: "politely" } },
      { id: "8", name: "broken", input: {} },
    ];
    expect(await resultsOf([echo, broken], calls, calls.length)).toEqual([
      { id: "1", text: "You said hi", failed: false },
      { id: "2", text: "You said ho", failed: false },
      { id: "3", text: "You said undefined", failed: false },
      { id: "4", text: "There's no tool called nothing.", failed: true },
      { id: "5", text: "echo takes a JSON object.", failed: true },
      { id: "6", text: "echo takes a JSON object.", failed: true },
      { id: "7", text: "Not that way.", failed: true },
      { id: "8", text: "broken failed. Answer without it.", failed: true },
    ]);
    expect(await resultsOf([echo], calls.slice(0, 2), 1)).toEqual([
      { id: "1", text: "You said hi", failed: false },
      { id: "2", text: NO_CALLS_LEFT, failed: true },
    ]);
  });

  it("reads no call in an answer that was cut short, or that calls only its provider's tools", () => {
    const use = { type: "tool_use", id: "toolu_1", name: "echo", input: {} };
    expect(toolCallsIn("anthropic", { content: [use], stop_reason: "tool_use" })).toEqual([{ id: "toolu_1", name: "echo", input: {} }]);
    expect(toolCallsIn("anthropic", { content: [use], stop_reason: "max_tokens" })).toEqual([]);
    expect(toolCallsIn("anthropic", { content: [{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} }], stop_reason: "tool_use" })).toEqual([]);
    const call = { type: "function_call", call_id: "call_1", name: "echo", arguments: "{}" };
    expect(toolCallsIn("openai", { status: "completed", output: [{ type: "web_search_call", id: "ws_1" }, call] })).toEqual([{ id: "call_1", name: "echo", input: "{}" }]);
    expect(toolCallsIn("xai", { status: "incomplete", output: [call] })).toEqual([]);
    const message = { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "echo", arguments: "{}" } }] };
    expect(toolCallsIn("chat", { choices: [{ message, finish_reason: "tool_calls" }] })).toEqual([{ id: "call_1", name: "echo", input: "{}" }]);
    expect(toolCallsIn("chat", { choices: [{ message, finish_reason: "length" }] })).toEqual([]);
    expect(toolCallsIn("chat", null)).toEqual([]);
  });

  it("writes tools, what a call came to and the room left as each format has them", () => {
    const formats: ModelFormat[] = ["anthropic", "messages", "openai", "responses", "xai", "chat"];
    expect(formats.map((format) => Object.keys(toolsIn(format, [echo])[0]!))).toEqual([
      ["name", "description", "input_schema"],
      ["name", "description", "input_schema"],
      ["type", "name", "description", "parameters"],
      ["type", "name", "description", "parameters"],
      ["type", "name", "description", "parameters"],
      ["type", "function"],
    ]);
    const failed = [{ id: "toolu_1", text: "Not that way.", failed: true }];
    expect(goingOn("anthropic", { messages: [] }, { content: [] }, failed)).toEqual({
      messages: [
        { role: "assistant", content: [] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "Not that way.", is_error: true }] },
      ],
    });
    expect(withRoom("anthropic", {}, 500, true)).toEqual({ max_tokens: 500, tool_choice: { type: "none" } });
    expect(withRoom("xai", {}, 500, true)).toEqual({ max_output_tokens: 500, tool_choice: "none" });
    expect(withRoom("chat", { model: "m" }, 500, false)).toEqual({ model: "m", max_completion_tokens: 500 });
  });
});
