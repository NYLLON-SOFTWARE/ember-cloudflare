import { threadPath, type Message, type RoomId, type User, type UserId } from "@ember/protocol";
import {
  BOTS_FORBIDDEN,
  COMMAND_NAME_TAKEN,
  NOT_IN_ROOM,
  parseNewCommand,
  parseNewShortcut,
  SHORTCUT_NAME_TAKEN,
  type Command,
  type CommandAnswer,
  type Commands,
  type Shortcut,
  type ShortcutAnswer,
  type Shortcuts,
} from "@ember/protocol/bots";
import { credentialsOf } from "../auth";
import { jsonBodyOf } from "../bodies";
import type { Env } from "../env";
import type { DeliveredMessage } from "./webhooks";
import { railsJson } from "./rails-json";
import { workspace } from "../workspace";

// Slash commands, message shortcuts and bots' subscriptions to message events (migrations/0072_commands.sql,
// migrations/0075_shortcuts.sql): what the room delivers to a bot's webhook when someone types its command,
// picks one of its shortcuts on a message, or writes a message in a room the bot watches, as Slack sends a
// slash command, a message action and a message event to a server. A bot answers either as it answers a
// delivery to its webhook, and a payload of blocks rides as a card, as a click's answer does (chat-room.ts).
// These addresses also register and forget commands and shortcuts, and put bots on rooms' message events,
// which only the workspace's administrators may do, as they alone look after bots.

/** What a delivery to a bot's webhook says of who typed or wrote what, and where, as Slack names them. */
const whereOf = (roomId: RoomId, sender: User, roomName: string | null) => ({
  channel_id: roomId,
  // A DM's name is null, as a delivery's is.
  channel_name: roomName,
  user_id: sender.id,
  user_name: sender.name,
});

/**
 * What a command's delivery carries: which command, as Slack sends it, with its "/" ("/deploy"), and
 * what was typed after it, in `text`, beside where it was typed and who typed it.
 */
export function commandPayload(roomId: RoomId, sender: User, roomName: string | null, { name }: Pick<Command, "name">, text: string): string {
  return railsJson({ command: `/${name}`, text, ...whereOf(roomId, sender, roomName) });
}

/**
 * What a message event's delivery carries, as Slack's `event_callback` does: the same who and where a
 * command's has, what the message says in `text`, and in `event` which message it was, for a bot that
 * answers commands and events apart. A reply sent only to its thread is no message event, and neither
 * is what a bot says back, which no delivery is sent for.
 */
export function eventPayload(roomId: RoomId, author: User, roomName: string | null, message: DeliveredMessage): string {
  return railsJson({
    type: "event_callback",
    ...whereOf(roomId, author, roomName),
    text: message.plainText,
    event: { type: "message", message_id: message.id, ...(message.parentId !== undefined && { thread_id: message.parentId }) },
  });
}

/**
 * What a shortcut's delivery carries, as Slack's `message_action` payload does
 * (https://docs.slack.dev/reference/interaction-payloads/message_action-payload), within what Ember
 * keeps: which shortcut ran, in `callback_id`, and the message it ran on as Slack shows one — its text,
 * when it was said, in `ts`, and the path its permalink opens — beside who picked it and where, as a
 * command's payload names them.
 */
export function messageActionPayload(roomId: RoomId, picker: User, roomName: string | null, { name }: Pick<Shortcut, "name">, message: Message): string {
  // A reply in a thread's permalink opens its thread at it, as a delivery's path does.
  const path = message.parentId === undefined ? `/rooms/${roomId}/@${message.id}` : threadPath(roomId, message.parentId, message.id);
  return railsJson({
    type: "message_action",
    callback_id: name,
    message: {
      type: "message",
      text: message.plainText,
      ts: (Date.parse(message.createdAt) / 1000).toFixed(6),
      permalink: path,
    },
    user_id: picker.id,
    user_name: picker.name,
    channel: { id: roomId, name: roomName },
  });
}

const problem = (status: number, message: string) => Response.json({ error: message }, { status });

const NOT_SIGNED_IN = "Not signed in";
/** What bots and their commands are, which no cache should keep. */
const PRIVATE = { "Cache-Control": "no-store" };

/**
 * `GET /api/account/commands`: the workspace's commands, each with its bot, and which of the bots are on
 * which rooms' message events, as the bots page and the composer's menu read them. Anyone signed in
 * reads them, since a command is what a room's composer offers to type; changing them is for the
 * workspace's administrators, as bots are.
 */
export async function listCommands(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const commands = credentials && (await workspace(env).commands(credentials));
  if (!commands) return problem(401, NOT_SIGNED_IN);
  return Response.json(commands satisfies Commands, { headers: PRIVATE });
}

