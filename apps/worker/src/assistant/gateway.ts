import {
  isProviderFormat,
  PAGES_READ_PER_ANSWER,
  THINKING_LEVELS,
  thinkingTaken,
  WEB_SEARCHES_PER_ANSWER,
  WEB_TOOLS_IN,
  type AssistantField,
  type ModelFormat,
  type ProviderFormat,
  type ThinkingLevel,
  type WebTool,
} from "@ember/protocol/assistant";
import type { Env } from "../env";
import { isLoopback } from "../loopback";
import { isMessages, isObject, isResponses } from "./formats";
import { goingOn, resultsOf, TOOL_CALLS_PER_ANSWER, toolCallsIn, toolsIn, withRoom, writtenIn, type EmberTool } from "./tool-calls";

export { isObject };

// Asking a model through Cloudflare's AI Gateway: Claude and GPT, of the models Ember offers, through the
// gateway's endpoints for Anthropic and OpenAI on gateway.ai.cloudflare.com, which pass on each provider's
// own API as it is (https://developers.cloudflare.com/ai-gateway/usage/providers/anthropic/, …/openai/),
// and Grok there through xAI's (…/grok/) only to search the web, as the gateway's credits pay for it there
// only with no key of xAI's; otherwise Grok, and the models kept before Ember offered only its own as they
// were kept, through the REST API on api.cloudflare.com, in whichever of its three formats the model took
// (https://developers.cloudflare.com/ai-gateway/usage/rest-api/), which takes Grok's requests only in Chat
// Completions. Every request goes through the account's default gateway, whose logs, caching, rate limits
// and spend limits apply, and which Cloudflare makes on the account's first request. A model that may use
// the web is given its provider's own tools for it, which AI Gateway passes on and the provider runs
// (https://developers.cloudflare.com/ai-gateway/usage/web-search/): Anthropic's web search and web fetch
// in Messages, OpenAI's web search in Responses, and xAI's in its own. Chat Completions has none. A model
// may be given tools Ember runs as well, in any format (tool-calls.ts).

/** Where Cloudflare's API is. */
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

/** Where AI Gateway's endpoints for each provider are, under an account and a gateway. */
const PROVIDER_ENDPOINTS = "https://gateway.ai.cloudflare.com/v1";

/** The gateway Ember's requests go through: in the address of each provider's endpoint, and named to Cloudflare's REST API, for a model kept from before. */
const GATEWAY_ID = "default";

/** Where each format's requests go: under the account's `ai/v1` on Cloudflare's API, or, for a provider's own, under the gateway's endpoint for that provider. */
const PATHS: Record<ModelFormat, string> = {
  messages: "messages",
  responses: "responses",
  chat: "chat/completions",
  xai: "grok/v1/responses",
  anthropic: "anthropic/v1/messages",
  openai: "openai/responses",
};

/** The version of Anthropic's API that Ember's requests to the gateway's Anthropic endpoint are written for. */
const ANTHROPIC_VERSION = "2023-06-01";

/** The most of Cloudflare's own words about a refusal that Ember passes on. */
const MAX_QUOTED_LENGTH = 200;

/** The most of a page a model reads, in tokens, about as many as the longest conversation @ember reads. */
const PAGE_TOKENS = 10_000;

/** How many times Ember lets Anthropic's model carry on a turn it paused while it searched, before taking what it said. */
const MAX_CONTINUATIONS = 2;

/** The fewest tokens a request may let its model write, in OpenAI's Responses, so the fewest an answer needs left to go on after a tool's call. */
const LEAST_TOKENS = 16;

/** The most pages an answer names as its sources. */
export const MAX_SOURCES = 10;

/**
 * What Ember asks AI Gateway with: a Cloudflare account, an API token of its, a model and the format the
 * model takes, and the levels of thinking it takes, once Ember has asked it at each (`thinkingLevelsOf`).
 */
export interface Gateway {
  accountId: string;
  apiToken: string;
  model: string;
  format: ModelFormat;
  thinkingLevels?: ThinkingLevel[];
}

/** One turn of a conversation for a model to go on with: what someone wrote, or one of the model's own answers. */
export interface Turn {
  role: "user" | "assistant";
  text: string;
}

/**
 * What to ask a model: how it should answer, the conversation, oldest first, ending with what it's asked,
 * the most tokens its answer may take, its thinking among them, how much to think first, if it's told,
 * who asked, if someone did, and who answers, @ember or an agent, if either does, whom AI Gateway's logs
 * and spend limits then know each request by (custom metadata's `user_id` and `agent_id`), what it
 * may do on the web, of what its format has tools for: nothing, unless it's told, and the tools Ember
 * runs for it, if it has any.
 */
