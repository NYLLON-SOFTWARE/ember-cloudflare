import { commandNameOf, isReservedName, NAME_RESERVED, MAX_COMMAND_NAME_LENGTH, MAX_USER_NAME_LENGTH, type DirectoryUser, type RoomId, type User, type UserId } from "./index.ts";

// Chat bots, as administrators add, change and delete them through `/api/account/bots`, as Campfire's
// `accounts/bots` and `accounts/bots/keys` controllers do.

/**
 * Where a bot posts messages to a room and reads them, as Campfire's `room_bot_messages_path` gives it,
 * with the bot's key: `/rooms/<room id>/<bot key>/messages`, and with `threadId`, where it posts to that
 * message's thread and reads it.
 */
export const botMessagesPath = (roomId: RoomId, key: string, threadId?: string) =>
  `/rooms/${encodeURIComponent(roomId)}/${key}/messages` + (threadId === undefined ? "" : `?thread=${encodeURIComponent(threadId)}`);

/** Where a bot posts what a Slack incoming webhook is sent to a room, with the bot's key: `/rooms/<room id>/<bot key>/slack`. */
export const botSlackPath = (roomId: RoomId, key: string) => `/rooms/${encodeURIComponent(roomId)}/${key}/slack`;

/**
 * Where a bot posts what a Slack incoming webhook is sent to take the place of its message `messageId`, with
 * the bot's key: `/rooms/<room id>/<bot key>/messages/<message id>/slack`.
 */
export const botMessageSlackPath = (roomId: RoomId, key: string, messageId: string) =>
  `/rooms/${encodeURIComponent(roomId)}/${key}/messages/${encodeURIComponent(messageId)}/slack`;

/** What the bot pages and their API tell anyone but an administrator. */
export const BOTS_FORBIDDEN = "Only administrators can manage bots";

/** The longest webhook URL saved. */
export const MAX_WEBHOOK_URL_LENGTH = 2048;

/** Why a webhook URL is refused: one is delivered only to https, or to http on localhost. */
export const WEBHOOK_URL_REFUSED = "Webhook URL must be an https URL, or an http one on localhost";

/** A room a bot is in, which the bots page shows its commands for. */
export interface BotRoom {
  id: RoomId;
  name: string;
}

/** A bot as the bots page lists it: as the people directory lists it, with its key and its rooms. */
export interface Bot extends DirectoryUser {
  /** What its API's addresses carry, `<id>-<token>`, which only administrators are told. */
  key: string;
  /** The rooms it's in but its DMs, by name. */
  rooms: BotRoom[];
}

/** A bot as its edit page shows it: as the bots page lists it, with where its webhook delivers, or null for nowhere. */
export interface BotSettings extends Bot {
  webhookUrl: string | null;
}

/** What `GET /api/account/bots` answers: the active bots, by name. */
export interface Bots {
  bots: Bot[];
}

/**
 * What `GET /api/account/bots/<id>` answers, and `POST /api/account/bots`, `PATCH /api/account/bots/<id>`
 * and `PUT /api/account/bots/<id>/key`, which add a bot, change one and give one a new key.
 */
export interface BotAnswer {
  bot: BotSettings;
}

/**
 * What `PATCH /api/account/bots/<id>` changes, as the bot form saves it: the bot's name, and where its
 * webhook delivers, "" for nowhere. What's left out stays as it is.
 */
export interface BotChanges {
  name?: string;
  webhookUrl?: string;
}

/** What `POST /api/account/bots` takes, as the bot form adds one: a name, and where its webhook delivers, if anywhere. */
export interface NewBot {
  name: string;
  webhookUrl?: string;
}

/**
 * Parses an untrusted change to a bot. Returns why it's refused instead: a name has to have more than
 * spaces, and no more than a person's name can (`MAX_USER_NAME_LENGTH`). The name is saved as typed, and
 * the webhook URL trimmed, as the form's URL field sends it; the Worker checks that it's a URL.
 */
export function parseBotChanges(data: unknown): BotChanges | string {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "Expected a JSON object";
  const { name, webhookUrl } = data as Record<string, unknown>;
  const changes: BotChanges = {};
  if (name !== undefined) {
    if (typeof name !== "string") return "Name must be text";
    if (!name.trim()) return "Name can't be blank";
    if (name.length > MAX_USER_NAME_LENGTH) return `Name can't be longer than ${MAX_USER_NAME_LENGTH} characters`;
    changes.name = name;
  }
  if (webhookUrl !== undefined) {
    if (typeof webhookUrl !== "string") return "Webhook URL must be text";
    const url = webhookUrl.trim();
    if (url.length > MAX_WEBHOOK_URL_LENGTH) return `Webhook URL can't be longer than ${MAX_WEBHOOK_URL_LENGTH} characters`;
    changes.webhookUrl = url;
  }
  return changes;
}

/**
 * Parses an untrusted new bot, as `parseBotChanges` does a change, which also needs a name, and not
 * @ember's (`isReservedName`). A bot that has that name already keeps it, so the Worker checks a new name
 * for one.
 */
export function parseNewBot(data: unknown): NewBot | string {
  const changes = parseBotChanges(data);
  if (typeof changes === "string") return changes;
  if (changes.name === undefined) return "Name can't be blank";
  return isReservedName(changes.name) ? NAME_RESERVED : { ...changes, name: changes.name };
}

// Slash commands and bots' subscriptions to message events, as administrators add and take them away
// through `/api/account/commands` and a bot's rooms' addresses there, as Slack's slash commands and
// event subscriptions have a workspace's.

export { MAX_COMMAND_NAME_LENGTH, commandNameOf };

