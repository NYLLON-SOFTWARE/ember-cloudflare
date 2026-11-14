import { Client, SdkError, SdkErrorCode, SdkHttpError, StreamableHTTPClientTransport, UnauthorizedError } from "@modelcontextprotocol/client";
import { MAX_APP_TOOLS, MAX_TOOL_DESCRIPTION_LENGTH, type AppRefused } from "@ember/protocol/apps";
import { toHex } from "../encoding";
import { isLoopback } from "../loopback";
import { checkHost, GuardError, resolveOverHttps } from "../unfurl/guard";
import { VERSION } from "../version";

// Asking an app, an MCP server an administrator connected, over Streamable HTTP, with the Model Context
// Protocol's own client (https://github.com/modelcontextprotocol/typescript-sdk), pinned to one version.
// Ember gives it the way out: every request goes to the address the administrator gave, a name that
// resolves only to public addresses, or this machine's, and a redirect isn't followed, so a server can't
// send Ember, or the token, anywhere else. Only JSON comes back, and none of a server's code runs here.
// Every request, the lookups of the name among them, ends at one deadline, as the client doesn't pass
// its own to all of them.

/** How long reading an app's tools may take, from connecting to the last page of them. */
export const READ_DEADLINE_MS = 20_000;

/** The most characters of a tool's name, as the protocol recommends. */
const MAX_TOOL_NAME_LENGTH = 128;
/** The most characters of the JSON Schema of what a tool takes that Ember keeps: a tool with more is left out. */
export const MAX_TOOL_SCHEMA_LENGTH = 8_000;
/** The most pages of tools Ember asks an app for. */
const MAX_PAGES = 10;

/** A tool as Ember keeps it: as its page shows it, with the JSON Schema of what it takes, and a fingerprint of all that. */
export interface ReadTool {
  name: string;
  title: string | null;
  description: string;
  takes: Record<string, unknown>;
  fingerprint: string;
}

/** What reading an app found: what its server calls itself, its tools, and how many more it has than Ember keeps. */
export interface ReadApp {
  serverName: string | null;
  tools: ReadTool[];
  toolsLeftOut: number;
}

/** What an app is asked through: the Worker's `fetch`, or a fake in tests. */
export type Send = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * The tools of the app at `url`, asked with `token`, if it takes one: what its server calls itself and
 * each tool it lists, up to as many as Ember keeps, or why Ember couldn't read them, in words for the
 * administrator who's connecting it, on the field it's about.
 */
