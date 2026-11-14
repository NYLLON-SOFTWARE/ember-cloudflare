import { bodyFromPlainText } from "@ember/richtext";
import { hasWords, isRoomId, MAX_ID_LENGTH, MAX_MESSAGE_HTML_LENGTH, MAX_SEARCH_LENGTH, sanitizeSearch, searchTerms, type Message, type RoomId, type SearchSort, type User } from "@ember/protocol";
import { tokenDigest } from "./auth";
import { bodyUpTo } from "./bodies";
import { permalink } from "./bots/api";
import { originFor } from "./custom-domain";
import type { Env } from "./env";
import { matchesOf } from "./searches";
import { searchIndex, type IndexSearch } from "./search-index";
import { bearerTokenOf } from "./secrets";
import { versionOf } from "./version";
import { workspace, type TokenRoomAccess } from "./workspace";

// The MCP server: an agent outside Ember opens a workspace with one of its person's personal access
// tokens, and reads and writes what they can. Its tools act as them, never reaching a room, message or
// person they can't see, and only as much of that as the token's scopes allow. It speaks MCP's
// streamable-HTTP transport as JSON-RPC over plain HTTP: one JSON answer to each request, at
// POST /mcp. That's the mode 2025-03-26 and later clients accept; there's no server-initiated stream,
// so GET answers 405 and no session is kept.

/** The MCP server's address. */
export const MCP_PATH = "/mcp";

/** The protocol revisions the server speaks, newest last, which initialize answers one of. */
const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;

/** What this server calls itself, as initialize answers. */
const SERVER_NAME = "ember";

/** What a token may do, as a personal access token may everything, and an OAuth grant says which. */
export const SCOPES = ["messages:read", "rooms:read", "people:read", "messages:write"] as const;
export type Scope = (typeof SCOPES)[number];
export const ALL_SCOPES: ReadonlySet<string> = new Set<string>(SCOPES);

/** The most rooms list_rooms answers, so no workspace's whole rail goes over the wire at once. */
const ROOMS_LIMIT = 200;
/** The most messages get_room_history answers at once. */
const HISTORY_LIMIT = 50;
/** The most matches search_messages answers, what its callers are told to ask no more of. */
const SEARCH_RESULTS_LIMIT = 50;
/** The most people get_people answers, past which a workspace's directory is cut short. */
const PEOPLE_LIMIT = 500;

/** What each tool asks of the token. */
const SCOPES_OF_TOOL: Record<string, Scope> = {
  list_rooms: "rooms:read",
  get_room_history: "messages:read",
  search_messages: "messages:read",
  get_thread: "messages:read",
  get_people: "people:read",
  post_message: "messages:write",
};

/** Why a request that isn't speaking JSON-RPC is refused, as JSON-RPC names each. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
/** Ours: what a request beyond the token's scopes hears. */
const SCOPE_REFUSED = -32003;