export interface Question {
  instructions: string;
  /** How it should answer when it's asked again only searching, as AI Gateway didn't take the tool for reading pages, if that's not as `instructions` says. */
  instructionsWithoutReading?: string;
  /** How it should answer when it's asked again without the web, whose tools AI Gateway didn't take, if that's not as `instructions` says. */
  instructionsWithoutWeb?: string;
  turns: Turn[];
  maxTokens: number;
  thinking?: ThinkingLevel;
  askerId?: string;
  agentId?: string;
  webTools?: readonly WebTool[];
  tools?: readonly EmberTool[];
}

/**
 * What went wrong asking a model: Cloudflare didn't take the API token, or found no such account, AI
 * Gateway's credits ran out, the model wasn't taken, AI Gateway turned the request away, the conversation
 * was longer than the model reads, AI Gateway didn't answer, the model answered with nothing, or it took
 * every token it could before it answered anything. Or the gateway's Guardrails or Data Loss Prevention,
 * which administrators turn on in AI Gateway, blocked the question, with what it read, or the answer.
 */
export type RefusalReason =
  | "token"
  | "account"
  | "credits"
  | "model"
  | "busy"
  | "too long"
  | "unanswered"
  | "nothing"
  | "out of room"
  | "guardrails"
  | "guardrails answer"
  | "dlp"
  | "dlp answer";

/**
 * Why a model didn't answer, in words an administrator can act on, with what went wrong, the status to
 * answer them with and the field of Set up Ember AI it's about, if one is: `wrongFormat` when the model
 * was refused in a way another format might not be, with Cloudflare's own word on that, if it gave one,
 * which the refusal ends with, in `cloudflareSays`.
 */
export interface GatewayRefusal {
  status: number;
  reason: RefusalReason;
  refusal: string;
  field?: AssistantField;
  wrongFormat?: boolean;
  cloudflareSays?: string;
}

export const GATEWAY_UNANSWERED = "AI Gateway didn't answer. Try again in a moment.";

/** Why AI Gateway's xAI endpoint didn't take Ember AI's API token: it takes only one with AI Gateway's Run permission. */
export const XAI_TOKEN_REFUSED =
  "Ember asks Grok through AI Gateway's xAI endpoint, which didn't take Ember AI's API token. Add the AI Gateway Run permission to the token in the Cloudflare dashboard, then try again.";

/** Why nothing paid for asking Grok through AI Gateway's xAI endpoint, where a key of xAI's own, kept by the gateway, can. */
export const XAI_UNPAID =
  "AI Gateway's credits can't pay for Grok through its xAI endpoint. Add an xAI API key under Provider Keys in the default gateway's settings in AI Gateway, then try again.";

/** Why AI Gateway's endpoint for each provider didn't take Ember AI's API token, which it takes only with AI Gateway Run, or nothing paid there. */
const PROVIDER_REFUSALS: Record<ProviderFormat, { token: string; unpaid: string }> = {
  xai: { token: XAI_TOKEN_REFUSED, unpaid: XAI_UNPAID },
  anthropic: {
    token:
      "Ember asks Claude through AI Gateway's Anthropic endpoint, which didn't take Ember AI's API token. Add the AI Gateway Run permission to the token in the Cloudflare dashboard, then try again.",
    unpaid:
      "AI Gateway's credits can't pay for Claude through its Anthropic endpoint. Add an Anthropic API key under Provider Keys in the default gateway's settings in AI Gateway, then try again.",
  },
  openai: {
    token:
      "Ember asks OpenAI's models through AI Gateway's OpenAI endpoint, which didn't take Ember AI's API token. Add the AI Gateway Run permission to the token in the Cloudflare dashboard, then try again.",
    unpaid:
      "AI Gateway's credits can't pay for OpenAI's models through its OpenAI endpoint. Add an OpenAI API key under Provider Keys in the default gateway's settings in AI Gateway, then try again.",
  },
};

export const NOTHING_ANSWERED = "The model answered with nothing. Try again, or choose another model.";
export const OUT_OF_ROOM = "The model took every token it could before it answered. Try again, or choose another model.";

/** A page a model's answer came from: its address, and its title, or "" without one. */
export interface Source {
  url: string;
  title: string;
}

/**
 * A model's answer: its text, whether it was cut short, as it took every token it could, and the pages
 * it came from, when it used the web: those it cites, then those it read.
 */
export interface Answered {
  text: string;
  cut?: true;
  sources?: Source[];
}

/**
 * What the model `gateway` names answers `question` in its format, or why it didn't, waiting at most
 * `timeoutMs` for it all. The model is told to think as much as the question asks, or as near to that as
 * the levels it takes allow, or not told, when it takes none (`thinkingTaken`). One that doesn't take
 * being told how much to think all the same, as a model Ember hasn't asked at each level might not, is
 * asked again without that, and then, as Search the web tries the web's tools when it's turned on,
 * without the one for reading pages, which AI Gateway may not have for every model, then without them,
 * told it can't use them, and last without the tools Ember runs, which every model Ember gives them
 * takes as far as its provider says.
 */