/** The longest description a command can have. */
export const MAX_COMMAND_DESCRIPTION_LENGTH = 200;

/** Why a command's name is refused: letters, numbers, dashes and underscores, one case. */
export const COMMAND_NAME_REFUSED = "A command's name is letters, numbers, dashes and underscores";

/** Why a command with a name that's taken already is refused, as Slack keeps its commands' names apart. */
export const COMMAND_NAME_TAKEN = "A command with that name is registered already";

/** Why a bot is refused for a room's message events it isn't in the room for. */
export const NOT_IN_ROOM = "The bot has to be in the room first";

/** A command as the bots page and the composer's menu list it: its name, what it's for, and the bot it invokes. */
export interface Command {
  id: string;
  /** The name as it's kept, without the leading "/" and lowercased, which typing either way finds. */
  name: string;
  description: string | null;
  /** The bot it invokes, as rooms and lists name it. */
  bot: User;
}

/** A bot's subscription to a room's message events, as the bots page ticks it. */
export interface EventSubscription {
  botId: UserId;
  roomId: RoomId;
}

/** What `GET /api/account/commands` answers: the workspace's commands, and bots' subscriptions, by bot and room. */
export interface Commands {
  commands: Command[];
  subscriptions: EventSubscription[];
}

/** What `POST /api/account/commands` answers, once it has registered one. */
export interface CommandAnswer {
  command: Command;
}

/** What `POST /api/account/commands` takes: the bot it invokes, a name, and what it's for, if anything. */
export interface NewCommand {
  botId: UserId;
  name: string;
  description?: string;
}

/**
 * Parses an untrusted new command. Returns why it's refused instead: a name has to be one
 * (`commandNameOf`), of no more than `MAX_COMMAND_DESCRIPTION_LENGTH` characters when there is one,
 * and the bot it invokes a person's id.
 */
export function parseNewCommand(data: unknown): NewCommand | string {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "Expected a JSON object";
  const { botId, name, description } = data as Record<string, unknown>;
  if (typeof botId !== "string" || !botId) return "Which bot it invokes must be a person";
  if (typeof name !== "string") return "Name must be text";
  const kept = commandNameOf(name);
  if (!kept) return COMMAND_NAME_REFUSED;
  if (description === undefined) return { botId, name: kept };
  if (typeof description !== "string") return "Description must be text";
  const trimmed = description.trim();
  if (trimmed.length > MAX_COMMAND_DESCRIPTION_LENGTH) return `Description can't be longer than ${MAX_COMMAND_DESCRIPTION_LENGTH} characters`;
  return { botId, name: kept, ...(trimmed !== "" && { description: trimmed }) };
}

// Message shortcuts, as administrators add and take them away through `/api/account/shortcuts`, as
// Slack's message shortcuts have a workspace's: a name as it's shown ("Translate this"), what it's
// for, and the bot it invokes. Picking one in a message's More actions delivers a Slack-shaped
// `message_action` payload about that message to the bot's webhook, as a command's delivery is, and
// what the bot answers is posted as the bot.

/** The longest name a shortcut can have, where Slack gives a shortcut's name 80 characters. */
export const MAX_SHORTCUT_NAME_LENGTH = 80;

/** Why a shortcut with a name that's taken already is refused, as Slack keeps its shortcuts' names apart. */
export const SHORTCUT_NAME_TAKEN = "A shortcut with that name is registered already";

/** A shortcut as the bots page lists it and a message's More actions offers it: its name, what it's for, and the bot it invokes. */
export interface Shortcut {
  id: string;
  /** The name as it's kept, as it's shown: "Translate this", capitals and all, where a command's is one case. */
  name: string;
  description: string | null;
  /** The bot it invokes, as rooms and lists name it. */
  bot: User;
}

/** What `GET /api/account/shortcuts` answers: the workspace's shortcuts, by name. */
export interface Shortcuts {
  shortcuts: Shortcut[];
}

/** What `POST /api/account/shortcuts` answers, once it has registered one. */
export interface ShortcutAnswer {
  shortcut: Shortcut;
}

/** What `POST /api/account/shortcuts` takes: the bot it invokes, its name, and what it's for, if anything. */
export interface NewShortcut {
  botId: UserId;
  name: string;
  description?: string;
}

/**
 * Parses an untrusted new shortcut. Returns why it's refused instead: a name has to have more than
 * spaces, and no more than `MAX_SHORTCUT_NAME_LENGTH` of them, kept as they're typed — a shortcut's
 * name is shown, where a command's is a name to type — its description no more than a command's can
 * have when there is one, and the bot it invokes a person's id.
 */
export function parseNewShortcut(data: unknown): NewShortcut | string {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "Expected a JSON object";
  const { botId, name, description } = data as Record<string, unknown>;
  if (typeof botId !== "string" || !botId) return "Which bot it invokes must be a person";
  if (typeof name !== "string") return "Name must be text";
  const kept = name.trim();
  if (!kept) return "Name can't be blank";
  if (kept.length > MAX_SHORTCUT_NAME_LENGTH) return `Name can't be longer than ${MAX_SHORTCUT_NAME_LENGTH} characters`;
  if (description === undefined) return { botId, name: kept };
  if (typeof description !== "string") return "Description must be text";
  const trimmed = description.trim();
  if (trimmed.length > MAX_COMMAND_DESCRIPTION_LENGTH) return `Description can't be longer than ${MAX_COMMAND_DESCRIPTION_LENGTH} characters`;
  return { botId, name: kept, ...(trimmed !== "" && { description: trimmed }) };
}
