import type { BotAnswer, BotSettings, Message, NewWorkspace, RoomId, ServerFrame } from "@ember/protocol";
import type { Shortcuts } from "@ember/protocol/bots";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, connect, cookieOf, freshDeploy, forwardUpgrade, framesOf, post, settle, shown, signIn, workspaceSql, workspaceStub, type Client, type Session, type Socket } from "./support";

// Message shortcuts (migrations/0075_shortcuts.sql): a name as it's shown ("Translate this") and the bot
// it invokes, which an administrator registers and every message's More actions offers. Picking one
// delivers a Slack-shaped message_action payload about the message to the bot's webhook, as a command's
// delivery is, and what the bot answers is posted as the bot, in the message's thread when it's a reply.
// A bot's card, whose buttons act, is the interactive half of the same wires: a click is delivered as
// Slack's block_actions tells one, and what the bot answers takes the card's place, which these tests
// keep an eye on while the shortcuts are laid in beside it.

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

/** Registers a shortcut named `name` for the bot `botId`, as `session` asks, answering how the Worker answered. */
const register = (session: Session, botId: string, name: string, description?: string) =>
  api("/api/account/shortcuts", { method: "POST", headers: { Cookie: session.cookie }, body: JSON.stringify({ botId, name, ...(description !== undefined && { description }) }) });

/** Registers "Translate this" for the bot `botId`, as `session`. */
async function registerTranslate(session: Session, botId: string): Promise<void> {
  expect((await register(session, botId, "Translate this", "Say it in French")).status, "registering Translate this").toBe(201);
}

/** Registers "Translate this" for the bot `botId`, as `session`, answering the shortcut as it's kept. */
async function registeredTranslate(session: Session, botId: string): Promise<{ id: string; name: string }> {
  const answer = (await (await register(session, botId, "Translate this", "Say it in French")).json()) as { shortcut: { id: string; name: string } };
  return answer.shortcut;
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

/** Picks the shortcut `shortcutId` on the message `messageId`, as `client`'s More actions does. */
const run = (client: Socket, shortcutId: string, messageId: string) => client.send({ type: "shortcut.run", shortcutId, messageId });

beforeEach(freshDeploy);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Registering shortcuts", () => {
  it("registers a shortcut as an administrator, which anyone signed in reads, and takes it away again", async () => {
    const { ada, bot } = await withBot();
    const grace = await signIn("Grace Hopper");

    expect((await register(grace, bot.id, "Translate this")).status).toBe(403);
    await registerTranslate(ada, bot.id);
    // Anyone signed in reads them, since every message's More actions offers them; nobody signed out does.
    expect((await api("/api/account/shortcuts", { headers: { Cookie: grace.cookie } })).status).toBe(200);
    expect((await api("/api/account/shortcuts")).status).toBe(401);
    expect(((await (await api("/api/account/shortcuts", { headers: { Cookie: ada.cookie } })).json()) as Shortcuts).shortcuts).toEqual([
      expect.objectContaining({ name: "Translate this", description: "Say it in French", bot: { id: bot.id, name: "Deploy Bot" } }),
    ]);
    // A shortcut's name is kept as it's typed, capitals and all, where a command's is kept one case.
    expect((await workspaceSql("SELECT name FROM shortcuts")) as Array<{ name: string }>).toEqual([{ name: "Translate this" }]);

    expect((await api("/api/account/shortcuts/nope", { method: "DELETE", headers: { Cookie: ada.cookie } })).status).toBe(404);
    expect((await api(`/api/account/shortcuts/${bot.id}`, { method: "DELETE", headers: { Cookie: grace.cookie } })).status).toBe(403);
    const [shortcut] = (await workspaceSql("SELECT id FROM shortcuts")) as Array<{ id: string }>;
    expect((await api(`/api/account/shortcuts/${shortcut!.id}`, { method: "DELETE", headers: { Cookie: ada.cookie } })).status).toBe(204);
    expect(await workspaceSql("SELECT id FROM shortcuts")).toEqual([]);
  });

  it("keeps the name as it's typed, and refuses one taken already, a blank one, one longer than Slack gives a shortcut's name, or a bot that isn't there", async () => {
    const { ada, bot } = await withBot();
    expect((await register(ada, bot.id, "Translate this")).status).toBe(201);

    expect((await register(ada, bot.id, "  Translate this ")).status).toBe(422);
    expect(((await (await register(ada, bot.id, "Translate this")).json()) as { error: string }).error).toBe("A shortcut with that name is registered already");
    expect((await register(ada, bot.id, "   ")).status).toBe(422);
    expect((await register(ada, bot.id, "x".repeat(81))).status).toBe(422);
    expect((await register(ada, "no such person", "Translate this")).status).toBe(404);
    // Nothing of the refused ones was kept.
    expect(await workspaceSql("SELECT name FROM shortcuts")).toEqual([{ name: "Translate this" }]);
  });

  it("takes a bot's shortcuts with it, as its commands go with it, when it's deleted", async () => {
    const { ada, bot } = await withBot();
    await registerTranslate(ada, bot.id);
    expect(await workspaceSql("SELECT name FROM shortcuts")).toEqual([{ name: "Translate this" }]);

    expect((await api(`/api/account/bots/${bot.id}`, { method: "DELETE", headers: { Cookie: ada.cookie } })).status).toBe(204);
    expect(await workspaceSql("SELECT name FROM shortcuts")).toEqual([]);
  });
});