export async function ask(env: Env, gateway: Gateway, question: Question, timeoutMs: number): Promise<Answered | GatewayRefusal> {
  const signal = AbortSignal.timeout(timeoutMs);
  let asked = withThinkingTaken(question, gateway.thinkingLevels);
  let answered = await askOnce(env, gateway, asked, signal);
  if (isWrongFormat(answered) && asked.thinking !== undefined) {
    console.error(`Asking ${gateway.model} again without a thinking level, which it didn't take: ${answered.refusal}`);
    const { thinking: _, ...unthinking } = asked;
    asked = unthinking;
    answered = await askOnce(env, gateway, asked, signal);
  }
  const searching = asked.webTools?.filter((tool) => tool !== "read") ?? [];
  if (isWrongFormat(answered) && asked.webTools?.includes("read") && toolsFor(gateway.format, searching).length > 0) {
    console.error(`Asking ${gateway.model} to search again without reading pages, as AI Gateway didn't take that: ${answered.refusal}`);
    asked = { ...asked, instructions: asked.instructionsWithoutReading ?? asked.instructions, webTools: searching };
    answered = await askOnce(env, gateway, asked, signal);
  }
  if (isWrongFormat(answered) && toolsFor(gateway.format, asked.webTools).length > 0) {
    console.error(`Asking ${gateway.model} again without the web, whose tools AI Gateway didn't take: ${answered.refusal}`);
    asked = { ...asked, instructions: asked.instructionsWithoutWeb ?? asked.instructions, webTools: [] };
    answered = await askOnce(env, gateway, asked, signal);
  }
  if (!isWrongFormat(answered) || !asked.tools || asked.tools.length === 0) return answered;
  console.error(`Asking ${gateway.model} again without Ember's tools, which it didn't take: ${answered.refusal}`);
  return askOnce(env, gateway, { ...asked, tools: [] }, signal);
}

/** `question`, asking for the level of thinking a model that takes `taken` is asked for in place of its own (`thinkingTaken`), or for none. */
function withThinkingTaken(question: Question, taken: readonly ThinkingLevel[] | undefined): Question {
  const { thinking, ...unthinking } = question;
  const level = thinking && thinkingTaken(thinking, taken);
  return level ? { ...unthinking, thinking: level } : unthinking;
}

/**
 * The levels of thinking the model `gateway` names takes in its format, as it answers `question` at each,
 * all at once, waiting at most `timeoutMs`: each but those it's refused at as a request it can't take
 * (`wrongFormat`), as AI Gateway refuses what the model's provider doesn't, as xAI refuses any level for
 * Grok 4.20 Reasoning, which Cloudflare's catalog lists Low and High for, so that only asking says. One
 * it doesn't answer at for another reason, as when AI Gateway is busy, counts as one it takes, since
 * asking at it is then as it was before Ember asked at each, and `ask` asks again without it if it's
 * refused.
 */
export async function thinkingLevelsOf(env: Env, gateway: Gateway, question: Question, timeoutMs: number): Promise<ThinkingLevel[]> {
  const signal = AbortSignal.timeout(timeoutMs);
  const answers = await Promise.all(THINKING_LEVELS.map((thinking) => askOnce(env, gateway, { ...question, thinking }, signal)));
  const refusals = answers.map((answered) => (isWrongFormat(answered) ? answered : null));
  const first = refusals.find((refusal) => refusal !== null);
  if (first) console.log(`${gateway.model} isn't told to think at ${THINKING_LEVELS.filter((_, index) => refusals[index]).join(", ")}, which it refused: ${first.cloudflareSays ?? first.refusal}`);
  return THINKING_LEVELS.filter((_, index) => !refusals[index]);
}

/**
 * What the model `gateway` names answers `question`, asked as it is, until `signal` says it's waited long
 * enough: once, unless it calls tools Ember runs, when it's asked again with what each call came to, for
 * as many calls as an answer may make, and then told to answer. All its turns share the answer's tokens,
 * and its provider's tools the uses an answer allows, and one that calls a tool with too few tokens left
 * to go on took every token it could.
 */
export async function askOnce(env: Env, gateway: Gateway, question: Question, signal: AbortSignal): Promise<Answered | GatewayRefusal> {
  const { format } = gateway;
  const tools = question.tools ?? [];
  const saidBefore: unknown[] = [];
  let request = requestOf(gateway, question);
  let tokensLeft = question.maxTokens;
  let called = 0;
  for (;;) {
    const turn = await turnOf(env, gateway, question, request, tokensLeft, signal);
    if ("refusal" in turn) return turn;
    tokensLeft = turn.tokensLeft;
    const calls = called < TOOL_CALLS_PER_ANSWER ? toolCallsIn(format, turn.body) : [];
    // Messages' sources are in what the model said in any turn, and its answer in what it said after its last call.
    const said = isMessages(format) && isObject(turn.body) ? { ...turn.body, content: [...saidBefore, ...listOf(turn.body.content)] } : turn.body;
    if (tools.length === 0 || calls.length === 0 || !isObject(turn.body)) return answeredIn(format, said);
    if (tokensLeft < LEAST_TOKENS) return { status: 502, reason: "out of room", refusal: OUT_OF_ROOM, field: "model" };
    const results = await resultsOf(tools, calls, TOOL_CALLS_PER_ANSWER - called);
    called += calls.length;
    request = withRoom(format, goingOn(format, sparing(format, request, turn.body), turn.body, results), tokensLeft, called >= TOOL_CALLS_PER_ANSWER);
    saidBefore.push(...listOf(turn.body.content));
  }
}

