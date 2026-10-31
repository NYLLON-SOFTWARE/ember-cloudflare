import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AI_GATEWAY_ACCOUNT, AI_GATEWAY_PORT } from "../../projects/workspace-settings";

// Cloudflare's AI REST API for the Ember AI spec, at the address the second test server's AI_GATEWAY_URL
// names, as Ember asks it (apps/worker/src/assistant/gateway.ts): it knows one account,
// `AI_GATEWAY_ACCOUNT`, and that account's API token, and answers a request in any of AI Gateway's three
// formats with `HELLO` in that format, refusing as Cloudflare does an account or a token it doesn't know.

/** What every model says, whatever it's asked. */
export const HELLO = "Hello, team! Mention @ember whenever you'd like a hand.";

/** What Ember asked AI Gateway: where, with which token and gateway, and what. */
export interface GatewayAsked {
  path: string;
  authorization: string | undefined;
  gateway: string | undefined;
  body: Record<string, unknown>;
}

export interface FakeGateway {
  /** What it was asked, in order. */
  asked: GatewayAsked[];
  close(): Promise<void>;
}

/** Starts AI Gateway. */
export async function startFakeGateway(): Promise<FakeGateway> {
  const asked: GatewayAsked[] = [];
  const server = createServer((request, response) => {
    answer(request, response, asked).catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(AI_GATEWAY_PORT, "127.0.0.1", resolve));
  return { asked, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

/** Each format's path under an account, with its answer saying `HELLO`. */
const ANSWERS: Record<string, unknown> = {
  "chat/completions": { object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: HELLO }, finish_reason: "stop" }] },
  messages: { type: "message", role: "assistant", content: [{ type: "text", text: HELLO }], stop_reason: "end_turn" },
  responses: { object: "response", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: HELLO }] }] },
};

async function answer(request: IncomingMessage, response: ServerResponse, asked: GatewayAsked[]): Promise<void> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  const path = request.url ?? "";
  asked.push({ path, authorization: request.headers.authorization, gateway: request.headers["cf-aig-gateway-id"] as string | undefined, body: JSON.parse(body) as Record<string, unknown> });
  const [, account, format] = path.match(/^\/accounts\/([^/]+)\/ai\/v1\/(.+)$/) ?? [];
  const reply = (status: number, data: unknown) => void response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
  if (account !== AI_GATEWAY_ACCOUNT.accountId) {
    return reply(400, { success: false, errors: [{ code: 7003, message: `Could not route to /client/v4${path}, perhaps your object identifier is invalid?` }] });
  }
  if (request.headers.authorization !== `Bearer ${AI_GATEWAY_ACCOUNT.apiToken}`) return reply(401, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });
  const answered = format === undefined ? undefined : ANSWERS[format];
  if (answered === undefined) return reply(404, { success: false, errors: [{ code: 7000, message: "No route for that URI" }] });
  reply(200, answered);
}