describe("Running a shortcut", () => {
  it("delivers the message to the bot's webhook as Slack tells a message_action, and posts what it says back as the bot", async () => {
    const { ada, bot, general } = await withBot();
    const shortcut = await registeredTranslate(ada, bot.id);
    const kai = await connect(general, "Kai");
    const delivered = bots(async () => new Response("Voilà !", { headers: { "Content-Type": "text/plain" } }));
    const said = await post(kai, "Anyone there?");

    run(kai, shortcut.id, said.id);
    expect(await kai.next("shortcut.ran")).toEqual({ type: "shortcut.ran", shortcutId: shortcut.id });

    expect(delivered.map(({ url }) => url)).toEqual([WEBHOOK]);
    expect(delivered[0]!.init).toMatchObject({ method: "POST", redirect: "manual", headers: { "Content-Type": "application/json" } });
    const sent = sentIn(delivered[0]!);
    expect(sent).toEqual({
      type: "message_action",
      callback_id: "Translate this",
      message: { type: "message", text: "Anyone there?", ts: expect.stringMatching(/^\d{10}\.\d{6}$/), permalink: `/rooms/${general}/@${said.id}` },
      user_id: kai.me.id,
      user_name: "Kai",
      channel: { id: general, name: "general" },
    });
    // Its ts is when the message was said, as Slack tells a message's: seconds, then microseconds.
    expect(Math.abs(Number((sent.message as { ts: string }).ts.split(".")[0]) * 1000 - Date.parse(said.createdAt))).toBeLessThan(1000);
    // What the bot said back is its message, which reaches the room as any message of its does, delivered to no webhook.
    expect((await kai.next("message.created")).message).toMatchObject({ creator: { id: bot.id }, body: "Voilà !", plainText: "Voilà !" });
    await settle(kai);
    expect(delivered).toHaveLength(1);
  });

  it("posts what the bot answers a reply's shortcut with in the reply's thread, as its text answers are", async () => {
    const { ada, bot, general } = await withBot();
    const shortcut = await registeredTranslate(ada, bot.id);
    const inRoom = await connect(general, ada);
    bots(async () => new Response("En français : « Bonjour ! »", { headers: { "Content-Type": "text/plain" } }));

    const root = await post(inRoom, "Start a thread");
    const replyId = crypto.randomUUID();
    inRoom.send({ type: "message.create", clientMessageId: replyId, body: "<p>Translate me</p>", parentId: root.id });
    const { message: reply } = await inRoom.next("message.created");
    expect(reply).toMatchObject({ clientMessageId: replyId, parentId: root.id });

    run(inRoom, shortcut.id, reply.id);
    expect(await inRoom.next("shortcut.ran")).toMatchObject({ type: "shortcut.ran", shortcutId: shortcut.id });
    // The bot's answer is a reply of the thread, not a new message of the room's.
    expect((await inRoom.next("message.created")).message).toMatchObject({ creator: { id: bot.id }, parentId: root.id, plainText: "En français : « Bonjour ! »" });
    await settle(inRoom);
  });

  it("posts a payload of blocks a bot answers a shortcut with as its card", async () => {
    const { ada, bot, general } = await withBot();
    const shortcut = await registeredTranslate(ada, bot.id);
    const inRoom = await connect(general, ada);
    botsAnswering({
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "It says *Bonjour !* in French" },
          accessory: { type: "button", text: { type: "plain_text", text: "Say it back" }, action_id: "say-back" },
        },
      ],
    });
    const said = await post(inRoom, "Anyone there?");

    run(inRoom, shortcut.id, said.id);
    const { message } = await inRoom.next("message.created");
    // A payload of blocks posts as a card, whose blocks the cards system renders, with its button's text after its own.
    expect(message).toMatchObject({
      creator: { id: bot.id },
      plainText: "It says Bonjour ! in French\nSay it back",
      cards: [{ source: "blocks", parts: [{ kind: "section", button: { text: "Say it back", action: { id: "say-back" } } }] }],
    });
    await settle(inRoom);
  });

  it("refuses a shortcut the workspace hasn't registered, a bot that isn't in the room, or a message that's gone", async () => {
    const { ada, bot, general } = await withBot();
    const shortcut = await registeredTranslate(ada, bot.id);
    const kai = await connect(general, "Kai");
    const said = await post(kai, "Anyone there?");
    const delivered = bots();

    const unknown = crypto.randomUUID();
    run(kai, unknown, said.id);
    expect(await kai.next("error")).toEqual({ type: "error", message: "There's no such shortcut here", shortcutId: unknown, failed: "shortcut.run" });

    // The bot is in every open room but the closed ones, so a shortcut picked in one of those goes nowhere.
    const closed = await api("/api/rooms", { method: "POST", headers: { Cookie: ada.cookie }, body: JSON.stringify({ kind: "closed", name: "closed", memberIds: [ada.user.id] }) });
    expect(closed.status).toBe(201);
    const { room } = (await closed.json()) as { room: { id: RoomId } };
    const adaThere = await connect(room.id, ada);
    run(adaThere, shortcut.id, said.id);
    expect(await adaThere.next("error")).toEqual({ type: "error", message: "Deploy Bot isn't taking shortcuts here", shortcutId: shortcut.id, failed: "shortcut.run" });

    // A message deleted before its shortcut's turn says so, and goes to no webhook.
    kai.send({ type: "message.delete", messageId: said.id });
    await kai.next("message.deleted");
    run(kai, shortcut.id, said.id);
    expect(await kai.next("error")).toEqual({ type: "error", message: "That message no longer exists", shortcutId: shortcut.id, failed: "shortcut.run" });
    await settle(kai, adaThere);
    expect(delivered).toHaveLength(0);
  });

  it("refuses a banned sender's shortcut, as it refuses their messages", async () => {
    const { ada, bot, general } = await withBot();
    const shortcut = await registeredTranslate(ada, bot.id);
    const grace = { ...(await signIn("Grace Hopper")), ip: "203.0.113.7" };
    expect((await api(`/api/users/${grace.user.id}/ban`, { method: "POST", headers: { Cookie: ada.cookie } })).status).toBe(200);

    // A socket the Worker sends on to the room from a banned address reads, and changes nothing.
    const ws = (await forwardUpgrade(general, { user: grace.user, sessionId: "s1", authorizedAt: Date.now(), address: grace.ip, banned: true })).webSocket!;
    ws.accept();
    const received = framesOf<ServerFrame>(ws);
    ws.send(JSON.stringify({ type: "shortcut.run", shortcutId: shortcut.id, messageId: "m-any" }));
    expect(await received.next("error")).toEqual({ type: "error", message: "Request failed (429)", shortcutId: shortcut.id, failed: "shortcut.run" });
    ws.close(1000);
  });
});