/** A JSON-RPC call, as far as it must parse to be answered or refused on its merits. */
interface Rpc {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

/** A JSON-RPC answer, a result or an error. */
interface Answer {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

const answerOf = (id: unknown, result: unknown): Answer => ({ jsonrpc: "2.0", id, result });

const errorOf = (id: unknown, code: number, message: string): Answer => ({ jsonrpc: "2.0", id, error: { code, message } });

/** An id a refusal may be answered by, since JSON-RPC asks null for one it couldn't read. */
const answerIdOf = (id: unknown): unknown => (typeof id === "string" || typeof id === "number" ? id : null);

/** An HTTP answer that carries a JSON-RPC error, for what fails before a call could. */
const mcpProblem = (status: number, code: number, message: string): Response =>
  Response.json(errorOf(null, code, message), { status, headers: { "Content-Type": "application/json" } });

/** What an exception on /mcp answers, as the API's 500s are JSON. */
export const mcpException = () => mcpProblem(500, INTERNAL_ERROR, "Something went wrong");

/** Whether `pathname` is the server's, whose failures answer JSON. */
export const isMcpPath = (pathname: string) => pathname === MCP_PATH;

/** What answers /mcp, whatever its method. */
export async function mcpAction(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return mcpProblem(405, INVALID_REQUEST, "MCP is spoken at POST /mcp. There's no stream here to listen on.");
  const opener = await openerOf(request, env);
  if (opener instanceof Response) return opener;
  const { user, scopes } = opener;
  let body: unknown;
  try {
    const text = await bodyUpTo(request, 1024 * 1024);
    if (text === null) return mcpProblem(413, INVALID_REQUEST, "The request's body can be at most 1 MiB");
    body = JSON.parse(text);
  } catch {
    return mcpProblem(400, PARSE_ERROR, "The request's body isn't JSON-RPC");
  }
  const batched = Array.isArray(body);
  const calls: unknown[] = batched ? (body as unknown[]) : [body];
  const answered = await Promise.all(calls.map((call) => answerOfCall(call, user, scopes, env, request)));
  const answers = answered.filter((answer) => answer !== null);
  if (answers.length === 0) return new Response(null, { status: 202 });
  return Response.json(batched ? answers : answers[0], { headers: { "Content-Type": "application/json" } });
}

/**
 * Whoever the request's bearer token opens, with what it may do, or the answer it's refused with: 401
 * without a token it names, and past what the address it came from may fail at, as sign-in's limit is.
 */
async function openerOf(request: Request, env: Env): Promise<{ user: User; scopes: ReadonlySet<string> } | Response> {
  const token = bearerTokenOf(request);
  // Saying the scheme helps a client that came without a token find out it needs one.
  if (!token) return Response.json(errorOf(null, INVALID_REQUEST, "Give a personal access token as the request's Bearer token"), { status: 401, headers: { "Content-Type": "application/json", "WWW-Authenticate": `Bearer realm="${SERVER_NAME}"` } });
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const user = await workspace(env).authenticateApiToken(ip, await tokenDigest(token, env.SESSION_SECRET));
  if (user === "limited") return mcpProblem(429, INVALID_REQUEST, "Too many tries with a token from this address. Wait a few minutes.");
  if (!user) return mcpProblem(401, INVALID_REQUEST, "That token doesn't open anything. Make a new one in your profile.");
  return { user, scopes: ALL_SCOPES };
}

/** What one JSON-RPC call answers, or null for a notification, which is answered with nothing. */
function answerOfCall(call: unknown, user: User, scopes: ReadonlySet<string>, env: Env, request: Request): Promise<Answer | null> {
  if (typeof call !== "object" || call === null || Array.isArray(call)) return Promise.resolve(errorOf(null, INVALID_REQUEST, "Expected a JSON-RPC request"));
  const { id, method, params } = call as Rpc;
  if ((call as Rpc).jsonrpc !== "2.0") return Promise.resolve(errorOf(null, INVALID_REQUEST, "Expected JSON-RPC 2.0"));
  if (typeof method !== "string") return Promise.resolve(errorOf(answerIdOf(id), INVALID_REQUEST, "Expected a method"));
  // A notification answers nothing, whatever its method.
  if (id === undefined) return Promise.resolve(null);
  if (typeof id !== "string" && typeof id !== "number") return Promise.resolve(errorOf(null, INVALID_REQUEST, "Expected the id as a string or a number"));
  return answered(id, method, params, user, scopes, env, request);
}

/** What one JSON-RPC request answers. */
async function answered(id: unknown, method: string, params: unknown, user: User, scopes: ReadonlySet<string>, env: Env, request: Request): Promise<Answer> {
  const args = paramsOf(params);
  if (args === null) return errorOf(id, INVALID_PARAMS, "Expected params as an object");
  switch (method) {
    case "initialize": {
      const askedVersion =
        typeof args.protocolVersion === "string" && (PROTOCOL_VERSIONS as readonly string[]).includes(args.protocolVersion)
          ? args.protocolVersion
          : PROTOCOL_VERSIONS[2];
      return answerOf(id, {
        protocolVersion: askedVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: "Ember", version: versionOf(env) },
        instructions:
          "Ember is a chat workspace. These tools read and write its rooms as the person who made the token you carry: list_rooms for their rooms, get_room_history and search_messages for what's been said, get_thread for a thread, post_message to say something as them, and get_people for who's there.",
      });
    }
    case "ping":
      return answerOf(id, {});
    case "tools/list":
      return answerOf(id, { tools: toolsOf(scopes) });
    case "tools/call": {
      const name = typeof args.name === "string" ? args.name : "";
      if (!(name in SCOPES_OF_TOOL)) return errorOf(id, METHOD_NOT_FOUND, `There is no tool called ${JSON.stringify(name || args.name)}`);
      const scope = SCOPES_OF_TOOL[name]!;
      if (!scopes.has(scope)) return errorOf(id, SCOPE_REFUSED, `The token doesn't allow this. It would take ${scope}, which it doesn't carry.`);
      if (typeof args.arguments !== "object" || args.arguments === null) return errorOf(id, INVALID_PARAMS, "Expected arguments as an object");
      try {
        return await called(id, name, args.arguments as Record<string, unknown>, user, env, request);
      } catch (error) {
        console.error(`MCP tool ${name} failed:`, error);
        return errorOf(id, INTERNAL_ERROR, "Something went wrong");
      }
    }
    // A client that asks for what this server doesn't do hears so: resources and prompts it has none of.
    default:
      return errorOf(id, METHOD_NOT_FOUND, `There is nothing called ${JSON.stringify(method)} here. This server has tools only.`);
  }
}

/** A request's params as an object, or null when they can't be one. */
const paramsOf = (params: unknown): Record<string, unknown> | null =>
  params === undefined ? {} : typeof params === "object" && params !== null && !Array.isArray(params) ? (params as Record<string, unknown>) : null;

/** The tools the token's scopes allow, each with what it takes. */
function toolsOf(scopes: ReadonlySet<string>) {
  return Object.entries(SCHEMAS)
    .filter(([name]) => scopes.has(SCOPES_OF_TOOL[name]!))
    .map(([name, tool]) => ({ name, ...tool }));
}

/** Each tool's description and input schema, in the words its result speaks. */
const SCHEMAS: Record<string, { description: string; inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] } }> = {
  list_rooms: {
    description: "The rooms the token's person is in, DMs included, with whether each is marked unread. At most 200.",
    inputSchema: { type: "object", properties: {} },
  },
  get_room_history: {
    description:
      "A page of a room's messages, oldest first: the newest, or the ones before the message `before` names, or after the one `after` names. `hasMore` says whether older ones are left, `hasNewer` whether newer are.",
    inputSchema: {
      type: "object",
      properties: {
        room_id: { type: "string", description: "The room's id, as list_rooms answers one." },
        limit: { type: "integer", minimum: 1, maximum: HISTORY_LIMIT, description: `How many messages, at most ${HISTORY_LIMIT}. 40 without one.` },
        before: { type: "string", description: "The message id the page is older than." },
        after: { type: "string", description: "The message id the page is newer than." },
      },
      required: ["room_id"],
    },
  },
  search_messages: {
    description: "The messages with every word of `query`, in the rooms the token's person is in, newest first. At most 50.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Every word a message has to have." },
        limit: { type: "integer", minimum: 1, maximum: SEARCH_RESULTS_LIMIT, description: `How many matches, at most ${SEARCH_RESULTS_LIMIT}. 20 without one.` },
        room_id: { type: "string", description: "Keep to this room, which the token's person has to be in." },
        sort: { type: "string", enum: ["newest", "oldest"], description: "Newest first without one." },
      },
      required: ["query"],
    },
  },
  get_thread: {
    description: "A message's thread: the message, then its newest replies, oldest first. A reply has no thread of its own.",
    inputSchema: {
      type: "object",
      properties: {
        room_id: { type: "string", description: "The room the message is in." },
        message_id: { type: "string", description: "The message whose thread this is." },
      },
      required: ["room_id", "message_id"],
    },
  },
  get_people: {
    description: "Everyone in the workspace, by name, with their role and whether they're active. At most 500.",
    inputSchema: { type: "object", properties: {} },
  },
  post_message: {
    description: "Posts a message to a room, as the token's person, who has to be in it. With `thread_id`, as a reply in that message's thread.",
    inputSchema: {
      type: "object",
      properties: {
        room_id: { type: "string", description: "The room to post to." },
        body: { type: "string", description: "The message, as plain text." },
        thread_id: { type: "string", description: "The message to reply to, in its thread." },
      },
      required: ["room_id", "body"],
    },
  },
};

