import { MAX_MESSAGE_HTML_LENGTH, type Boost, type Message, type RoomId, type UserId } from "@ember/protocol";
import { directoryOf } from "../avatar-tokens";
import { BLANK, FORBIDDEN, NOT_FOUND, type BotPage } from "../chat-room";
import type { Env } from "../env";
import { etagOf, isFresh } from "../etag";
import type { PageCursor } from "../store";
import { workspace, type BotAccess } from "../workspace";
import { botKeyParts } from "./keys";
import { railsJson } from "./rails-json";

// The bot API, as ember-rust's `Messages::ByBotsController` and `Messages::Boosts::ByBotsController`
// answer it (crates/ember/src/controllers/messages/by_bots.rs and boosts/by_bots.rs): a bot posts to a
// room it's in, and reads it, at /rooms/<room id>/<bot key>/messages, and edits, deletes and boosts its
// messages under that. The key is all a bot has, so these routes never read a session cookie, which
// leaves another site's page nothing to forge.

/** A room's address for bots, `room_bot_messages`, and those of its messages, their boosts and a boost, each with or without `.json`. */
const BOT_MESSAGES = /^\/rooms\/([^/.]+)\/([^/.]+)\/messages(?:\.json)?$/;
const BOT_MESSAGE = /^\/rooms\/([^/.]+)\/([^/.]+)\/messages\/([^/.]+)(?:\.json)?$/;
const BOT_BOOSTS = /^\/rooms\/([^/.]+)\/([^/.]+)\/messages\/([^/.]+)\/boosts(?:\.json)?$/;
const BOT_BOOST = /^\/rooms\/([^/.]+)\/([^/.]+)\/messages\/([^/.]+)\/boosts\/([^/.]+)(?:\.json)?$/;

/** A key in a room's address for bots, as Campfire's `LogScrubbingFormatter` finds one. */
const BOT_KEY_IN_PATH = /(\/rooms\/[^/\s]+\/)[^/\s]+(?=\/messages\b)/g;

/**
 * The most bytes of text a bot can post: no more than `MAX_MESSAGE_HTML_LENGTH` characters, since none
 * takes more than 3 bytes of UTF-8 for each UTF-16 unit it counts as.
 */
const MAX_BODY_BYTES = 3 * MAX_MESSAGE_HTML_LENGTH;

const UNKNOWN_BOT_KEY = "Unknown bot key";
const FILES_NOT_YET = "Bots can't post files yet";

/** `Rack::Utils::HTTP_STATUS_CODES`, for the exceptions ember-rust answers here. */
const REASONS = { 404: "Not Found", 413: "Content Too Large", 500: "Internal Server Error" } as const;

const JSON_TYPE = "application/json; charset=utf-8";
/** How a bot may keep JSON it's answered, as Rack::ETag allows JSON with an ETag: only once it's checked it's current. */
const REVALIDATE = "max-age=0, private, must-revalidate";

/** What answers a request to a room's address for bots, if it's one the bot API takes. */
export function botAction(request: Request, env: Env, pathname: string): (() => Promise<Response>) | null {
  const { method } = request;
  const messages = pathname.match(BOT_MESSAGES);
  if (messages && method === "POST") return () => createMessage(request, env, messages[1]!, messages[2]!);
  if (messages && (method === "GET" || method === "HEAD")) return () => listMessages(request, env, messages[1]!, messages[2]!);
  const message = pathname.match(BOT_MESSAGE);
  if (message && (method === "PUT" || method === "PATCH")) return () => updateMessage(request, env, message[1]!, message[2]!, message[3]!);
  if (message && method === "DELETE") return () => deleteMessage(env, message[1]!, message[2]!, message[3]!);
  const boosts = pathname.match(BOT_BOOSTS);
  if (boosts && method === "POST") return () => createBoost(request, env, boosts[1]!, boosts[2]!, boosts[3]!);
  const boost = pathname.match(BOT_BOOST);
  if (boost && method === "DELETE") return () => deleteBoost(env, boost[1]!, boost[2]!, boost[3]!, boost[4]!);
  return null;
}