/**
 * `POST /api/account/commands`, `{ botId, name, description }`: registers a command, answering 201 with
 * it as the bots page lists it. Someone who isn't an administrator hears so, a bot that isn't active
 * isn't found, and a name one of the workspace's commands has already is refused.
 */
export async function createCommand(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const changes = parseNewCommand(await jsonBodyOf(request));
  if (typeof changes === "string") return problem(422, changes);
  const registered = await workspace(env).registerCommand(credentials, changes.botId, changes);
  if (!registered) return problem(401, NOT_SIGNED_IN);
  if (registered === "forbidden") return problem(403, BOTS_FORBIDDEN);
  if (registered === "not found") return problem(404, "Not found");
  if (registered === "taken") return problem(422, COMMAND_NAME_TAKEN);
  return Response.json({ command: registered } satisfies CommandAnswer, { status: 201, headers: PRIVATE });
}

/** `DELETE /api/account/commands/:id`: forgets the command `id`, whose name is free again, answering 204. */
export async function removeCommand(request: Request, env: Env, commandId: string): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const removed = credentials && (await workspace(env).removeCommand(credentials, commandId));
  if (!removed) return problem(401, NOT_SIGNED_IN);
  if (removed === "forbidden") return problem(403, BOTS_FORBIDDEN);
  if (removed === "not found") return problem(404, "Not found");
  return new Response(null, { status: 204, headers: PRIVATE });
}

/**
 * `GET /api/account/shortcuts`: the workspace's shortcuts, each with its bot, as the bots page lists
 * them and a message's More actions offers them. Anyone signed in reads them, as the commands: changing
 * them is for the workspace's administrators, as bots are.
 */
export async function listShortcuts(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const shortcuts = credentials && (await workspace(env).shortcuts(credentials));
  if (!shortcuts) return problem(401, NOT_SIGNED_IN);
  return Response.json(shortcuts satisfies Shortcuts, { headers: PRIVATE });
}

/**
 * `POST /api/account/shortcuts`, `{ botId, name, description }`: registers a shortcut, answering 201 with
 * it as the bots page lists it. Someone who isn't an administrator hears so, a bot that isn't active
 * isn't found, and a name one of the workspace's shortcuts has already is refused.
 */
export async function createShortcut(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const changes = parseNewShortcut(await jsonBodyOf(request));
  if (typeof changes === "string") return problem(422, changes);
  const registered = await workspace(env).registerShortcut(credentials, changes.botId, changes);
  if (!registered) return problem(401, NOT_SIGNED_IN);
  if (registered === "forbidden") return problem(403, BOTS_FORBIDDEN);
  if (registered === "not found") return problem(404, "Not found");
  if (registered === "taken") return problem(422, SHORTCUT_NAME_TAKEN);
  return Response.json({ shortcut: registered } satisfies ShortcutAnswer, { status: 201, headers: PRIVATE });
}

/** `DELETE /api/account/shortcuts/:id`: forgets the shortcut `id`, whose name is free again, answering 204. */
export async function removeShortcut(request: Request, env: Env, shortcutId: string): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const removed = credentials && (await workspace(env).removeShortcut(credentials, shortcutId));
  if (!removed) return problem(401, NOT_SIGNED_IN);
  if (removed === "forbidden") return problem(403, BOTS_FORBIDDEN);
  if (removed === "not found") return problem(404, "Not found");
  return new Response(null, { status: 204, headers: PRIVATE });
}

/**
 * `PUT /api/account/bots/:id/rooms/:roomId/events`: puts the bot on the room's message events, answering
 * 204. The bot has to be in the room, as it hears only what its rooms say, and someone who isn't an
 * administrator hears so first.
 */
export async function subscribeToRoomMessages(request: Request, env: Env, botId: UserId, roomId: RoomId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const subscribed = await workspace(env).subscribeToMessages(credentials, botId, roomId);
  if (!subscribed) return problem(401, NOT_SIGNED_IN);
  if (subscribed === "forbidden") return problem(403, BOTS_FORBIDDEN);
  if (subscribed === "not found") return problem(404, "Not found");
  if (subscribed === "not in room") return problem(422, NOT_IN_ROOM);
  return new Response(null, { status: 204, headers: PRIVATE });
}

/** `DELETE /api/account/bots/:id/rooms/:roomId/events`: takes the bot off the room's message events, answering 204. */
export async function unsubscribeFromRoomMessages(request: Request, env: Env, botId: UserId, roomId: RoomId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const unsubscribed = credentials && (await workspace(env).unsubscribeFromMessages(credentials, botId, roomId));
  if (!unsubscribed) return problem(401, NOT_SIGNED_IN);
  if (unsubscribed === "forbidden") return problem(403, BOTS_FORBIDDEN);
  return new Response(null, { status: 204, headers: PRIVATE });
}