/** What tools/call answers for the tool `name`, whose arguments are `args`. */
async function called(id: unknown, name: string, args: Record<string, unknown>, user: User, env: Env, request: Request): Promise<Answer> {
  switch (name) {
    case "list_rooms":
      return resultOf(id, { rooms: await listedRooms(user, env) });
    case "get_room_history":
      return historyAnswer(id, args, user, env, request);
    case "search_messages":
      return searchAnswer(id, args, user, env, request);
    case "get_thread":
      return threadAnswer(id, args, user, env, request);
    case "get_people":
      return resultOf(id, { people: await listedPeople(env) });
    case "post_message":
      return postAnswer(id, args, user, env, request);
    default:
      return errorOf(id, METHOD_NOT_FOUND, `There is no tool called ${JSON.stringify(name)}`);
  }
}

/** A tool's successful answer: its data as one JSON text content block, as MCP's CallToolResult asks. */
const resultOf = (id: unknown, result: unknown): Answer => answerOf(id, { content: [{ type: "text", text: JSON.stringify(result) }] });

/** `value` as one of the tool's texts, or null when it isn't a string within `max` characters. */
const textOf = (value: unknown, max: number): string | null => (typeof value === "string" && value.length <= max ? value : null);

/** `value` as one of the tool's message ids, or null when it's too long, or nothing, to be one. */
const idOf = (value: unknown): string | null => (typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH ? value : null);

