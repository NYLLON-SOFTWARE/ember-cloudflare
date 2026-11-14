import { type BotAnswer, type BotSettings, type NewWorkspace, type RoomId, type ServerFrame, type User } from "@ember/protocol";
import { botMessagesPath, type Commands } from "@ember/protocol/bots";
import { MENTION_CONTENT_TYPE, mentionSgid } from "@ember/richtext";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, connect, cookieOf, freshDeploy, framesOf, post, settle, shown, signIn, workspaceSql, forwardUpgrade, type Session, type Socket } from "./support";

// Slash commands and bots' subscriptions to message events (migrations/0065_commands.sql): typing
// /name text in a room the bot is in delivers what was typed to its webhook, as Slack tells a slash
// command to a server, and what the bot answers is posted as the bot, as its answer to any delivery is.
// A room the bot watches delivers every message written there by someone else, shaped the same way, its
// own least of all, one delivery for whoever it's to, mention or no.

const WEBHOOK = "https://bots.example.com/hook";

/** Sets Ember up with Ada as its administrator, and a bot in first run's general room, whose webhook delivers to `webhookUrl`, if it's given. */
async function withBot(webhookUrl: string | undefined = WEBHOOK): Promise<{ ada: Session; bot: BotSettings; general: RoomId }> {
  const setUp = await api("/api/first_run", { method: "POST", body: JSON.stringify({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" }) });
  expect(setUp.status).toBe(201);
  const ada = { user: shown(((await setUp.json()) as NewWorkspace).user), cookie: cookieOf(setUp) };
  const added = await api("/api/account/bots", { method: "POST", headers: { Cookie: ada.cookie }, body: JSON.stringify({ name: "Deploy Bot", webhookUrl }) });
  expect(added.status, await added.clone().text()).toBe(201);
  const [{ id: general }] = (await workspaceSql("SELECT id FROM rooms WHERE name = 'general'")) as [{ id: RoomId }];
  return { ada, bot: ((await added.json()) as BotAnswer).bot, general };
}

/** Registers a command for the bot `botId`, as `session` asks, answering how the Worker answered. */
const register = (session: Session, botId: string, name: string, description?: string) =>
  api("/api/account/commands", { method: "POST", headers: { Cookie: session.cookie }, body: JSON.stringify({ botId, name, ...(description !== undefined && { description }) }) });

/** Puts the bot `botId` on room `roomId`'s message events, as `session` ticks it, answering how the Worker answered. */
const subscribe = (session: Session, botId: string, roomId: RoomId) =>
  api(`/api/account/bots/${botId}/rooms/${roomId}/events`, { method: "PUT", headers: { Cookie: session.cookie } });

/** Registers `/deploy` for `bot`, as `session`. */
async function registerDeploy(session: Session, botId: string): Promise<void> {
  expect((await register(session, botId, "deploy", "Ship the build")).status, "registering /deploy").toBe(201);
}

/** A request a webhook got: where it went, and how it was sent. */
interface Delivery {
  url: string;
  init: RequestInit;
}

/** Stands in for every webhook, answering each request with `answer`, by default a bare 200, and keeps the requests, in the order they came. */
function bots(answer: (delivery: Delivery) => Promise<Response> = async () => new Response(null, { status: 200 })) {
  const delivered: Delivery[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const delivery = { url: input instanceof Request ? input.url : String(input), init: init! };
    delivered.push(delivery);
    return answer(delivery);
  });
  return delivered;
}

/** Stands in for every webhook, answering each request with `payload` as JSON. */
const botsAnswering = (payload: unknown) => bots(async () => Response.json(payload));

/** What the request `delivery` sent, read as JSON. */
const sentIn = (delivery: Delivery) => JSON.parse(delivery.init.body as string) as Record<string, unknown>;

/** How a message of `person`'s mentions them. */
const mention = (person: Pick<User, "id">) => `<action-text-attachment sgid="${mentionSgid(person.id)}" content-type="${MENTION_CONTENT_TYPE}"></action-text-attachment>`;

/** Sends `/name text` from `client`, answering its id. */
function run(client: Socket, name: string, text = ""): string {
  const commandId = crypto.randomUUID();
  client.send({ type: "command.run", commandId, name, text });
  return commandId;
}

beforeEach(freshDeploy);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Registering commands", () => {
  it("registers a command as an administrator, which anyone signed in reads, and takes it away again", async () => {
    const { ada, bot } = await withBot();
    const grace = await signIn("Grace Hopper");

    expect((await register(grace, bot.id, "deploy")).status).toBe(403);
    expect(await (await register(ada, bot.id, "deploy", "Ship the build")).json()).toMatchObject({
      command: { name: "deploy", description: "Ship the build", bot: { id: bot.id, name: "Deploy Bot" } },
    });
    // Anyone signed in reads them, since the composer's menu offers them; nobody signed out does.
    expect((await api("/api/account/commands", { headers: { Cookie: grace.cookie } })).status).toBe(200);
    expect((await api("/api/account/commands")).status).toBe(401);
    expect(((await (await api("/api/account/commands", { headers: { Cookie: ada.cookie } })).json()) as Commands).commands).toEqual([
      expect.objectContaining({ name: "deploy", description: "Ship the build", bot: { id: bot.id, name: "Deploy Bot" } }),
    ]);
    expect((await workspaceSql("SELECT name FROM commands")) as Array<{ name: string }>).toEqual([{ name: "deploy" }]);

    expect((await api("/api/account/commands/nope", { method: "DELETE", headers: { Cookie: ada.cookie } })).status).toBe(404);
    expect((await api(`/api/account/commands/${bot.id}`, { method: "DELETE", headers: { Cookie: grace.cookie } })).status).toBe(403);
    const [command] = (await workspaceSql("SELECT id FROM commands")) as Array<{ id: string }>;
    expect((await api(`/api/account/commands/${command!.id}`, { method: "DELETE", headers: { Cookie: ada.cookie } })).status).toBe(204);
    expect(await workspaceSql("SELECT id FROM commands")).toEqual([]);
  });

  it("keeps the name as it's typed, one case, and refuses one taken already, or no command's, or a bot that isn't there", async () => {
    const { ada, bot } = await withBot();
    expect((await register(ada, bot.id, "Deploy", "Ship it")).status).toBe(201);
    expect((await workspaceSql("SELECT name FROM commands")) as Array<{ name: string }>).toEqual([{ name: "deploy" }]);

    expect((await register(ada, bot.id, "deploy")).status).toBe(422);
    expect(((await (await register(ada, bot.id, "deploy")).json()) as { error: string }).error).toBe("A command with that name is registered already");
    expect((await register(ada, bot.id, "ship it!")).status).toBe(422);
    expect(((await (await register(ada, bot.id, "ship it!")).json()) as { error: string }).error).toBe("A command's name is letters, numbers, dashes and underscores");
    expect((await register(ada, bot.id, "x".repeat(33))).status).toBe(422);
    expect((await register(ada, "no such person", "build")).status).toBe(404);
    // Nothing of the refused ones was kept.
    expect(await workspaceSql("SELECT name FROM commands")).toEqual([{ name: "deploy" }]);
  });
});

describe("Running a command", () => {
  it("delivers what was typed to the bot's webhook as Slack tells it, and posts what it says back as the bot", async () => {
    const { ada, bot, general } = await withBot();
    await registerDeploy(ada, bot.id);
    const kai = await connect(general, "Kai");
    const delivered = bots(async () => new Response("Shipped!", { headers: { "Content-Type": "text/plain" } }));

    const commandId = run(kai, "deploy", "production");
    expect(await kai.next("command.ran")).toEqual({ type: "command.ran", commandId });

    expect(delivered.map(({ url }) => url)).toEqual([WEBHOOK]);
    expect(delivered[0]!.init).toMatchObject({ method: "POST", redirect: "manual", headers: { "Content-Type": "application/json" } });
    expect(sentIn(delivered[0]!)).toEqual({
      command: "/deploy",
      text: "production",
      channel_id: general,
      channel_name: "general",
      user_id: kai.me.id,
      user_name: "Kai",
    });
    // What the bot said back is its message, which reaches the room as any message of its does, delivered to no webhook.
    expect((await kai.next("message.created")).message).toMatchObject({ creator: { id: bot.id }, body: "Shipped!", plainText: "Shipped!" });
    await settle(kai);
    expect(delivered).toHaveLength(1);
  });

  it("delivers a command with nothing after it, as it was typed", async () => {
    const { ada, bot, general } = await withBot();
    await registerDeploy(ada, bot.id);
    const inRoom = await connect(general, ada);
    const delivered = bots();

    run(inRoom, "deploy");
    await inRoom.next("command.ran");
    await settle(inRoom);
    expect(delivered).toHaveLength(1);
    expect(sentIn(delivered[0]!)).toEqual({
      command: "/deploy",
      text: "",
      channel_id: general,
      channel_name: "general",
      user_id: ada.user.id,
      user_name: "Ada Lovelace",
    });
  });

  it("posts a payload of blocks a bot answers with as its card, as a modal answer rides", async () => {
    const { ada, bot, general } = await withBot();
    await registerDeploy(ada, bot.id);
    const inRoom = await connect(general, ada);
    botsAnswering({
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "Deploy *v42* to production?" },
          accessory: { type: "button", text: { type: "plain_text", text: "Ship it" }, action_id: "ship" },
        },
      ],
    });

    run(inRoom, "deploy", "v42");
    const { message } = await inRoom.next("message.created");
    // A modal answer posts as a card, whose blocks the cards system renders, with its button's text after its own.
    expect(message).toMatchObject({
      creator: { id: bot.id },
      plainText: "Deploy v42 to production?\nShip it",
      cards: [{ source: "blocks", parts: [{ kind: "section", button: { text: "Ship it", action: { id: "ship" } } }] }],
    });
    await settle(inRoom);
  });

  it("refuses a command the workspace hasn't registered, and one whose bot isn't in the room", async () => {
    const { ada, bot, general } = await withBot();
    await registerDeploy(ada, bot.id);
    const kai = await connect(general, "Kai");

    const unknown = run(kai, "rollback");
    expect(await kai.next("error")).toEqual({ type: "error", message: "There's no /rollback command here", commandId: unknown, failed: "command.run" });

    // The bot is in every open room but the closed ones, so a command typed in one of those goes nowhere.
    const closed = await api("/api/rooms", { method: "POST", headers: { Cookie: ada.cookie }, body: JSON.stringify({ kind: "closed", name: "closed", memberIds: [ada.user.id] }) });
    expect(closed.status).toBe(201);
    const { room } = (await closed.json()) as { room: { id: RoomId } };
    const adaThere = await connect(room.id, ada);
    const notHere = run(adaThere, "deploy", "secret plans");
    expect(await adaThere.next("error")).toEqual({ type: "error", message: "Deploy Bot isn't taking commands here", commandId: notHere, failed: "command.run" });
    await settle(kai);
  });

  it("says why a command came to nothing that the bot refused", async () => {
    const { ada, bot, general } = await withBot();
    await registerDeploy(ada, bot.id);
    const inRoom = await connect(general, ada);

    bots(async () => new Response(null, { status: 500 }));
    const refused = run(inRoom, "deploy");
    expect(await inRoom.next("error")).toEqual({ type: "error", message: "Deploy Bot couldn't take that command", commandId: refused, failed: "command.run" });
  });

  it("refuses a banned sender's command, as it refuses their messages", async () => {
    const { ada, bot, general } = await withBot();
    await registerDeploy(ada, bot.id);
    const grace = { ...(await signIn("Grace Hopper")), ip: "203.0.113.7" };
    expect((await api(`/api/users/${grace.user.id}/ban`, { method: "POST", headers: { Cookie: ada.cookie } })).status).toBe(200);

    // A socket the Worker sends on to the room from a banned address reads, and changes nothing.
    const ws = (await forwardUpgrade(general, { user: grace.user, sessionId: "s1", authorizedAt: Date.now(), address: grace.ip, banned: true })).webSocket!;
    ws.accept();
    const received = framesOf<ServerFrame>(ws);
    const commandId = crypto.randomUUID();
    ws.send(JSON.stringify({ type: "command.run", commandId, name: "deploy", text: "" }));
    expect(await received.next("error")).toEqual({ type: "error", message: "Request failed (429)", commandId, failed: "command.run" });
    ws.close(1000);
  });

  it("waits while a person's earlier commands are answered, and refuses one more than the room takes", async () => {
    const { ada, bot, general } = await withBot();
    await registerDeploy(ada, bot.id);
    const inRoom = await connect(general, ada);
    // A webhook that answers once it's let holds each delivery to its turn.
    const gate = Promise.withResolvers<void>();
    bots(async () => {
      await gate.promise;
      return new Response(null, { status: 200 });
    });

    const [first, second, third, fourth] = [run(inRoom, "deploy", "one"), run(inRoom, "deploy", "two"), run(inRoom, "deploy", "three"), run(inRoom, "deploy", "four")];
    expect(await inRoom.next("error")).toEqual({ type: "error", message: "Wait for your earlier commands to be answered", commandId: fourth, failed: "command.run" });
    gate.resolve();
    const ran = [await inRoom.next("command.ran"), await inRoom.next("command.ran"), await inRoom.next("command.ran")];
    expect(ran.map(({ commandId }) => commandId).sort()).toEqual([first, second, third].sort());
  });
});