export async function readApp(url: string, token: string | null, send: Send = fetch): Promise<ReadApp | AppRefused> {
  const address = new URL(url);
  const deadline = AbortSignal.timeout(READ_DEADLINE_MS);
  const within: Send = (input, init) => send(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
  const guarded = await guardedHost(address, within, deadline);
  if (guarded) return guarded;
  const transport = new StreamableHTTPClientTransport(address, {
    fetch: within,
    // Workers' fetch has no "error": a redirect comes back as it is, which is no answer.
    requestInit: { redirect: "manual" },
    ...(token !== null && { authProvider: { token: async () => token } }),
  });
  const client = new Client({ name: "Ember", version: VERSION });
  try {
    await client.connect(transport, { signal: deadline });
    const { listed, more } = await listedTools(client, deadline);
    const tools = await keptTools(listed);
    if (tools.length === 0) return { error: `${address.host} answered, but it has no tools Ember can use.`, field: "url" };
    return { serverName: client.getServerVersion()?.name?.slice(0, 100) ?? null, tools, toolsLeftOut: listed.length - tools.length + (more ? 1 : 0) };
  } catch (error) {
    return whyUnread(address, token, error, deadline);
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * The tools `client`'s server lists, a page at a time, each asked for by itself, as the client's own walk
 * through them all would read every page a server has: up to as many pages as Ember asks for, and whether
 * the server has more.
 */
async function listedTools(client: Client, signal: AbortSignal): Promise<{ listed: unknown[]; more: boolean }> {
  const listed: unknown[] = [];
  if (!client.getServerCapabilities()?.tools) return { listed, more: false };
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    // The client reads every page when it's asked for the first, so that one is asked for as any request is.
    const { tools, nextCursor } = cursor === undefined ? await client.request({ method: "tools/list" }, { signal }) : await client.listTools({ cursor }, { signal });
    listed.push(...tools);
    cursor = nextCursor;
    if (cursor === undefined) break;
  }
  return { listed, more: cursor !== undefined };
}

/** The first of `listed` Ember can use, as it keeps them, up to as many as it keeps of an app: the rest aren't read. */
async function keptTools(listed: readonly unknown[]): Promise<ReadTool[]> {
  const kept: ReadTool[] = [];
  for (const tool of listed) {
    if (kept.length === MAX_APP_TOOLS) break;
    const read = await readTool(tool);
    if (read) kept.push(read);
  }
  return kept;
}

/**
 * Why Ember won't ask the host of `address`, if it won't: its name has to resolve, and only to public
 * addresses, unless it's this machine, before `deadline`.
 */
async function guardedHost(address: URL, send: Send, deadline: AbortSignal): Promise<AppRefused | null> {
  if (isLoopback(address)) return null;
  try {
    await checkHost(address.hostname, (host) => resolveOverHttps(host, (request) => send(request)));
    return null;
  } catch (error) {
    if (deadline.aborted) return { error: tookTooLong(address.host), field: "url" };
    if (!(error instanceof GuardError)) throw error;
    return { error: `Ember couldn't find ${address.host} on the Internet. Check the address.`, field: "url" };
  }
}

const tookTooLong = (host: string) => `${host} took too long to answer.`;

/**
 * A tool as an app lists it, `listed`, as Ember keeps it, or null for one it can't use: without a name
 * the protocol allows, or taking more than Ember keeps. Its description is cut to what Ember keeps.
 */
async function readTool(listed: unknown): Promise<ReadTool | null> {
  if (typeof listed !== "object" || listed === null) return null;
  const { name, title, description, inputSchema } = listed as Record<string, unknown>;
  if (typeof name !== "string" || !/^[A-Za-z0-9_.-]+$/.test(name) || name.length > MAX_TOOL_NAME_LENGTH) return null;
  const takes = typeof inputSchema === "object" && inputSchema !== null && !Array.isArray(inputSchema) ? (inputSchema as Record<string, unknown>) : { type: "object" };
  if (JSON.stringify(takes).length > MAX_TOOL_SCHEMA_LENGTH) return null;
  const described = typeof description === "string" ? description.trim() : "";
  const tool = {
    name,
    title: typeof title === "string" && title.trim() !== "" ? title.trim().slice(0, 100) : null,
    description: described.length > MAX_TOOL_DESCRIPTION_LENGTH ? `${described.slice(0, MAX_TOOL_DESCRIPTION_LENGTH - 1).trimEnd()}…` : described,
    takes,
  };
  return { ...tool, fingerprint: await fingerprintOf(tool) };
}

/**
 * A fingerprint of a tool as Ember keeps it: SHA-256 of its name, title, description and what it takes,
 * with every object's keys in order, so that it changes when what a model is told of the tool does.
 */
export async function fingerprintOf(tool: Omit<ReadTool, "fingerprint">): Promise<string> {
  const text = JSON.stringify(inOrder([tool.name, tool.title, tool.description, tool.takes]));
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/** `value` with every object's keys sorted, all the way down. */
function inOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inOrder);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, inside]) => [key, inOrder(inside)]));
}

/**
 * Why Ember couldn't read the tools of the app at `address`, asked with `token`, from what went wrong,
 * before `deadline` or at it. Only the kind of failure is logged: a server writes what its answers say,
 * which the client quotes in its errors, and could write the token there.
 */
function whyUnread(address: URL, token: string | null, error: unknown, deadline: AbortSignal): AppRefused {
  const { host } = address;
  const status = error instanceof SdkHttpError ? error.status : null;
  const kind = error instanceof SdkError ? `${error.name} ${error.code}` : error instanceof Error ? error.name : typeof error;
  console.error(`Reading the tools of the app at ${host} failed${status === null ? "" : ` with ${status}`}: ${kind}`);
  if (deadline.aborted) return { error: tookTooLong(host), field: "url" };
  if (error instanceof UnauthorizedError || status === 401 || status === 403) {
    return token === null
      ? { error: `${host} asks for a sign-in. Give a token for it, if it has one: Ember can't sign in to an app any other way yet.`, field: "token" }
      : { error: `${host} didn't take that token.`, field: "token" };
  }
  if (status !== null && status >= 300 && status < 400) return { error: `${host} sends that address on to another, which Ember doesn't follow. Give the address it ends at.`, field: "url" };
  if (status === 404 || status === 405) return { error: `${host} has no MCP server at that address. Check the address, which often ends in /mcp.`, field: "url" };
  if (status !== null) return { error: `${host} answered ${status}. Try again in a moment.`, field: "url" };
  if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) return { error: tookTooLong(host), field: "url" };
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return { error: tookTooLong(host), field: "url" };
  if (error instanceof TypeError) return { error: `Ember couldn't reach ${host}. Check the address.`, field: "url" };
  return { error: `${host} didn't answer as an MCP server does. Check the address, which often ends in /mcp.`, field: "url" };
}