/** The message id `field` names in `args`, undefined without one, or null when it couldn't be one. */
const idArgOf = (args: Record<string, unknown>, field: string): string | null | undefined => (args[field] === undefined ? undefined : idOf(args[field]));

/** `value` as a count the tool takes, or null when it isn't a whole number up to `max`. */
const limitOf = (value: unknown, max: number): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max ? value : null);

/** `room_id` as a room's id, or null when it couldn't be one. */
const roomIdOf = (args: Record<string, unknown>): RoomId | null => (typeof args.room_id === "string" && isRoomId(args.room_id) ? args.room_id : null);

/** A tool's answer that carries one text, as a message or a refusal does. */
const saidOf = (id: unknown, text: string, wrong = false): Answer => answerOf(id, { content: [{ type: "text", text }], ...(wrong && { isError: true }) });

/** What a room that isn't the token's person's refuses with, saying nothing of whether it's there. */
const refusedRoom = (id: unknown) => saidOf(id, "Room not found or inaccessible", true);

/** A message as the tools show it: who wrote it, when, what it says in plain text, and where it is. */
function shownOf(message: Message, origin: string) {
  return {
    id: message.id,
    room_id: message.roomId,
    ...(message.parentId !== undefined && { thread_id: message.parentId }),
    author: { id: message.creator.id, name: message.creator.name },
    created_at: message.createdAt,
    plain_text: message.plainText,
    permalink: permalink(origin, message),
  };
}

/** The rooms the token's person is in, DMs named after their people, with their unread marks. */
async function listedRooms(user: User, env: Env) {
  const rooms = await workspace(env).apiTokenRooms(user.id);
  return rooms.slice(0, ROOMS_LIMIT).map((room) => ({
    id: room.id,
    kind: room.kind,
    name: room.kind === "direct" ? room.members.map(({ name }) => name).join(", ") : room.name,
    unread: room.unread,
  }));
}

/** A page of a room's messages, once the room is the token's person's. */
async function historyAnswer(id: unknown, args: Record<string, unknown>, user: User, env: Env, request: Request): Promise<Answer> {
  const roomId = roomIdOf(args);
  if (roomId === null) return errorOf(id, INVALID_PARAMS, "room_id has to be a room's id, as list_rooms answers one");
  if (args.limit !== undefined && limitOf(args.limit, HISTORY_LIMIT) === null) return errorOf(id, INVALID_PARAMS, `limit has to be 1 to ${HISTORY_LIMIT}`);
  const before = idArgOf(args, "before");
  const after = idArgOf(args, "after");
  if (before === null) return errorOf(id, INVALID_PARAMS, "before has to be a message id");
  if (after === null) return errorOf(id, INVALID_PARAMS, "after has to be a message id");
  const access = await roomAccessIn(env, user, roomId, request);
  if (access === null) return refusedRoom(id);
  const page = await env.CHAT_ROOM.getByName(roomId).botPage(roomId, { before, after }, limitOf(args.limit, HISTORY_LIMIT) ?? undefined);
  if (page === null) return refusedRoom(id);
  const origin = originFor(request, access.customDomain);
  return resultOf(id, {
    messages: page.messages.filter(({ deleted }) => !deleted).map((message) => shownOf(message, origin)),
    hasMore: page.hasMore,
    hasNewer: page.hasNewer,
  });
}

