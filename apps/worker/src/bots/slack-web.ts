import { isRoomId, MESSAGE_TOO_LONG, type Message, type RoomId } from "@ember/protocol";
import { bodyUpTo } from "../bodies";
import { EMPTY, FORBIDDEN, NOT_FOUND } from "../chat-room";
import type { Env } from "../env";
import { formBoundaryOf, isFormType } from "../files/form-parts";
import { urlOf } from "../request-url";
import type { BotSlackRoom } from "../workspace-store";
import { workspace } from "../workspace";
import { MAX_BODY_BYTES } from "./api";
import { botKeyParts } from "./keys";
import { payloadOf, slackMessage, type SlackError, type SlackPayload } from "./slack";

// Slack's Web API (https://docs.slack.dev/apis/web-api), which bots' scripts and SDKs call: they POST to
// /api/<method> with the bot's key as a bearer token and read `{ ok, ... }` at 200, so tools written for
// Slack work against Ember by swapping the address they call and the token they send. What a payload
// posts is read as a Slack incoming webhook's is (slack.ts), which leaves what Slack lets a payload
// change about who posts and where — `username`, `icon_emoji` and `icon_url` — out, as the bot posts as
// itself. A `ts` is a message's id; `channel` names a room by its id, or one of the bot's rooms by its
// name, with or without its "#". The key is all a bot has, so these routes never read a session cookie,
// which leaves another site's page nothing to forge.

/** The methods the Slack-compatible Web API takes, at Slack's addresses for them. */
const METHODS = /^\/api\/(?:auth\.test|chat\.(?:postMessage|update|delete)|conversations\.(?:list|history))$/;

/** Whether `pathname` is one of the Slack-compatible Web API's addresses, whose failures answer its envelope. */
export const isSlackWebApiPath = (pathname: string) => METHODS.test(pathname);

/** What a request to one of those addresses answers, or null for anything else. */
export function slackWebAction(request: Request, env: Env, pathname: string): (() => Promise<Response>) | null {
  switch (pathname) {
    case "/api/auth.test":
      return request.method === "POST" ? () => authTest(env, request) : null;
    case "/api/chat.postMessage":
      return request.method === "POST" ? () => postMessage(env, request) : null;
    case "/api/chat.update":
      return request.method === "POST" ? () => chatUpdate(env, request) : null;
    case "/api/chat.delete":
      return request.method === "POST" ? () => chatDelete(env, request) : null;
    case "/api/conversations.list":
      return request.method === "GET" || request.method === "POST" ? () => conversationsList(env, request) : null;
    case "/api/conversations.history":
      return request.method === "POST" ? () => conversationsHistory(env, request) : null;
    default:
      return null;
  }
}

/** Why a method answers with nothing, in Slack's words for it. */
type SlackWebError = SlackError | "invalid_auth" | "channel_not_found" | "not_in_channel" | "message_not_found" | "cant_update_message" | "cant_delete_message";

/** What a method answers having worked, as Slack's JSON has it: its envelope, always at 200. */
const answered = (fields: Record<string, unknown>) => Response.json({ ok: true, ...fields });

/** What a method answers with instead of what was asked for. */
const refused = (error: SlackWebError) => Response.json({ ok: false, error });

/** The bot key a request sends as its bearer token, or "" for anything else its header names. */
const bearerKeyOf = (request: Request): string => (request.headers.get("Authorization") ?? "").match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? "";

/** The active bot the request's bearer key names, or what every method answers for a key no bot has. */
async function botIn(env: Env, request: Request) {
  const found = await workspace(env).slackBot(bearerKeyOf(request));
  return found ?? refused("invalid_auth");
}

/**
 * The active bot the request's bearer key names, in the room the fields' `channel` names: its id, or one
 * of the bot's rooms by its name, with or without its "#". Or what its caller answers instead:
 * `invalid_auth` for a key no active bot has, `channel_not_found` for a channel that names no room,
 * `not_in_channel` for one that is there but keeps the bot out.
 */