/** Whether `pathname` is one of the bot API's addresses, whose failures answer JSON. */
export const isBotPath = (pathname: string) => [BOT_MESSAGES, BOT_MESSAGE, BOT_BOOSTS, BOT_BOOST].some((route) => route.test(pathname));

/** `text` with every bot key in an address `[FILTERED]`, as Campfire's log lines have them. */
export const withoutBotKeys = (text: string) => text.replace(BOT_KEY_IN_PATH, "$1[FILTERED]");

/** An exception, as ember-rust answers one for JSON (crates/kit/src/exceptions.rs). */
export const exception = (status: keyof typeof REASONS) =>
  new Response(JSON.stringify({ status, error: REASONS[status] }), { status, headers: { "Content-Type": "application/json; charset=UTF-8" } });

/** `head status`, an empty answer, as ember-rust's `concerns::head` gives one. */
const head = (status: number) => new Response(null, { status, headers: { "Content-Type": "text/html" } });

/** What a key that names no active bot answers, where ember-rust sends the request to sign in. */
const unknownKey = () => Response.json({ error: UNKNOWN_BOT_KEY }, { status: 401 });

/** What a request the room can't take answers: 422 with why. */
const unprocessable = (reason: string) => Response.json({ error: reason }, { status: 422 });

/**
 * The bot the key segment `key` names, as ember-rust's `allow_bot_access` finds it, if it's in room
 * `roomId`, as `set_room` finds the room, with when the Workspace checked, or what the request answers
 * otherwise: 401 unless the key is an active bot's own, and an empty 404 when the bot isn't in the room.
 */
async function botIn(env: Env, roomId: RoomId, key: string): Promise<BotAccess | Response> {
  const parts = botKeyParts(segmentText(key));
  const access = parts && (await workspace(env).botInRoom(parts.botId, parts.token, roomId));
  if (!access) return unknownKey();
  return access === "not found" ? head(404) : access;
}