/** The matches a search finds, in the rooms the token's person can search, and only there. */
async function searchAnswer(id: unknown, args: Record<string, unknown>, user: User, env: Env, request: Request): Promise<Answer> {
  const query = textOf(args.query, MAX_SEARCH_LENGTH);
  if (query === null) return errorOf(id, INVALID_PARAMS, `query has to be up to ${MAX_SEARCH_LENGTH} characters`);
  if (!hasWords(query)) return errorOf(id, INVALID_PARAMS, "query has to have a word in it");
  const limit = args.limit === undefined ? 20 : limitOf(args.limit, SEARCH_RESULTS_LIMIT);
  if (limit === null) return errorOf(id, INVALID_PARAMS, `limit has to be 1 to ${SEARCH_RESULTS_LIMIT}`);
  if (args.sort !== undefined && args.sort !== "oldest" && args.sort !== "newest") return errorOf(id, INVALID_PARAMS, "sort has to be newest or oldest");
  const sort: SearchSort = args.sort === "oldest" ? "oldest" : "newest";
  const roomId = args.room_id === undefined ? null : roomIdOf(args);
  if (args.room_id !== undefined && roomId === null) return errorOf(id, INVALID_PARAMS, "room_id has to be a room's id, as list_rooms answers one");
  const searcher = await workspace(env).apiTokenSearcher(user.id);
  // Their rooms are the only ones the index looks in; a room they're not in narrows to none of them.
  const rooms = roomId === null ? searcher.rooms : searcher.rooms.filter(({ id: found }) => found === roomId);
  if (roomId !== null && rooms.length === 0) return refusedRoom(id);
  const search: IndexSearch = {
    terms: searchTerms(sanitizeSearch(query)),
    roomIds: rooms.map(({ id: found }) => found),
    sort,
    after: null,
  };
  const { hits } = await searchIndex(env).search(search);
  const origin = originFor(request, searcher.customDomain);
  const matches = (await matchesOf(env, hits.slice(0, limit))).map(({ message, words }) => ({ message: shownOf(message, origin), words }));
  return resultOf(id, { matches });
}

/** A message's thread, once the room it's in is the token's person's. */
async function threadAnswer(id: unknown, args: Record<string, unknown>, user: User, env: Env, request: Request): Promise<Answer> {
  const roomId = roomIdOf(args);
  if (roomId === null) return errorOf(id, INVALID_PARAMS, "room_id has to be a room's id, as list_rooms answers one");
  const messageId = idOf(args.message_id);
  if (messageId === null) return errorOf(id, INVALID_PARAMS, "message_id has to be a message id");
  const access = await roomAccessIn(env, user, roomId, request);
  if (access === null) return refusedRoom(id);
  const thread = await env.CHAT_ROOM.getByName(roomId).botThread(roomId, messageId);
  if (thread === null || thread[0]!.deleted) return refusedRoom(id);
  const origin = originFor(request, access.customDomain);
  return resultOf(id, {
    parent: shownOf(thread[0]!, origin),
    replies: thread.slice(1).filter(({ deleted }) => !deleted).map((message) => shownOf(message, origin)),
  });
}

/** The directory, as the token's person sees it: who's there, not where they are. */
async function listedPeople(env: Env) {
  const people = await workspace(env).apiTokenDirectory();
  return people.slice(0, PEOPLE_LIMIT).map(({ id, name, role, status }) => ({ id, name, role, status }));
}

/** Posts a message to a room, as the token's person, once they're in it and may speak there. */
async function postAnswer(id: unknown, args: Record<string, unknown>, user: User, env: Env, request: Request): Promise<Answer> {
  const roomId = roomIdOf(args);
  if (roomId === null) return errorOf(id, INVALID_PARAMS, "room_id has to be a room's id, as list_rooms answers one");
  const body = textOf(args.body, MAX_MESSAGE_HTML_LENGTH);
  if (body === null) return errorOf(id, INVALID_PARAMS, `body has to be up to ${MAX_MESSAGE_HTML_LENGTH} characters`);
  const threadId = idArgOf(args, "thread_id");
  if (threadId === null) return errorOf(id, INVALID_PARAMS, "thread_id has to be a message id");
  const access = await roomAccessIn(env, user, roomId, request);
  if (access === null) return refusedRoom(id);
  if (access.banned) return saidOf(id, "A ban blocks the address this request came from.", true);
  const created = await env.CHAT_ROOM.getByName(roomId).createUserMessage(roomId, user, access.authorizedAt, bodyFromPlainText(body), threadId);
  if (created === null) return refusedRoom(id);
  if (typeof created === "string") return saidOf(id, created, true);
  return resultOf(id, { message: shownOf(created, originFor(request, access.customDomain)) });
}

/** What the Workspace says about the token's person in room `roomId`. */
const roomAccessIn = (env: Env, user: User, roomId: RoomId, request: Request): Promise<TokenRoomAccess | null> =>
  workspace(env).apiTokenRoomAccess(user.id, roomId, request.headers.get("CF-Connecting-IP"));
