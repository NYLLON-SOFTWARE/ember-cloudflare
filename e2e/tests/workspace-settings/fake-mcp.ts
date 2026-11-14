import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for an app's MCP server, which the apps spec connects: it speaks the Model Context Protocol
// over Streamable HTTP as far as Ember asks it (apps/worker/src/apps/mcp.ts), answering `initialize`
// with what it calls itself, taking the notification that follows, listing its tools, and answering a
// call of one with `calledWith`, to whoever sends its token. It serves on this machine, where Ember
// asks an app over http.

/** What the server calls itself. */
export const SERVER_NAME = "Tracker";

/** The token the server takes, as a bearer token. */
export const MCP_TOKEN = "e2e-mcp-token";

/** What the server answers a call of `name` with `given`, as text. */
export const calledWith = (name: string, given: unknown) => `${name} ran with ${JSON.stringify(given)}`;

/** A tool as the server lists it. */
export interface ListedTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** The tools the server lists at first. */
export const TOOLS: ListedTool[] = [
  { name: "search_issues", title: "Search issues", description: "Finds issues by their words.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "create_issue", description: "Opens an issue in a project.", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
];

export interface FakeMcp {
  /** Where the server is. */
  url: string;
  /** The tools it lists, which a spec may change. */
  tools: ListedTool[];
  /** The JSON-RPC methods it was asked, in order. */
  asked: string[];
  /** The calls of its tools it ran, in order: each tool's name and what it was called with. */
  calls: Array<{ name: string; arguments: unknown }>;
  close: () => Promise<void>;
}

interface Message {
  id?: number;
  method: string;
  params?: { protocolVersion?: string; name?: string; arguments?: unknown };
}

/** What the server answers `message` with, as JSON-RPC, or nothing for a notification. */
function resultOf(mcp: FakeMcp, message: Message): unknown {
  if (message.method === "initialize") return { protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: "1.0.0" } };
  if (message.method === "tools/list") return { tools: mcp.tools };
  if (message.method !== "tools/call" || typeof message.params?.name !== "string") return undefined;
  const { name, arguments: given } = message.params;
  mcp.calls.push({ name, arguments: given });
  return { content: [{ type: "text", text: calledWith(name, given) }] };
}

async function answer(mcp: FakeMcp, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
    response.writeHead(status, { ...(body !== undefined && { "Content-Type": "application/json" }), ...headers });
    response.end(body === undefined ? undefined : JSON.stringify(body));
  };
  if (new URL(request.url ?? "/", "http://localhost").pathname !== "/mcp") return reply(404, { error: "Not found" });
  if (request.headers.authorization !== `Bearer ${MCP_TOKEN}`) return reply(401, { error: "Unauthorized" }, { "WWW-Authenticate": "Bearer" });
  // It keeps no stream open for what it would send on its own.
  if (request.method !== "POST") return reply(405);
  let body = "";
  for await (const chunk of request) body += String(chunk);
  const message = JSON.parse(body) as Message;
  mcp.asked.push(message.method);
  if (message.id === undefined) return reply(202);
  const result = resultOf(mcp, message);
  if (result === undefined) return reply(200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
  reply(200, { jsonrpc: "2.0", id: message.id, result });
}

/** Starts the server on a port of its own, on this machine. */
export async function startFakeMcp(): Promise<FakeMcp> {
  const mcp: FakeMcp = { url: "", tools: [...TOOLS], asked: [], calls: [], close: async () => {} };
  const server = createServer((request, response) => {
    answer(mcp, request, response).catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  mcp.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  mcp.close = () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return mcp;
}