describe("A card's buttons", () => {
  /** A card of Ship it, which acts with a value, and Roll back, which acts with none, in a block that names itself. */
  const SHIPMENT = {
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: "Deploy *v42* to production?" } },
      {
        type: "actions",
        block_id: "deploy-42",
        elements: [
          { type: "button", text: { type: "plain_text", text: "Ship it" }, action_id: "ship", value: '{"build":42}', style: "primary" },
          { type: "button", text: { type: "plain_text", text: "Roll back" }, action_id: "rollback", style: "danger" },
        ],
      },
    ],
  };

  /** Posts `payload` to `room`'s Slack-compatible webhook as the bot whose key is `key`, answering the message `watching` hears of. */
  async function postCard(watching: Client, room: RoomId, key: string, payload: unknown = SHIPMENT): Promise<Message> {
    const response = await api(`/rooms/${room}/${key}/slack`, { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } });
    expect([response.status, await response.text()]).toEqual([200, "ok"]);
    return (await watching.next("message.created")).message;
  }

  /** Clicks the button `actionId` names on `message`, as `client`, with `blockId` and the value a Block Kit Builder gave it, answering the click's id. */
  const click = (client: Client, message: Pick<Message, "id">, actionId: string, blockId: string | null = "deploy-42", value: string | null = '{"build":42}'): string => {
    const clickId = crypto.randomUUID();
    client.send({ type: "card.click", clickId, messageId: message.id, actionId, ...(blockId !== null && { blockId }), ...(value !== null && { value }) });
    return clickId;
  };

  it("delivers a click as Slack's block_actions tells one, and what the bot answers takes the card's place", async () => {
    const { ada, bot, general } = await withBot();
    const kai = await connect(general, "Kai");
    const message = await postCard(kai, general, bot.key);
    const delivered = bots();

    const clickId = click(kai, message, "ship");
    expect(await kai.next("card.clicked")).toEqual({ type: "card.clicked", clickId });

    expect(delivered.map(({ url }) => url)).toEqual([WEBHOOK]);
    expect(delivered[0]!.init).toMatchObject({ method: "POST", redirect: "manual", headers: { "Content-Type": "application/json" } });
    // The address the bot posts its answer to later is the webhook's own there, never the bot's key.
    const { key } = (await workspaceStub().botWebhook(general, bot.id))!;
    expect(sentIn(delivered[0]!)).toEqual({
      type: "block_actions",
      user: { id: kai.me.id, name: "Kai" },
      room: { id: general, name: "general", path: `/rooms/${general}/${key}/messages` },
      message: { id: message.id, body: { html: null, plain: "Deploy v42 to production?\nShip it · Roll back" }, path: `/rooms/${general}/@${message.id}` },
      actions: [
        { type: "button", action_id: "ship", block_id: "deploy-42", value: '{"build":42}', text: { type: "plain_text", text: "Ship it" }, action_ts: expect.stringMatching(/^\d{10}\.\d{6}$/) },
      ],
      response_path: `/rooms/${general}/${key}/messages/${message.id}/slack`,
    });

    // The bot's answer is its own card again, in everyone's sight, marked as edited.
    vi.restoreAllMocks();
    botsAnswering({ blocks: [{ type: "section", text: { type: "mrkdwn", text: "*v42* shipped by Kai" } }] });
    const another = click(kai, message, "ship");
    const { message: replaced } = await kai.next("message.updated");
    expect(replaced).toMatchObject({ id: message.id, creator: { id: bot.id }, plainText: "v42 shipped by Kai", editedAt: expect.any(String) });
    expect(await kai.next("card.clicked")).toEqual({ type: "card.clicked", clickId: another });
    await settle(kai);
  });
});