/**
 * One turn of the model `gateway` names, asked `request`, with `tokensLeft` of its answer's tokens: what
 * it answers, and the tokens left after it. Anthropic's model may pause a turn while it searches, in
 * Messages, which Ember carries on while the turn has tokens left, so its answer is all the turn said.
 * One that paused with none left took every token it could.
 */
async function turnOf(
  env: Env,
  gateway: Gateway,
  question: Question,
  request: Record<string, unknown>,
  tokensLeft: number,
  signal: AbortSignal,
): Promise<{ body: unknown; tokensLeft: number } | GatewayRefusal> {
  let said: unknown[] = [];
  for (let continued = 0; ; continued++) {
    const answered = await send(env, gateway, question, continued === 0 ? request : carryingOn(request, said, tokensLeft), signal);
    if ("refusal" in answered) return answered;
    tokensLeft -= writtenIn(gateway.format, answered.body);
    if (!isMessages(gateway.format) || !isObject(answered.body)) return { body: answered.body, tokensLeft };
    // Each part of a turn says what's new since the last, which is sent back as it is to carry on.
    said = [...said, ...listOf(answered.body.content)];
    const paused = answered.body.stop_reason === "pause_turn";
    if (paused && tokensLeft < 1) return { body: { ...answered.body, content: said, stop_reason: "max_tokens" }, tokensLeft };
    if (!paused || continued === MAX_CONTINUATIONS) return { body: { ...answered.body, content: said }, tokensLeft };
  }
}

/**
 * `request`, to Messages, carrying on the turn its model paused once it had `said` what it did, which goes
 * back as it is. Each request may write as many tokens as its `max_tokens`, so that's lowered to what the
 * turn has left, `tokensLeft` of its tokens, and its provider's tools are left the uses the turn hasn't
 * made (`usesLeft`).
 */
function carryingOn(request: Record<string, unknown>, said: unknown[], tokensLeft: number): Record<string, unknown> {
  return { ...request, max_tokens: tokensLeft, messages: [...(request.messages as unknown[]), { role: "assistant", content: said }], ...usesLeft(request, said) };
}

/**
 * What `request`, to Messages, asks of its tools once its model has `said` what it did: each request may
 * use a tool of its provider's as many times as its `max_uses`, so that's lowered by the uses made, and
 * once one is used up, which stays among the tools as the answer used it, the model is told to use no
 * tool and answer with what it found.
 */
function usesLeft(request: Record<string, unknown>, said: readonly unknown[]): Record<string, unknown> {
  const usesOf = (name: unknown) => said.filter((block) => isObject(block) && block.type === "server_tool_use" && block.name === name).length;
  const tools = listOf(request.tools).filter(isObject).map((tool) => ({ tool, left: typeof tool.max_uses === "number" ? tool.max_uses - usesOf(tool.name) : null }));
  return {
    ...(tools.length > 0 && { tools: tools.map(({ tool, left }) => (left === null ? tool : { ...tool, max_uses: Math.max(1, left) })) }),
    ...(tools.some(({ left }) => left !== null && left < 1) && { tool_choice: { type: "none" } }),
  };
}

/**
 * `request`, in `format`, leaving its provider's tools the uses its answer has left once a turn answered
 * `body`, for the turn that goes on from a call of Ember's tools: Messages' tools by their `max_uses`,
 * and the web searches of OpenAI's Responses, and xAI's, by the cap each puts on a request's. Once they're
 * used up, the model is told to call no tool and answer.
 */
