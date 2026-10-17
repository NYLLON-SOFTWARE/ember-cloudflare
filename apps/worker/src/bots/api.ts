import { MAX_MESSAGE_HTML_LENGTH, type Message, type RoomId, type User } from "@ember/protocol";
import { directoryOf } from "../avatar-tokens";
import type { BotPage } from "../chat-room";
import type { Env } from "../env";
import { etagOf, isFresh } from "../etag";
import type { PageCursor } from "../store";
import { workspace } from "../workspace";
import { botKeyParts } from "./keys";

// The bot API, as ember-rust's `Messages::ByBotsController` answers it (crates/ember/src/controllers/
// messages/by_bots.rs): a bot posts to a room it's in, and reads it, at /rooms/<room id>/<bot key>/messages.
// The key is all a bot has, so these routes never read a session cookie, which leaves another site's
// page nothing to forge.

/** A room's address for bots, `room_bot_messages`, with or without `.json`. */
const BOT_MESSAGES = /^\/rooms\/([^/.]+)\/([^/.]+)\/messages(?:\.json)?$/;

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

/** What answers a request to a room's address for bots, if it's one the bot API takes. */
export function botAction(request: Request, env: Env, pathname: string): (() => Promise<Response>) | null {
  const route = pathname.match(BOT_MESSAGES);
  if (!route) return null;
  const [roomId, key] = [route[1]!, route[2]!];
  if (request.method === "POST") return () => createMessage(request, env, roomId, key);
  if (request.method === "GET" || request.method === "HEAD") return () => listMessages(request, env, roomId, key);
  return null;
}

/** Whether `pathname` is a room's address for bots, whose failures answer JSON. */
export const isBotPath = (pathname: string) => BOT_MESSAGES.test(pathname);

/** `text` with every bot key in an address `[FILTERED]`, as Campfire's log lines have them. */
export const withoutBotKeys = (text: string) => text.replace(BOT_KEY_IN_PATH, "$1[FILTERED]");

/** An exception, as ember-rust answers one for JSON (crates/kit/src/exceptions.rs). */
export const exception = (status: keyof typeof REASONS) =>
  new Response(JSON.stringify({ status, error: REASONS[status] }), { status, headers: { "Content-Type": "application/json; charset=UTF-8" } });

/** `head status`, an empty answer, as ember-rust's `concerns::head` gives one. */
const head = (status: number) => new Response(null, { status, headers: { "Content-Type": "text/html" } });

/** What a key that names no active bot answers, where ember-rust sends the request to sign in. */
const unknownKey = () => Response.json({ error: UNKNOWN_BOT_KEY }, { status: 401 });

/**
 * The bot the key segment `key` names, as ember-rust's `allow_bot_access` finds it, if it's in room
 * `roomId`, as `set_room` finds the room, or what the request answers otherwise: 401 unless the key is an
 * active bot's own, and an empty 404 when the bot isn't in the room.
 */
async function botIn(env: Env, roomId: RoomId, key: string): Promise<User | Response> {
  const parts = botKeyParts(segmentText(key));
  const bot = parts && (await workspace(env).botInRoom(parts.botId, parts.token, roomId));
  if (!bot) return unknownKey();
  return bot === "not found" ? head(404) : bot;
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
  let bot = await botIn(env, roomId, key);
  if (bot instanceof Response) return bot;
  if (isForm(request)) return Response.json({ error: FILES_NOT_YET }, { status: 415 });
  const markup = await bodyText(request);
  if (markup === null) return exception(413);
  // ember-rust checks the key once it has the whole body, which here arrives as slowly as its sender
  // likes: long enough for the bot to be deleted, given a new key or taken out of the room since the check
  // above, which only spares reading the body of a request that can't post.
  bot = await botIn(env, roomId, key);
  if (bot instanceof Response) return bot;
  // `raw_request_body.blank?`: empty or only spaces.
  if (markup.trim() === "") return head(422);
  const created = await env.CHAT_ROOM.getByName(roomId).createBotMessage(roomId, bot, markup);
  if (!created) return head(404);
  if (typeof created === "string") return Response.json({ error: created }, { status: 422 });
  const location = permalink(new URL(request.url).origin, created);
  return new Response(null, { status: 201, headers: { Location: location, "Content-Type": "application/json; charset=utf-8" } });
}

/** Whether the request sends a form, as `curl -F` sends a file, which bots can't post until files can be stored. */
const isForm = (request: Request) => /^multipart\/form-data\s*(;|$)/i.test(request.headers.get("Content-Type")?.trim() ?? "");

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
  const bot = await botIn(env, roomId, key);
  if (bot instanceof Response) return bot;
  const url = new URL(request.url);
  const cursor = { before: present(url.searchParams.get("before")), after: present(url.searchParams.get("after")) };
  const page = await env.CHAT_ROOM.getByName(roomId).botPage(roomId, cursor);
  if (!page) return exception(404);

  const body = railsJson(await messagesJson(env, url.origin, page.messages));
  const etag = await etagOf(body);
  const headers = new Headers({ "X-Total-Count": String(page.total), ETag: etag, "Cache-Control": "max-age=0, private, must-revalidate" });
  const next = nextPage(page, cursor);
  if (next) headers.set("Link", `<${url.origin}/rooms/${roomId}/${key}/messages?${next}>; rel="next"`);
  if (isFresh(request, etag)) return new Response(null, { status: 304, headers });
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(request.method === "HEAD" ? null : body, { headers });
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
  const ids = [...new Set(messages.map(({ creator }) => creator.id))];
  const writers = new Map((await directoryOf(await workspace(env).directoryEntries(ids), env.SESSION_SECRET)).map((writer) => [writer.id, writer]));
  return messages.map((message) => {
    // Nobody is ever deleted, so everyone who wrote a message is there.
    const { id, name, role, avatarUrl } = writers.get(message.creator.id)!;
    return {
      id: message.id,
      created_at: message.createdAt,
      // `message.body.to_s`, in Ember's layout for rich text, with mentions and link previews as they're stored.
      body: { plain_text: message.plainText, html: `<div class="lexxy-content">\n  ${message.body}\n</div>\n` },
      creator: { id, name, role, avatar_url: `${origin}${avatarUrl}` },
      room: { id: message.roomId },
      url: permalink(origin, message),
    };
  });
}

/** A message's address on `origin`: its permalink, which opens its room at it. */
const permalink = (origin: string, { roomId, id }: Message) => `${origin}/rooms/${roomId}/@${id}`;

/** `value` as `ActiveSupport::JSON` writes it: with `<`, `>` and `&` escaped, as `\u003c`, `\u003e` and `\u0026`. */
const railsJson = (value: unknown) => JSON.stringify(value).replace(/[<>&]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