async function botChannelIn(env: Env, request: Request, fields: SlackPayload) {
  const key = bearerKeyOf(request);
  const parts = botKeyParts(key);
  const bot = parts === null ? null : await workspace(env).slackBot(key);
  if (parts === null || bot === null) return refused("invalid_auth");
  const channel = textOf(fields.channel).replace(/^#/, "");
  const roomId = bot.rooms.find(({ name }) => name.toLowerCase() === channel.toLowerCase())?.id ?? (isRoomId(channel) ? channel : null);
  if (roomId === null) return refused("channel_not_found");
  const access = await workspace(env).botInRoom(parts.botId, parts.token, roomId);
  if (!access) return refused("invalid_auth");
  if (access === "not found") return refused((await workspace(env).roomExists(roomId)) ? "not_in_channel" : "channel_not_found");
  return { roomId, access };
}

/**
 * The fields a request carries: its query's, and, on a POST, its body's — JSON, or a form's,
 * urlencoded or multipart, whose `payload` field's JSON stands for them all as a webhook's does — a
 * body's field for the query's of the same name. Null for a body that's neither JSON nor a form, and
 * what the request answers for one longer than a payload can be, as Slack answers `msg_too_long`.
 */
async function fieldsIn(request: Request): Promise<SlackPayload | Response> {
  const query = Object.fromEntries(urlOf(request).searchParams);
  if (request.method !== "POST") return query;
  const text = await bodyUpTo(request, MAX_BODY_BYTES);
  if (text === null) return refused("msg_too_long");
  const type = request.headers.get("Content-Type");
  const fields = isFormType(type) ? await formFieldsOf(text, type!) : formType.test(type ?? "") ? formFieldsOfUrlencoded(text) : payloadOf(text.trim() === "" ? "{}" : text);
  if (fields === null) return refused("invalid_payload");
  return { ...query, ...fields };
}

/** A urlencoded body's type, which its fields are read from as a form's. */
const formType = /application\/x-www-form-urlencoded/i;

/** The fields of the multipart form `text`, of type `type`, or null when it can't be read. */
async function formFieldsOf(text: string, type: string): Promise<SlackPayload | null> {
  if (formBoundaryOf(type) === null) return null;
  let form: FormData;
  try {
    form = await new Response(text, { headers: { "Content-Type": type } }).formData();
  } catch {
    return null;
  }
  const fields: SlackPayload = {};
  for (const [name, value] of form.entries()) if (typeof value === "string") fields[name] = value;
  return withPayloadField(fields);
}

/** The fields of a urlencoded body, as Slack's methods take them: one for every pair its query holds. */
function formFieldsOfUrlencoded(text: string): SlackPayload {
  return withPayloadField(Object.fromEntries(new URLSearchParams(text)));
}

/** The fields, taking a `payload` field's JSON for them, as an incoming webhook's body is read. */
function withPayloadField(fields: SlackPayload): SlackPayload {
  const payload = typeof fields.payload === "string" ? payloadOf(fields.payload) : null;
  return payload ?? fields;
}

/** `POST /api/auth.test`: who the bearer key names, as Slack's answer has it. */
async function authTest(env: Env, request: Request): Promise<Response> {
  const bot = await botIn(env, request);
  return bot instanceof Response ? bot : answered({ user_id: bot.bot.id, user: bot.bot.name });
}

/** `POST /api/chat.postMessage`: posts what the fields post, as the bot's message in the room or thread they name, and answers with where it is. */
async function postMessage(env: Env, request: Request): Promise<Response> {
  const fields = await fieldsIn(request);
  if (fields instanceof Response) return fields;
  const inChannel = await botChannelIn(env, request, fields);
  if (inChannel instanceof Response) return inChannel;
  const thread = textOf(fields.thread_ts);
  const message = slackMessage(fields);
  if (typeof message === "string") return refused(message);
  const created = await env.CHAT_ROOM.getByName(inChannel.roomId).createBotMessage(inChannel.roomId, inChannel.access, message.markup, message.cards, present(thread));
  if (!created) return refused(thread === "" ? "channel_not_found" : "message_not_found");
  if (typeof created === "string") return refused(whyNothingKept(created));
  return answered({ channel: inChannel.roomId, ts: created.id, message: messageJson(created) });
}

/** `POST /api/chat.update`: replaces the bot's message `ts` with what the fields post, answering it as it is now. */
async function chatUpdate(env: Env, request: Request): Promise<Response> {
  const fields = await fieldsIn(request);
  if (fields instanceof Response) return fields;
  const inChannel = await botChannelIn(env, request, fields);
  if (inChannel instanceof Response) return inChannel;
  const ts = textOf(fields.ts);
  if (ts === "") return refused("message_not_found");
  const message = slackMessage(fields);
  if (typeof message === "string") return refused(message);
  const edited = await env.CHAT_ROOM.getByName(inChannel.roomId).editBotMessage(inChannel.roomId, inChannel.access, ts, message.markup, message.cards);
  if (edited === NOT_FOUND) return refused("message_not_found");
  if (edited === FORBIDDEN) return refused("cant_update_message");
  if (typeof edited === "string") return refused(whyNothingKept(edited));
  return answered({ channel: inChannel.roomId, ts: edited.id, message: messageJson(edited) });
}

/** `POST /api/chat.delete`: takes the bot's message `ts` in the room `channel` names away. */
async function chatDelete(env: Env, request: Request): Promise<Response> {
  const fields = await fieldsIn(request);
  if (fields instanceof Response) return fields;
  const inChannel = await botChannelIn(env, request, fields);
  if (inChannel instanceof Response) return inChannel;
  const ts = textOf(fields.ts);
  if (ts === "") return refused("message_not_found");
  const refusal = await env.CHAT_ROOM.getByName(inChannel.roomId).deleteBotMessage(inChannel.roomId, inChannel.access, ts);
  if (refusal === NOT_FOUND) return refused("message_not_found");
  if (refusal === FORBIDDEN) return refused("cant_delete_message");
  return answered({ channel: inChannel.roomId, ts });
}

/** `GET` or `POST /api/conversations.list`: the rooms the bot is in but its DMs, as Slack's channels. */
async function conversationsList(env: Env, request: Request): Promise<Response> {
  const bot = await botIn(env, request);
  return bot instanceof Response ? bot : answered({ channels: bot.rooms.map(channelJson) });
}

/** `POST /api/conversations.history`: the newest `limit` of the room's messages, oldest first, with whether there are older ones. */
async function conversationsHistory(env: Env, request: Request): Promise<Response> {
  const fields = await fieldsIn(request);
  if (fields instanceof Response) return fields;
  const inChannel = await botChannelIn(env, request, fields);
  if (inChannel instanceof Response) return inChannel;
  const history = await historyIn(env, inChannel.roomId, limitOf(fields.limit));
  // The room is there, so its page is there to read.
  if (history === null) return refused("channel_not_found");
  return answered({ channel: inChannel.roomId, messages: history.messages.map(messageJson), has_more: history.hasMore });
}

/** How many messages a history read takes: `limit`, between 1 and 1000, or 100, as Slack reads none. */
const limitOf = (limit: unknown) => {
  const asked = Number(limit);
  return Number.isInteger(asked) && asked > 0 ? Math.min(asked, 1000) : 100;
};

/**
 * The newest `limit` of a room's messages, oldest first, with whether the room has older ones than the
 * oldest answered: the pages a bot reads, gathered back from the newest until it has `limit`.
 */
async function historyIn(env: Env, roomId: RoomId, limit: number): Promise<{ messages: Message[]; hasMore: boolean } | null> {
  const room = env.CHAT_ROOM.getByName(roomId);
  const first = await room.botPage(roomId, {});
  if (first === null) return null;
  const collected = [...first.messages];
  let hasMore = first.hasMore;
  while (hasMore && collected.length < limit) {
    const older = await room.botPage(roomId, { before: collected[0]!.id });
    if (!older || older.messages.length === 0) break;
    collected.unshift(...older.messages);
    hasMore = older.hasMore;
  }
  return { messages: collected.slice(-limit).filter(({ deleted }) => deleted !== true), hasMore: hasMore || collected.length > limit };
}

/** A message as Slack's API writes one: its plain text as `text`, its id as `ts`, and who wrote it as `user`. */
const messageJson = ({ plainText, id, creator }: Message) => ({ type: "message", text: plainText, ts: id, user: creator.id });

/** A room as Slack's API lists one: its id and name, which kinds it is and isn't, and when it was made and by whom. */
const channelJson = ({ id, name, closed, createdAt, creatorId }: BotSlackRoom) => ({
  id,
  name,
  name_normalized: name,
  is_channel: !closed,
  is_group: closed,
  is_im: false,
  is_mpim: false,
  is_private: closed,
  is_shared: false,
  is_archived: false,
  is_member: true,
  created: secondsOf(createdAt),
  ...(creatorId !== null && { creator: creatorId }),
});

/** A moment, as the room saved it, as Slack writes one: in seconds. */
const secondsOf = (at: string) => {
  const time = new Date(at).getTime();
  return Number.isNaN(time) ? 0 : Math.floor(time / 1000);
};

/** Slack's words for why the room keeps nothing of a message. */
const whyNothingKept = (reason: string): SlackWebError => (reason === MESSAGE_TOO_LONG ? "msg_too_long" : reason === EMPTY ? "no_text" : "invalid_payload");

/** A field as Slack reads a `present?` one: absent when it's missing or blank. */
const present = (value: string) => (value.trim() === "" ? undefined : value);

/** A field's value as text, or "" for anything else. */
const textOf = (value: unknown) => (typeof value === "string" ? value : "");

/** What an exception answers, as Slack's envelope has it, where a method's own answer refuses instead. */
export const slackWebFailure = () => Response.json({ ok: false, error: "internal_error" }, { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