describe("Message events", () => {
  it("delivers every message written in a room the bot watches, shaped as its commands are", async () => {
    const { ada, bot, general } = await withBot();
    expect((await subscribe(ada, bot.id, general)).status).toBe(204);
    const kai = await connect(general, "Kai");
    const delivered = bots();

    await post(kai, "Anyone there?");
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    expect(sentIn(delivered[0]!)).toEqual({
      type: "event_callback",
      channel_id: general,
      channel_name: "general",
      user_id: kai.me.id,
      user_name: "Kai",
      text: "Anyone there?",
      event: { type: "message", message_id: expect.any(String) },
    });
  });

  it("sends a bot nothing of its own messages, its answers least of all, though it watches the room", async () => {
    const { ada, bot, general } = await withBot();
    await registerDeploy(ada, bot.id);
    expect((await subscribe(ada, bot.id, general)).status).toBe(204);
    const inRoom = await connect(general, ada);
    // A webhook that answers with what it says, so a command's round trip is a message of the bot's.
    const delivered = bots(async () => new Response("On it.", { headers: { "Content-Type": "text/plain" } }));

    run(inRoom, "deploy");
    expect(await inRoom.next("command.ran")).toMatchObject({ type: "command.ran" });
    expect((await inRoom.next("message.created")).message).toMatchObject({ creator: { id: bot.id } });

    // And one the bot posts itself, which the bot API takes, is none of its events either.
    expect((await api(botMessagesPath(general, bot.key), { method: "POST", body: "From the bot" })).status).toBe(201);
    expect((await inRoom.next("message.created")).message).toMatchObject({ creator: { id: bot.id } });
    await settle(inRoom);
    expect(delivered).toHaveLength(1);
  });

  it("delivers one message event for a bot both mentioned and watching, as the event", async () => {
    const { ada, bot, general } = await withBot();
    expect((await subscribe(ada, bot.id, general)).status).toBe(204);
    const inRoom = await connect(general, ada);
    const delivered = bots();

    await post(inRoom, `@Deploy Bot ${mention(bot)}, ship it`);
    // A mention alone is delivered shaped as a message's; watching makes it the event, once.
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    const sent = sentIn(delivered[0]!);
    expect(sent.type).toBe("event_callback");
    expect(sent.text).toContain("ship it");
  });

  it("takes a bot off a room's messages when unticked, and refuses a tick for a room it isn't in", async () => {
    const { ada, bot, general } = await withBot();
    expect((await subscribe(ada, bot.id, general)).status).toBe(204);
    const grace = await signIn("Grace Hopper");
    expect((await subscribe(grace, bot.id, general)).status).toBe(403);

    // The bot is in every open room but a closed one, whose messages it can't be put on.
    const closed = await api("/api/rooms", { method: "POST", headers: { Cookie: ada.cookie }, body: JSON.stringify({ kind: "closed", name: "closed", memberIds: [ada.user.id] }) });
    expect(closed.status).toBe(201);
    const { room } = (await closed.json()) as { room: { id: RoomId } };
    const refusal = await subscribe(ada, bot.id, room.id);
    expect(refusal.status).toBe(422);
    expect(((await refusal.json()) as { error: string }).error).toBe("The bot has to be in the room first");
    expect((await subscribe(ada, "no such bot", general)).status).toBe(404);

    expect((await api(`/api/account/bots/${bot.id}/rooms/${general}/events`, { method: "DELETE", headers: { Cookie: ada.cookie } })).status).toBe(204);
    const inRoom = await connect(general, ada);
    const delivered = bots();
    await post(inRoom, "Unticked");
    await settle(inRoom);
    expect(delivered).toHaveLength(0);
  });
});