/** A path segment as Rails reads it, or "" for malformed percent-encoding, which names nothing. */
function segmentText(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

/**
 * `POST /rooms/<room id>/<bot key>/messages`: posts the request's body, whatever its type, as the bot's
 * message, as `create` posts `raw_request_body`, answering 201 with where the message is.
 */
async function createMessage(request: Request, env: Env, roomId: RoomId, key: string): Promise<Response> {
  let access = await botIn(env, roomId, key);
  if (access instanceof Response) return access;
  if (isForm(request)) return filesNotYet();
  const markup = await bodyText(request);
  if (markup === null) return exception(413);
  // ember-rust checks the key once it has the whole body, which here arrives as slowly as its sender
  // likes: long enough for the bot to be deleted, given a new key or taken out of the room since the check
  // above, which only spares reading the body of a request that can't post.
  access = await botIn(env, roomId, key);
  if (access instanceof Response) return access;
  // `raw_request_body.blank?`: empty or only spaces.
  if (markup.trim() === "") return head(422);
  const created = await env.CHAT_ROOM.getByName(roomId).createBotMessage(roomId, access, markup);
  if (!created) return head(404);
  if (typeof created === "string") return unprocessable(created);
  const location = permalink(new URL(request.url).origin, created);
  return new Response(null, { status: 201, headers: { Location: location, "Content-Type": JSON_TYPE } });
}

/**
 * `PUT` or `PATCH /rooms/<room id>/<bot key>/messages/<id>`: replaces the text of the bot's own message
 * with the request's body, as `update` does, answering the message as the list has it.
 */
async function updateMessage(request: Request, env: Env, roomId: RoomId, key: string, messageId: string): Promise<Response> {
  let access = await botIn(env, roomId, key);
  if (access instanceof Response) return access;
  if (isForm(request)) return filesNotYet();
  const markup = await bodyText(request);
  if (markup === null) return exception(413);
  // Again now the body has arrived, as `createMessage` checks it.
  access = await botIn(env, roomId, key);
  if (access instanceof Response) return access;
  const edited = await env.CHAT_ROOM.getByName(roomId).editBotMessage(roomId, access, messageId, markup);
  if (edited === NOT_FOUND) return exception(404);
  if (edited === FORBIDDEN) return head(403);
  if (typeof edited === "string") return unprocessable(edited);
  const [message] = await messagesJson(env, new URL(request.url).origin, [edited]);
  return rendered(message, 200);
}

/** `DELETE /rooms/<room id>/<bot key>/messages/<id>`: deletes the bot's own message, as `destroy` does. */
async function deleteMessage(env: Env, roomId: RoomId, key: string, messageId: string): Promise<Response> {
  const access = await botIn(env, roomId, key);
  if (access instanceof Response) return access;
  const refusal = await env.CHAT_ROOM.getByName(roomId).deleteBotMessage(roomId, access, messageId);
  if (refusal === NOT_FOUND) return exception(404);
  if (refusal === FORBIDDEN) return head(403);
  return new Response(null, { status: 204 });
}

/**
 * `POST /rooms/<room id>/<bot key>/messages/<id>/boosts`: boosts a message in the room with the request's
 * body, as `create` does there (messages/boosts/by_bots.rs), answering 201 with the boost.
 */
async function createBoost(request: Request, env: Env, roomId: RoomId, key: string, messageId: string): Promise<Response> {
  let access = await botIn(env, roomId, key);
  if (access instanceof Response) return access;
  const content = await bodyText(request);
  if (content === null) return exception(413);
  // Again now the body has arrived, as `createMessage` checks it.
  access = await botIn(env, roomId, key);
  if (access instanceof Response) return access;
  const boost = await env.CHAT_ROOM.getByName(roomId).addBotBoost(roomId, access, messageId, content);
  if (boost === NOT_FOUND) return head(404);
  // `raw_request_body.blank?`, checked once the message is found.
  if (boost === BLANK) return head(422);
  if (typeof boost === "string") return unprocessable(boost);
  return rendered(await boostJson(env, new URL(request.url).origin, roomId, boost), 201);
}

/**
 * `DELETE /rooms/<room id>/<bot key>/messages/<id>/boosts/<boost id>`: removes the bot's own boost on the
 * message, as `destroy` does there, or answers an empty 404.
 */
async function deleteBoost(env: Env, roomId: RoomId, key: string, messageId: string, boostId: string): Promise<Response> {
  const access = await botIn(env, roomId, key);
  if (access instanceof Response) return access;
  const removed = await env.CHAT_ROOM.getByName(roomId).removeBotBoost(roomId, access, messageId, boostId);
  return removed ? new Response(null, { status: 204 }) : head(404);
}

/** Whether the request sends a form, as `curl -F` sends a file, which bots can't post until files can be stored. */
const isForm = (request: Request) => /^multipart\/form-data\s*(;|$)/i.test(request.headers.get("Content-Type")?.trim() ?? "");

/** What a form answers until files can be stored. */
const filesNotYet = () => Response.json({ error: FILES_NOT_YET }, { status: 415 });

/**
 * The request's body as UTF-8, with invalid bytes replaced as `raw_request_body` replaces them, or null
 * when it's longer than a message's markup can be.
 */
async function bodyText(request: Request): Promise<string | null> {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) return null;
  const chunks = request.body ? await readAtMost(request.body, MAX_BODY_BYTES) : [];
  const text = chunks && (await new Blob(chunks).text());
  return text !== null && text.length <= MAX_MESSAGE_HTML_LENGTH ? text : null;
}

/** A stream's chunks, or null once they come to more than `limit` bytes, when it's read no further. */
async function readAtMost(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array[] | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    size += value.byteLength;
    if (size > limit) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
}

/**
 * `GET /rooms/<room id>/<bot key>/messages`: a page of the room's messages as JSON, oldest first, as
 * `index` answers it: the newest 40, or the 40 before the message `?before` names or after the one
 * `?after` does, with how many the room has in `X-Total-Count` and a `Link` to the next page when the
 * room has more beyond this one.
 */
