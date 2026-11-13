import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AI_GATEWAY_ACCOUNT, AI_GATEWAY_PORT } from "../../projects/workspace-settings";

// AI Gateway for the Ember AI specs, at the address the second test server's AI_GATEWAY_URL names, as Ember
// asks it (apps/worker/src/assistant/gateway.ts): the default gateway's endpoints for Anthropic, OpenAI
// and xAI, where Ember asks the models it offers in their providers' own APIs, of one account,
// `AI_GATEWAY_ACCOUNT`, taking that account's API token in AI Gateway's own header alone, and Cloudflare's
// REST API, where Ember asks a model kept from before it offered only those, in any of its three formats.
// It answers with `HELLO` in the format asked, or, given a tool for searching the web in Messages or
// Responses, with `FOUND`, citing `SOURCE`, as the model would once it had searched, or, asked
// `CARD_QUESTION` last, with `CARDED` and a card's Slack payload, refusing as Cloudflare does an account or
// a token it doesn't know. A spec can hold its answers, to see what shows while a model answers.

/** What every model says, whatever it's asked. */
export const HELLO = "Hello, team! Mention @ember whenever you'd like a hand.";

/** What a model that searched the web says, and the page it cites. */
export const FOUND = "AI Gateway is Cloudflare's proxy for requests to AI models.";
export const SOURCE = { url: "https://developers.cloudflare.com/ai-gateway/", title: "Overview · Cloudflare AI Gateway docs" };

/**
 * What a model asked `CARD_QUESTION` says, `CARDED`, then a status card's Slack payload in a ```slack block,
 * which Ember shows as a card headed `CARD_HEADER` under the answer, its button linking to `CARD_LINK`.
 */
export const CARD_QUESTION = "How's the launch going? Show me a card.";
export const CARDED = "Here's where the launch stands.";
export const CARD_HEADER = "Launch status";
export const CARD_LINK = "https://plans.example/launch";
const CARD_PAYLOAD = {
  blocks: [
    { type: "header", text: { type: "plain_text", text: CARD_HEADER } },
    { type: "section", fields: [{ type: "mrkdwn", text: "*Stage:*\nBeta" }, { type: "mrkdwn", text: "*Owner:*\nAda" }] },
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open the plan" }, url: CARD_LINK, style: "primary" }] },
  ],
};

/** What Ember asked AI Gateway: where, with which token, as Cloudflare's API or AI Gateway's endpoints for each provider take it, and gateway, and what. */
export interface GatewayAsked {
  path: string;
  authorization: string | undefined;
  aigAuthorization: string | undefined;
  gateway: string | undefined;
  body: Record<string, unknown>;
}

/** Where the account's default gateway passes requests on to Anthropic's own Messages, OpenAI's own Responses and xAI's. */
export const ANTHROPIC_PATH = `/v1/${AI_GATEWAY_ACCOUNT.accountId}/default/anthropic/v1/messages`;
const OPENAI_PATH = `/v1/${AI_GATEWAY_ACCOUNT.accountId}/default/openai/responses`;
export const XAI_PATH = `/v1/${AI_GATEWAY_ACCOUNT.accountId}/default/grok/v1/responses`;
/** Where Cloudflare's REST API takes requests in Chat Completions, as Ember asks Grok while it isn't to search. */
export const CHAT_COMPLETIONS_PATH = `/accounts/${AI_GATEWAY_ACCOUNT.accountId}/ai/v1/chat/completions`;

/** The format of Cloudflare's REST API whose answers each provider's endpoint answers with, by its path. */
const PROVIDER_PATHS: Record<string, string> = { [ANTHROPIC_PATH]: "messages", [OPENAI_PATH]: "responses", [XAI_PATH]: "responses" };

export interface FakeGateway {
  /** What it was asked, in order. */
  asked: GatewayAsked[];
  /** Holds back its answers until the function it returns is called, or it closes. */
  hold(): () => void;
  close(): Promise<void>;
}