function sparing(format: ModelFormat, request: Record<string, unknown>, body: Record<string, unknown>): Record<string, unknown> {
  if (isMessages(format)) return { ...request, ...usesLeft(request, listOf(body.content)) };
  const cap = format === "xai" ? "max_turns" : "max_tool_calls";
  const allowed = request[cap];
  if (!isResponses(format) || typeof allowed !== "number") return request;
  const left = allowed - listOf(body.output).filter((item) => isObject(item) && item.type === "web_search_call").length;
  return { ...request, [cap]: Math.max(1, left), ...(left < 1 && { tool_choice: "none" }) };
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Whether `answered` is a refusal that a model asked another way might not give. */
const isWrongFormat = (answered: Answered | GatewayRefusal): answered is GatewayRefusal => "refusal" in answered && answered.wrongFormat === true;

/** What AI Gateway answers `request`, which asks `question` of the model `gateway` names, or why it refused, by `signal`. */
async function send(env: Env, gateway: Gateway, question: Question, request: Record<string, unknown>, signal: AbortSignal): Promise<{ body: unknown } | GatewayRefusal> {
  const provider = isProviderFormat(gateway.format) ? gateway.format : null;
  let response: Response;
  try {
    response = await fetch(addressOf(env, gateway), {
      method: "POST",
      headers: {
        // A provider's endpoint would take a token in Authorization as the provider's own key, and pass it on.
        ...(provider ? { "cf-aig-authorization": `Bearer ${gateway.apiToken}` } : { Authorization: `Bearer ${gateway.apiToken}`, "cf-aig-gateway-id": GATEWAY_ID }),
        ...(provider === "anthropic" && { "anthropic-version": ANTHROPIC_VERSION }),
        "Content-Type": "application/json",
        ...metadataOf(question),
      },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    console.error("Asking AI Gateway failed:", error instanceof Error ? error.name : "unknown error");
    return { status: 502, reason: "unanswered", refusal: GATEWAY_UNANSWERED };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return { body };
  return provider ? providerRefusalOf(provider, response.status, body) : refusalOf(response.status, body);
}

/** Where a request asking the model `gateway` names in its format goes: Cloudflare's REST API, or the default gateway's endpoint for the model's provider. */
function addressOf(env: Env, { accountId, format }: Gateway): string {
  return isProviderFormat(format) ? `${providerEndpointsOf(env)}/${accountId}/${GATEWAY_ID}/${PATHS[format]}` : `${cloudflareApiOf(env)}/accounts/${accountId}/ai/v1/${PATHS[format]}`;
}

/** The custom metadata AI Gateway keeps of a request asking `question`: who asked and who answers, of those it names, if it names either. */
function metadataOf({ askerId, agentId }: Question): Record<string, string> {
  const metadata = { ...(askerId !== undefined && { user_id: askerId }), ...(agentId !== undefined && { agent_id: agentId }) };
  return Object.keys(metadata).length > 0 ? { "cf-aig-metadata": JSON.stringify(metadata) } : {};
}

/** The answer `body` gives in `format`, or why it's none: the model said nothing, or took every token it could first. */
function answeredIn(format: ModelFormat, body: unknown): Answered | GatewayRefusal {
  const text = answerIn(format, body)?.trim();
  const cut = ranOutIn(format, body);
  const sources = sourcesIn(format, body);
  if (text) return { text, ...(cut && { cut: true as const }), ...(sources.length > 0 && { sources }) };
  return cut ? { status: 502, reason: "out of room", refusal: OUT_OF_ROOM, field: "model" } : { status: 502, reason: "nothing", refusal: NOTHING_ANSWERED, field: "model" };
}

/** Where Cloudflare's API is: the browser tests' stand-in, which `AI_GATEWAY_URL` names at a loopback address, or Cloudflare's own. */
export function cloudflareApiOf(env: Env): string {
  return standInOf(env) ?? CLOUDFLARE_API;
}

/** Where AI Gateway's endpoints for each provider are: the browser tests' stand-in, under `/v1`, or Cloudflare's own. */
function providerEndpointsOf(env: Env): string {
  const standIn = standInOf(env);
  return standIn ? `${standIn}/v1` : PROVIDER_ENDPOINTS;
}

/** The origin of the browser tests' stand-in for Cloudflare, which `AI_GATEWAY_URL` names at a loopback address, or null without one. */
function standInOf(env: Env): string | null {
  const standIn = URL.parse(env.AI_GATEWAY_URL?.trim() ?? "");
  return standIn && isLoopback(standIn) ? standIn.origin : null;
}

/**
 * The body of a request asking `question` in `gateway`'s format, telling the model how much to think as
 * the format does: Anthropic's adaptive thinking at an effort, whose lowest is as little as their models
 * think, OpenAI's reasoning effort, which xAI's Responses takes too, or Chat Completions'
 * `reasoning_effort`, "none" for no thinking. A model that may use the web is given the format's tools
 * for what it may do there, and any model the tools Ember runs for it, after those. A provider's own
 * format names the model as the provider does (`modelIn`), and OpenAI's and xAI's ask the provider not
 * to keep the conversation, which each keeps for 30 days unless it's told not to, so a model given
 * Ember's tools there is asked for its thinking in a form Ember can send back with what a call came to.
 */
function requestOf({ model, format }: Gateway, { instructions, turns, maxTokens, thinking, webTools, tools: embers = [] }: Question): Record<string, unknown> {
  const effort = thinking === "off" ? "none" : thinking;
  const tools = toolsFor(format, webTools);
  const withTools = tools.length + embers.length > 0 && { tools: [...tools, ...toolsIn(format, embers)] };
  const named = modelIn(format, model);
  if (isMessages(format)) {
    const messages = alternating(turns).map(({ role, text }) => ({ role, content: text }));
    const thinks = effort && { thinking: { type: "adaptive" }, output_config: { effort: effort === "none" ? "low" : effort } };
    return { model: named, max_tokens: maxTokens, system: instructions, messages, ...thinks, ...withTools };
  }
  if (isResponses(format)) {
    const input = turns.map(({ role, text }) => ({ role, content: text }));
    const unkept = format !== "responses" && { store: false, ...(embers.length > 0 && { include: ["reasoning.encrypted_content"] }) };
    const asked = { model: named, max_output_tokens: maxTokens, instructions, input, ...(effort && { reasoning: { effort } }), ...withTools, ...unkept };
    // OpenAI's web search is its only built-in tool, so its calls of built-in tools are its searches.
    if (format !== "xai") return { ...asked, ...(tools.length > 0 && { max_tool_calls: WEB_SEARCHES_PER_ANSWER }) };
    // xAI caps the turns its tools take, each of which may search more than once unless they take one at a time.
    return { ...asked, ...(tools.length > 0 && { max_turns: WEB_SEARCHES_PER_ANSWER, parallel_tool_calls: false }) };
  }
  return {
    model,
    max_completion_tokens: maxTokens,
    messages: [{ role: "system", content: instructions }, ...turns.map(({ role, text }) => ({ role, content: text }))],
    ...(effort && { reasoning_effort: effort }),
    ...(embers.length > 0 && { tools: toolsIn(format, embers) }),
  };
}

/**
 * `model`, by Cloudflare's ID for it, as `format` names it: as Anthropic does, without `anthropic/` and
 * with dashes for its dots, `claude-sonnet-5-5` for `anthropic/claude-sonnet-5.5`, as OpenAI and xAI do,
 * without their `openai/` and `xai/`, or as Cloudflare's REST API does, by that ID.
 */
export function modelIn(format: ModelFormat, model: string): string {
  const without = (prefix: string) => (model.startsWith(prefix) ? model.slice(prefix.length) : model);
  if (format === "anthropic") return without("anthropic/").replaceAll(".", "-");
  if (format === "openai") return without("openai/");
  return format === "xai" ? without("xai/") : model;
}

/**
 * The tools that let a model in `format` do on the web what `webTools` says it may, of what the format
 * has tools for: Anthropic's basic web search and web fetch, which every Claude model takes, each used no
 * more than an answer allows, or OpenAI's web search, or xAI's, which has its name.
 */
export function toolsFor(format: ModelFormat, webTools: readonly WebTool[] = []): Record<string, unknown>[] {
  const may = (tool: WebTool) => webTools.includes(tool) && WEB_TOOLS_IN[format].includes(tool);
  if (!isMessages(format)) return may("search") ? [{ type: "web_search" }] : [];
  return [
    ...(may("search") ? [{ type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCHES_PER_ANSWER }] : []),
    ...(may("read") ? [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: PAGES_READ_PER_ANSWER, max_content_tokens: PAGE_TOKENS }] : []),
  ];
}

/**
 * `turns` as Anthropic's Messages takes them: starting with someone's, and taking turns, so that what
 * several people wrote in a row is one turn, a blank line apart.
 */
export function alternating(turns: Turn[]): Turn[] {
  const merged: Turn[] = [];
  for (const turn of turns) {
    const last = merged.at(-1);
    if (last?.role === turn.role) last.text = `${last.text}\n\n${turn.text}`;
    else if (last || turn.role === "user") merged.push({ ...turn });
  }
  return merged;
}

/**
 * The text of a model's answer in `format`, leaving out its thinking, and what it said before it last
 * used a tool, which says what it'll look for, or null without any.
 */
function answerIn(format: ModelFormat, body: unknown): string | null {
  if (!isObject(body)) return null;
  if (isMessages(format)) return textOf(answeringBlocks(body.content), "text");
  if (isResponses(format)) {
    const messages = answeringMessages(body.output);
    return messages.map((message) => textOf(message.content, "output_text") ?? "").join("") || (typeof body.output_text === "string" ? body.output_text : null);
  }
  const [choice] = Array.isArray(body.choices) ? body.choices : [];
  const content = isObject(choice) && isObject(choice.message) ? choice.message.content : null;
  return typeof content === "string" ? content : textOf(content, "text");
}

/** Whether a model's answer in `format` stopped where it did because it took every token it could. */
function ranOutIn(format: ModelFormat, body: unknown): boolean {
  if (!isObject(body)) return false;
  if (isMessages(format)) return body.stop_reason === "max_tokens";
  if (isResponses(format)) return body.status === "incomplete" && isObject(body.incomplete_details) && body.incomplete_details.reason === "max_output_tokens";
  const [choice] = Array.isArray(body.choices) ? body.choices : [];
  return isObject(choice) && choice.finish_reason === "length";
}

/** The text of the parts of `content` whose type is `type`, joined, or null without any. */
function textOf(content: unknown, type: string): string | null {
  if (!Array.isArray(content)) return null;
  const texts = content.filter((part) => isObject(part) && part.type === type && typeof part.text === "string").map((part) => part.text as string);
  return texts.length > 0 ? texts.join("") : null;
}

/** The blocks of a Messages answer's `content` after its last use of a tool, and what came of it, or all of them without one. */
function answeringBlocks(content: unknown): Record<string, unknown>[] {
  const blocks = Array.isArray(content) ? content.filter(isObject) : [];
  const lastTool = blocks.findLastIndex(({ type }) => typeof type === "string" && /tool_(?:use|result)$/.test(type));
  return blocks.slice(lastTool + 1);
}

/** The messages of a Responses answer's `output` after its last call of a tool, or all of them without one. */
function answeringMessages(output: unknown): Record<string, unknown>[] {
  const items = Array.isArray(output) ? output.filter(isObject) : [];
  const lastCall = items.findLastIndex(({ type }) => typeof type === "string" && type.endsWith("_call"));
  return items.slice(lastCall + 1).filter(({ type }) => type === "message");
}

/**
 * The pages a model's answer in `format` came from, each once, in the order it came to them, no more
 * than an answer names: the search results its words cite, then the pages it read, as Anthropic's
 * Messages has them, or the pages its words cite in OpenAI's Responses, or xAI's.
 */
function sourcesIn(format: ModelFormat, body: unknown): Source[] {
  if (!isObject(body)) return [];
  const sources = isMessages(format) ? messagesSources(body.content) : isResponses(format) ? responsesSources(body.output) : [];
  const named = new Set<string>();
  const unnamed = ({ url }: Source) => {
    if (named.has(url)) return false;
    named.add(url);
    return true;
  };
  return sources.filter(unnamed).slice(0, MAX_SOURCES);
}

/** The search results the answer in a Messages `content` cites, then the pages its model read. */
function messagesSources(content: unknown): Source[] {
  const blocks = Array.isArray(content) ? content.filter(isObject) : [];
  const cited = answeringBlocks(blocks)
    .flatMap(({ citations }) => (Array.isArray(citations) ? citations.filter(isObject) : []))
    .map(({ url, title }) => sourceOf(url, title));
  const read = blocks.map((block) => {
    const result = block.type === "web_fetch_tool_result" && isObject(block.content) ? block.content : null;
    return result?.type === "web_fetch_result" ? sourceOf(result.url, isObject(result.content) ? result.content.title : null) : null;
  });
  return [...cited, ...read].filter((source) => source !== null);
}

/**
 * The pages the answer in a Responses `output` cites, by their titles, but for the numbers xAI titles
 * them by, which the answer shows its citations as, and which name no page.
 */
function responsesSources(output: unknown): Source[] {
  const titleOf = (title: unknown) => (typeof title === "string" && /^\d+$/.test(title.trim()) ? null : title);
  return answeringMessages(output)
    .flatMap(({ content }) => (Array.isArray(content) ? content.filter(isObject) : []))
    .flatMap(({ annotations }) => (Array.isArray(annotations) ? annotations.filter(isObject) : []))
    .map((annotation) => (annotation.type === "url_citation" ? sourceOf(annotation.url, titleOf(annotation.title)) : null))
    .filter((source) => source !== null);
}

/** A source at `url` titled `title`, or null when `url` isn't an address. */
const sourceOf = (url: unknown, title: unknown): Source | null =>
  typeof url === "string" && url.trim() !== "" ? { url: url.trim(), title: typeof title === "string" ? title.trim() : "" } : null;

/**
 * Why AI Gateway refused a request with `status`, from its `body`, which is Cloudflare's, with errors and
 * their codes, or the format's own, with an error, and says in words what to do, with Cloudflare's own.
 */
export function refusalOf(status: number, body: unknown): GatewayRefusal {
  const { codes, message } = errorIn(body);
  const said = (lead: string) => (message ? `${lead} Cloudflare says: ${quoted(message)}` : lead);
  if (status === 401 || (status === 403 && codes.includes(10000))) {
    const refusal = said("Cloudflare didn't take that API token for this account. Check the account ID, and that the token has the Workers AI Read permission.");
    return { status: 422, reason: "token", field: "apiToken", refusal };
  }
  if (isUnroutable(codes, message)) {
    return { status: 422, reason: "account", field: "accountId", refusal: said("Cloudflare has no account with that ID that the token can reach.") };
  }
  const blocked = BLOCKS.find(({ code }) => codes.includes(code));
  if (blocked) return { status: 422, reason: blocked.reason, refusal: said(blocked.refusal) };
  if (status === 402) {
    const refusal = said("This model is paid for with AI Gateway's credits, and there aren't enough. Top them up under Credits Available in AI Gateway.");
    return { status: 422, reason: "credits", refusal };
  }
  if (status === 403) return { status: 422, reason: "model", field: "model", refusal: said("Cloudflare won't run that model for this account.") };
  if (status === 413) return { status: 422, reason: "too long", refusal: said("The model can't read that much at once.") };
  if (status === 400 || status === 404 || status === 422) {
    return { status: 422, reason: "model", field: "model", refusal: said("AI Gateway didn't take that model."), wrongFormat: true, ...(message && { cloudflareSays: quoted(message) }) };
  }
  if (status === 429) return { status: 429, reason: "busy", refusal: said("AI Gateway is turning requests away for now, or a spend limit was reached. Try again later.") };
  return { status: 502, reason: "unanswered", refusal: said(GATEWAY_UNANSWERED) };
}

/**
 * Why AI Gateway's endpoint for the provider whose format is `format` refused a request with `status`, as
 * Cloudflare's REST API would (`refusalOf`), but for an API token it doesn't take, as it takes only one
 * with AI Gateway Run, which the REST API doesn't need, and nothing paying for the request, as AI
 * Gateway's credits don't when Unified Billing isn't there for it (2049) or the gateway asks for a
 * provider's own key (2044).
 */
function providerRefusalOf(format: ProviderFormat, status: number, body: unknown): GatewayRefusal {
  const { codes, message } = errorIn(body);
  const said = (lead: string) => (message ? `${lead} Cloudflare says: ${quoted(message)}` : lead);
  const { token, unpaid } = PROVIDER_REFUSALS[format];
  if (codes.includes(2049) || codes.includes(2044) || isUnkeyed(body)) return { status: 422, reason: "credits", refusal: said(unpaid) };
  if (status === 401 || (status === 403 && codes.includes(10000))) return { status: 422, reason: "token", field: "apiToken", refusal: said(token) };
  return refusalOf(status, body);
}

/**
 * Whether the provider itself refused a request AI Gateway passed on with no key of the provider's, as
 * xAI does when the gateway's credits don't pay for Grok at its endpoint, which took the API token:
 * `{"code":"unauthenticated:no-credentials","error":"No credentials presented."}`.
 */
const isUnkeyed = (body: unknown) => isObject(body) && body.code === "unauthenticated:no-credentials";

/**
 * Whether Cloudflare's API couldn't route a request to the account, as for an ID it has no account
 * with: 7000, "No route for that URI", or 7003, "Could not route to /client/v4/accounts/…, perhaps your
 * object identifier is invalid?". AI Gateway answers 7003 too, as its code for a request it or the
 * model's provider refuses as invalid, "Model execution failed (User Input Error): …", as xAI refuses a
 * thinking level for a model that doesn't take one, which is the model's doing, not the account's.
 */
const isUnroutable = (codes: number[], message: string | null) => codes.includes(7000) || (codes.includes(7003) && /^Could not route to /.test(message ?? ""));

/**
 * What the gateway's Guardrails and Data Loss Prevention block, by the code of the error AI Gateway
 * answers with, which Guardrails send with a 424: the request, which holds the conversation the model was
 * to read as well as the question, or the model's answer. Asking again, or in another format, would be
 * blocked the same, so nothing is.
 */
const BLOCKS: ReadonlyArray<{ code: number; reason: RefusalReason; refusal: string }> = [
  { code: 2016, reason: "guardrails", refusal: "AI Gateway's Guardrails blocked the question. Change what they block in AI Gateway." },
  { code: 2017, reason: "guardrails answer", refusal: "AI Gateway's Guardrails blocked the model's answer. Change what they block in AI Gateway." },
  { code: 2029, reason: "dlp", refusal: "AI Gateway's Data Loss Prevention blocked the question. Change its policies in AI Gateway." },
  { code: 2030, reason: "dlp answer", refusal: "AI Gateway's Data Loss Prevention blocked the model's answer. Change its policies in AI Gateway." },
];

/**
 * The codes and the first message of the errors in a refusal's body, in any of the shapes AI Gateway
 * answers with: Cloudflare's API's `errors`, the provider endpoints' `error` list, or a format's own `error`.
 */
function errorIn(body: unknown): { codes: number[]; message: string | null } {
  if (!isObject(body)) return { codes: [], message: null };
  const errors = (Array.isArray(body.errors) ? body.errors : Array.isArray(body.error) ? body.error : []).filter(isObject);
  const codes = errors.map(({ code }) => code).filter((code): code is number => typeof code === "number");
  const error = isObject(body.error) ? body.error.message : body.error;
  const message = [errors[0]?.message, error, body.message].find((text): text is string => typeof text === "string" && text.trim() !== "");
  return { codes, message: message?.trim() ?? null };
}

/** `message` cut to what Ember passes on. */
const quoted = (message: string) => (message.length > MAX_QUOTED_LENGTH ? `${message.slice(0, MAX_QUOTED_LENGTH - 1).trimEnd()}…` : message);