async function listMessages(request: Request, env: Env, roomId: RoomId, key: string): Promise<Response> {
  const access = await botIn(env, roomId, key);
  if (access instanceof Response) return access;
  const url = new URL(request.url);
  const cursor = { before: present(url.searchParams.get("before")), after: present(url.searchParams.get("after")) };
  const page = await env.CHAT_ROOM.getByName(roomId).botPage(roomId, cursor);
  if (!page) return exception(404);

  const body = railsJson(await messagesJson(env, url.origin, page.messages));
  const etag = await etagOf(body);
  const headers = new Headers({ "X-Total-Count": String(page.total), ETag: etag, "Cache-Control": REVALIDATE });
  const next = nextPage(page, cursor);
  if (next) headers.set("Link", `<${url.origin}/rooms/${roomId}/${key}/messages?${next}>; rel="next"`);
  if (isFresh(request, etag)) return new Response(null, { status: 304, headers });
  headers.set("Content-Type", JSON_TYPE);
  return new Response(request.method === "HEAD" ? null : body, { headers });
}

/** `value` as the bot API writes JSON, answered with `status` as Rack::ETag sends a 200 or 201: with its ETag. */
async function rendered(value: unknown, status: 200 | 201): Promise<Response> {
  const body = railsJson(value);
  return new Response(body, { status, headers: { "Content-Type": JSON_TYPE, ETag: await etagOf(body), "Cache-Control": REVALIDATE } });
}

/** A parameter as Rails reads a `present?` one: absent when it's missing or blank. */
const present = (value: string | null) => (value === null || value.trim() === "" ? undefined : value);

/**
 * Where the next page starts, as `set_pagination_headers` says: when `after` was asked for, even with
 * `before`, after the page's last message, and otherwise before its first, if the room has any there.
 */
function nextPage({ messages, hasMore, hasNewer }: BotPage, { after }: PageCursor): string | null {
  if (messages.length === 0) return null;
  if (after !== undefined) return hasNewer ? `after=${messages.at(-1)!.id}` : null;
  return hasMore ? `before=${messages[0]!.id}` : null;
}

/**
 * Messages as `messages/_message.json.jbuilder` writes them, in its order of keys, each with its writer
 * as they are now and its addresses on `origin`, the host the request came to.
 */
async function messagesJson(env: Env, origin: string, messages: Message[]) {
  const writers = await peopleJson(env, origin, messages.map(({ creator }) => creator.id));
  return messages.map((message) => ({
    id: message.id,
    created_at: message.createdAt,
    // `message.body.to_s`, in Ember's layout for rich text, with mentions and link previews as they're stored, or
    // nothing for a file message, which has no rich text, as ember-rust's `body_html` gives none (presenters.rs).
    body: { plain_text: message.plainText, html: message.body === "" ? "" : `<div class="lexxy-content">\n  ${message.body}\n</div>\n` },
    // Nobody is ever deleted, so everyone who wrote a message is there.
    creator: writers.get(message.creator.id)!,
    room: { id: message.roomId },
    url: permalink(origin, message),
  }));
}

/**
 * A boost in room `roomId` as `messages/boosts/_boost.json.jbuilder` writes it, in its order of keys, with
 * its booster as they are now and its message's address on `origin`.
 */
async function boostJson(env: Env, origin: string, roomId: RoomId, boost: Boost) {
  const boosters = await peopleJson(env, origin, [boost.booster.id]);
  return {
    id: boost.id,
    content: boost.content,
    created_at: boost.createdAt,
    booster: boosters.get(boost.booster.id)!,
    message: { id: boost.messageId, url: permalink(origin, { roomId, id: boost.messageId }) },
  };
}

/** The people `ids` names, by id, as `users/_user.json.jbuilder` writes them, with their avatars' addresses on `origin`. */
async function peopleJson(env: Env, origin: string, ids: UserId[]) {
  const people = await directoryOf(await workspace(env).directoryEntries([...new Set(ids)]), env.SESSION_SECRET);
  return new Map(people.map(({ id, name, role, avatarUrl }) => [id, { id, name, role, avatar_url: `${origin}${avatarUrl}` }]));
}

/** A message's address on `origin`: its permalink, which opens its room at it. */
const permalink = (origin: string, { roomId, id }: Pick<Message, "roomId" | "id">) => `${origin}/rooms/${roomId}/@${id}`;