/** Starts AI Gateway. */
export async function startFakeGateway(): Promise<FakeGateway> {
  const asked: GatewayAsked[] = [];
  let held = Promise.resolve();
  let release = () => {};
  const server = createServer((request, response) => {
    answer(request, response, asked, held).catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(AI_GATEWAY_PORT, "127.0.0.1", resolve));
  const hold = () => {
    held = new Promise<void>((resolve) => (release = resolve));
    return release;
  };
  // Closing answers what it holds, as a spec that fails while it holds answers never lets them go.
  const close = () => {
    release();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { asked, hold, close };
}

/** Each format's path under an account, with its answer saying `text`. */
const answersSaying = (text: string): Record<string, unknown> => ({
  "chat/completions": { object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] },
  messages: { type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn" },
  responses: { object: "response", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] },
});

const ANSWERS = answersSaying(HELLO);
const CARD_ANSWERS = answersSaying(`${CARDED}\n\n\`\`\`slack\n${JSON.stringify(CARD_PAYLOAD, null, 2)}\n\`\`\``);

/** The paths of the formats with a tool for searching the web, with the answer saying `FOUND` once the model has searched. */
const SEARCHED_ANSWERS: Record<string, unknown> = {
  messages: {
    type: "message",
    role: "assistant",
    content: [
      { type: "text", text: "I'll look that up." },
      { type: "server_tool_use", id: "srvtoolu_e2e", name: "web_search", input: { query: "Cloudflare AI Gateway" } },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_e2e", content: [{ type: "web_search_result", ...SOURCE, encrypted_content: "e2e", page_age: null }] },
      { type: "text", text: FOUND, citations: [{ type: "web_search_result_location", ...SOURCE, encrypted_index: "e2e", cited_text: FOUND }] },
    ],
    stop_reason: "end_turn",
  },
  responses: {
    object: "response",
    output: [
      { type: "web_search_call", id: "ws_e2e", status: "completed", action: { type: "search", query: "Cloudflare AI Gateway" } },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: FOUND, annotations: [{ type: "url_citation", ...SOURCE, start_index: 0, end_index: FOUND.length }] }] },
    ],
  },
};

/** Whether the last message `body` asks, in any format, is `CARD_QUESTION`, whatever came before it in the conversation. */
function asksForCard(body: Record<string, unknown>): boolean {
  const turns: unknown[] = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : [];
  return JSON.stringify(turns.at(-1) ?? null).includes(CARD_QUESTION);
}

/** Whether `body` gives the model a tool for searching the web, as Anthropic's and OpenAI's are named. */
const searches = (body: Record<string, unknown>) =>
  Array.isArray(body.tools) && body.tools.some((tool: { type?: unknown }) => typeof tool.type === "string" && tool.type.startsWith("web_search"));

async function answer(request: IncomingMessage, response: ServerResponse, asked: GatewayAsked[], held: Promise<void>): Promise<void> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  await held;
  const path = request.url ?? "";
  const gateway = request.headers["cf-aig-gateway-id"] as string | undefined;
  const aigAuthorization = request.headers["cf-aig-authorization"] as string | undefined;
  const sent = body === "" ? {} : (JSON.parse(body) as Record<string, unknown>);
  asked.push({ path, authorization: request.headers.authorization, aigAuthorization, gateway, body: sent });
  const [, account, endpoint] = path.match(/^\/accounts\/([^/]+)\/ai\/([^?]+)/) ?? [];
  const reply = (status: number, data: unknown) => void response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
  const provider = PROVIDER_PATHS[path];
  if (provider !== undefined) {
    // It would pass a token in Authorization on to the provider, as a key of the account's own there.
    if (aigAuthorization !== `Bearer ${AI_GATEWAY_ACCOUNT.apiToken}` || request.headers.authorization !== undefined) return reply(401, { success: false, error: [{ code: 2009, message: "Unauthorized" }] });
    return reply(200, (searches(sent) && SEARCHED_ANSWERS[provider]) || (asksForCard(sent) ? CARD_ANSWERS : ANSWERS)[provider]);
  }
  if (account !== AI_GATEWAY_ACCOUNT.accountId) {
    return reply(400, { success: false, errors: [{ code: 7003, message: `Could not route to /client/v4${path}, perhaps your object identifier is invalid?` }] });
  }
  if (request.headers.authorization !== `Bearer ${AI_GATEWAY_ACCOUNT.apiToken}`) return reply(401, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });
  const format = endpoint?.startsWith("v1/") ? endpoint.slice("v1/".length) : undefined;
  const answers = asksForCard(sent) ? CARD_ANSWERS : ANSWERS;
  const answered = format === undefined ? undefined : ((searches(sent) && SEARCHED_ANSWERS[format]) || answers[format]);
  if (answered === undefined) return reply(404, { success: false, errors: [{ code: 7000, message: "No route for that URI" }] });
  reply(200, answered);
}
