import { feature } from "@ember/parity";
import type { BotAnswer, BotSettings, NewWorkspace, RoomId, User } from "@ember/protocol";
import { MENTION_CONTENT_TYPE, mentionSgid } from "@ember/richtext";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobQueue } from "../src/at-once";
import { postWebhook, WebhookError, webhookPayload } from "../src/bots/webhooks";
import type { RoomEvent } from "../src/room-log";
import { MESSAGE_WEBHOOKS, type MessageWebhook } from "../src/workspace-store";
import { api, connect, cookieOf, createRoom, direct, freshDeploy, post, shown, signIn, workspaceSql, workspaceStub, type Session } from "./support";

// Which bots' webhooks a new message is delivered to, and how, as Campfire's `Webhook#deliver` does
// (reference/app/models/webhook.rb, test/models/webhook_test.rb) and ember-rust's integrations/webhook.rs
// and jobs.rs follow it.

/** Sets Ember up with Ada as its administrator, signed in, answering her session and first run's general room. */
async function setUp(): Promise<{ ada: Session; general: RoomId }> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" }) });
  expect(response.status).toBe(201);
  const ada = { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
  const [{ id: general }] = (await workspaceSql("SELECT id FROM rooms WHERE name = 'general'")) as [{ id: RoomId }];
  return { ada, general };
}

/** Adds a bot as `administrator`, delivering to `webhookUrl` if it's given, answering it as its edit page shows it. */
async function addBot(administrator: Session, name: string, webhookUrl?: string): Promise<BotSettings> {
  const response = await api("/api/account/bots", { method: "POST", headers: { Cookie: administrator.cookie }, body: JSON.stringify({ name, webhookUrl }) });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as BotAnswer).bot;
}

/** Deletes `bot` as `administrator`, which leaves it in its DMs. */
async function deleteBot(administrator: Session, bot: BotSettings): Promise<void> {
  const response = await api(`/api/account/bots/${bot.id}`, { method: "DELETE", headers: { Cookie: administrator.cookie } });
  expect(response.status).toBe(204);
}

/** `bot` as `direct` takes the people it starts a DM with. */
const asSession = (bot: Pick<BotSettings, "id" | "name">): Session => ({ user: { id: bot.id, name: bot.name }, cookie: "" });

/** How a message mentioning `person` is written. */
const mention = (person: Pick<User, "id">) => `<action-text-attachment sgid="${mentionSgid(person.id)}" content-type="${MENTION_CONTENT_TYPE}"></action-text-attachment>`;

/** Posts `body` to `room` as the bot whose key is `key`, answering the new message's id. */
async function postAs(key: string, room: RoomId, body: string): Promise<string> {
  const response = await api(`/rooms/${room}/${key}/messages`, { method: "POST", body, headers: { "Content-Type": "text/html" } });
  expect(response.status, await response.clone().text()).toBe(201);
  return response.headers.get("Location")!.split("/@")[1]!;
}

/** A request a webhook got: where it went, and how it was sent. */
interface Delivery {
  url: string;
  init: RequestInit;
}

/**
 * Stands in for every webhook, answering each request with `answer`, and keeps the requests, in the
 * order they came.
 */
function bots(answer: (delivery: Delivery) => Promise<Response> = async () => new Response("ok", { headers: { "Content-Type": "text/plain" } })) {
  const delivered: Delivery[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const delivery = { url: input instanceof Request ? input.url : String(input), init: init! };
    delivered.push(delivery);
    return answer(delivery);
  });
  return delivered;
}

/** What the request `delivery` sent, read as JSON. */
const payloadOf = (delivery: Delivery) => JSON.parse(delivery.init.body as string) as { user: User; room: { id: RoomId; name: string | null; path: string }; message: { id: string; body: { html: string; plain: string }; path: string } };

/** `text` as ActiveSupport::JSON escapes it: `<`, `>` and `&` as JSON's escapes for them. */
const escaped = (text: string) => text.replace(/[<>&]/g, (c) => `${"\\"}u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** Each room's events are numbered from where the Workspace has applied them, which starts at 0. */
let seq = 0;

/** A new message by `author`, as its room's log sends it to the Workspace, mentioning `mentioned`. */
const message = (author: Pick<User, "id">, ...mentioned: Array<Pick<User, "id">>): RoomEvent => ({
  seq: ++seq,
  kind: "message",
  userId: author.id,
  at: new Date().toISOString(),
  message: { id: crypto.randomUUID(), plainText: "Hey", mentionIds: mentioned.map(({ id }) => id) },
});

/** What the Workspace answers room `room` sending it `events`: the bots' webhooks to deliver to. */
const webhooksFor = async (room: RoomId, events: RoomEvent[]): Promise<MessageWebhook[]> => (await workspaceStub().applyRoomEvents(room, events, [])).webhooks;

/** The names of the bots `webhooks` go to, in order. */
const botsOf = (webhooks: MessageWebhook[]) => webhooks.map(({ bot }) => bot.name);

beforeEach(async () => {
  seq = 0;
  await freshDeploy();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe(feature("bots.webhook-delivery"), () => {
  it("delivers a message to the webhooks of the bots in the room it mentions, as Campfire's JSON, with Net::HTTP's headers", async () => {
    const { ada, general } = await setUp();
    const bot = await addBot(ada, "Build Bot", "https://bots.example.com/hooks/build?team=ops");
    const delivered = bots();
    const client = await connect(general, ada);

    const sent = await post(client, `<p>Hey ${mention(bot)}, ship <strong>it</strong> &amp; tell ${mention(bot)} &lt;3</p>`);
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    const [{ url, init }] = delivered as [Delivery];
    expect(url).toBe("https://bots.example.com/hooks/build?team=ops");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect([...new Headers(init.headers)]).toEqual([
      ["accept", "*/*"],
      ["content-type", "application/json"],
      ["user-agent", "Ruby"],
    ]);
    // Campfire's keys, in its order, with HTML's characters escaped. `plain` is the plain text without the bot's mentions.
    const expected = {
      user: { id: ada.user.id, name: "Ada Lovelace" },
      room: { id: general, name: "general", path: `/rooms/${general}/${bot.key}/messages` },
      message: { id: sent.id, body: { html: sent.body, plain: "Hey , ship it & tell  <3" }, path: `/rooms/${general}/@${sent.id}` },
    };
    expect(init.body).toBe(escaped(JSON.stringify(expected)));
    expect(init.body).not.toMatch(/[<>&]/);
    client.close();
  });

  it("delivers a message in a DM to every bot in it with a webhook, mentioned or not, but its author", async () => {
    const { ada } = await setUp();
    const [builder, deployer] = [await addBot(ada, "Build Bot", "https://bots.example.com/build"), await addBot(ada, "Deploy Bot", "https://bots.example.com/deploy")];
    const room = await direct(ada, asSession(builder), asSession(deployer));

    expect(botsOf(await webhooksFor(room.id, [message(ada.user)]))).toEqual(["Build Bot", "Deploy Bot"]);
    expect(botsOf(await webhooksFor(room.id, [message(builder, builder)]))).toEqual(["Deploy Bot"]);
    const [webhook] = await webhooksFor(room.id, [message(ada.user)]);
    expect(webhook).toMatchObject({ author: { id: ada.user.id, name: "Ada Lovelace" }, roomName: null, bot: { id: builder.id, name: "Build Bot" }, url: "https://bots.example.com/build" });
    expect(`${webhook!.bot.id}-${webhook!.token}`).toBe(builder.key);
  });

  it("delivers to none but the active bots with webhooks that a message mentions in its room: never a person, a bot without one, a deleted bot or one outside the room", async () => {
    const { ada, general } = await setUp();
    const grace = await signIn("Grace Hopper");
    const [mentioned, unmentioned, quiet, deleted] = [
      await addBot(ada, "Build Bot", "https://bots.example.com/build"),
      await addBot(ada, "Lint Bot", "https://bots.example.com/lint"),
      await addBot(ada, "Quiet Bot"),
      await addBot(ada, "Old Bot", "https://bots.example.com/old"),
    ];
    await deleteBot(ada, deleted);
    const board = await createRoom("Board", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const outside = await addBot(ada, "Outside Bot", "https://bots.example.com/outside");
    await workspaceSql("DELETE FROM memberships WHERE room_id = ? AND user_id = ?", general, outside.id);

    expect(botsOf(await webhooksFor(general, [message(grace.user, mentioned, grace.user, quiet, deleted, outside, ada.user)]))).toEqual(["Build Bot"]);
    expect(botsOf(await webhooksFor(board.id, [message(grace.user, mentioned, unmentioned)]))).toEqual([]);
    expect(botsOf(await webhooksFor(general, [message(grace.user)]))).toEqual([]);
    expect(unmentioned.webhookUrl).not.toBeNull();
  });

  it("never delivers a bot's own message to it, whether it mentions itself or writes in its DM", async () => {
    const { ada, general } = await setUp();
    const bot = await addBot(ada, "Build Bot", "https://bots.example.com/build");
    const room = await direct(ada, asSession(bot));

    expect(await webhooksFor(general, [message(bot, bot)])).toEqual([]);
    expect(await webhooksFor(room.id, [message(bot)])).toEqual([]);
  });

  it("delivers each message once, however often its room sends it, and nothing for a read", async () => {
    const { ada, general } = await setUp();
    const bot = await addBot(ada, "Build Bot", "https://bots.example.com/build");

    const events = [message(ada.user, bot, bot), message(ada.user, bot)];
    expect((await webhooksFor(general, events)).map(({ messageId }) => messageId)).toEqual(events.map((event) => event.message!.id));
    expect(await webhooksFor(general, events)).toEqual([]);
    expect(await webhooksFor(general, [{ seq: ++seq, kind: "read", userId: ada.user.id, at: new Date().toISOString() }])).toEqual([]);
  });

  it("delivers what a bot posts through its key to the other bots it mentions, the room's path in the payload being each one's own", async () => {
    const { ada, general } = await setUp();
    const [builder, deployer] = [await addBot(ada, "Build Bot"), await addBot(ada, "Deploy Bot", "https://bots.example.com/deploy")];
    const delivered = bots();

    const id = await postAs(builder.key, general, `Build passed, ${mention(deployer)}`);
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    expect(delivered[0]!.url).toBe("https://bots.example.com/deploy");
    expect(payloadOf(delivered[0]!)).toMatchObject({
      user: { id: builder.id, name: "Build Bot" },
      room: { path: `/rooms/${general}/${deployer.key}/messages` },
      message: { id, body: { plain: "Build passed," } },
    });
  });

  it("delivers nothing when a message is edited or boosted", async () => {
    const { ada, general } = await setUp();
    const bot = await addBot(ada, "Build Bot", "https://bots.example.com/build");
    const delivered = bots();
    const client = await connect(general, ada);
    const sent = await post(client, `<p>Hey ${mention(bot)}</p>`);
    await vi.waitFor(() => expect(delivered).toHaveLength(1));

    client.send({ type: "message.update", messageId: sent.id, body: `<p>Hi ${mention(bot)}</p>` });
    await client.next("message.updated");
    client.send({ type: "boost.create", messageId: sent.id, content: "🎉" });
    await client.next("boost.created");
    await post(client, "<p>Anyone else?</p>");
    // The next message reaches the Workspace after the edit and boost, and goes to nobody.
    await vi.waitFor(async () => expect(((await workspaceSql("SELECT applied_seq FROM rooms WHERE id = ?", general)) as [{ applied_seq: number }])[0].applied_seq).toBe(2));
    expect(delivered).toHaveLength(1);
    client.close();
  });

  it("takes only the bot's own @mentions out of the plain text, case for case, then whitespace at either end", () => {
    const space = String.fromCodePoint(0xa0, 0x2003, 0x3000);
    const webhook: MessageWebhook = { messageId: "m1", author: { id: "u1", name: "Ada" }, roomName: "general", bot: { id: "b1", name: "Build Bot" }, token: "AbC123", url: "https://bots.example.com" };
    const plain = (plainText: string) => (JSON.parse(webhookPayload("r1", webhook, { id: "m1", body: "", plainText })) as { message: { body: { plain: string } } }).message.body.plain;

    expect(plain(`${space}@Build Bot deploy @build bot and @Build Botty${space}`)).toBe("deploy @build bot and ty");
    expect(plain("@Build Bot")).toBe("");
  });

  it("writes the payload as Campfire does, with HTML's characters escaped, and a DM's name null", () => {
    const webhook: MessageWebhook = { messageId: "m1", author: { id: "u1", name: "Ada <3" }, roomName: null, bot: { id: "b1", name: "Build Bot" }, token: "AbC123", url: "https://bots.example.com" };
    const payload = webhookPayload("r1", webhook, { id: "m1", body: "<p>A &amp; B</p>", plainText: "A & B" });

    expect(payload).toBe(
      escaped('{"user":{"id":"u1","name":"Ada <3"},"room":{"id":"r1","name":null,"path":"/rooms/r1/b1-AbC123/messages"},"message":{"id":"m1","body":{"html":"<p>A &amp; B</p>","plain":"A & B"},"path":"/rooms/r1/@m1"}}'),
    );
  });

  it("posts to the URL as it is, any port, and answers a redirect without following it", async () => {
    const sent: string[] = [];
    const send = (async (input: URL | string, init?: RequestInit) => {
      sent.push(`${init!.method} ${String(input)} ${init!.redirect}`);
      return new Response(null, { status: 302, headers: { Location: "https://elsewhere.example.com/" } });
    }) as typeof fetch;

    expect(await postWebhook("http://bots.example.com:8080/hook?x=1#here", "{}", 7_000, send)).toEqual({ status: 302 });
    expect(sent).toEqual(["POST http://bots.example.com:8080/hook?x=1#here manual"]);
  });

  it("sends nothing to a URL that isn't an http or https URL with a host", async () => {
    const send = vi.fn() as unknown as typeof fetch;
    for (const url of ["", "ftp://bots.example.com/hook", "bots.example.com/hook", "http://", "mailto:bots@example.com", "http://bots.example.com:99999/"]) {
      await expect(postWebhook(url, "{}", 7_000, send)).rejects.toThrow(new WebhookError("bad URI"));
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("fails without the URL in its reason when the request does", async () => {
    const url = "https://bots.example.com/hook?token=secret";
    const send = (async () => {
      throw new TypeError(`Fetch failed: ${url} refused the connection`);
    }) as typeof fetch;

    await expect(postWebhook(url, "{}", 7_000, send)).rejects.toThrow(new WebhookError("TypeError: Fetch failed: [FILTERED] refused the connection"));
  });

  it("gives a webhook 7 seconds to answer, as Campfire's ENDPOINT_TIMEOUT does, after which it's said to have timed out", async () => {
    const send = ((_input: URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch;
    expect(await postWebhook("https://bots.example.com/hook", "{}", 20, send)).toEqual({ timedOutAfter: 0.02 });
  });
});

describe(feature("bots.reset-key"), () => {
  it("gives the bot's new key in the room's path once it's reset", async () => {
    const { ada, general } = await setUp();
    const bot = await addBot(ada, "Build Bot", "https://bots.example.com/build");
    const reset = await api(`/api/account/bots/${bot.id}/key`, { method: "PUT", headers: { Cookie: ada.cookie } });
    const { key } = ((await reset.json()) as BotAnswer).bot;
    const delivered = bots();
    const client = await connect(general, ada);

    await post(client, `<p>Hey ${mention(bot)}</p>`);
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    expect(key).not.toBe(bot.key);
    expect(payloadOf(delivered[0]!).room.path).toBe(`/rooms/${general}/${key}/messages`);
    client.close();
  });
});

describe(feature("bots.webhook-jobs"), () => {
  it("runs a room's deliveries two at a time, in turn, reading each message as it is when its turn comes, even for a bot deleted since", async () => {
    const { ada, general } = await setUp();
    const bot = await addBot(ada, "Build Bot", "https://bots.example.com/build");
    // The webhooks answer once the test lets them, in the order they were asked. They wait for it
    // in the room's own I/O context, since workerd won't let the test settle a promise made there.
    let answered = 0;
    const delivered = bots(async (delivery) => {
      while (answered <= delivered.indexOf(delivery)) await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(null, { status: 204 });
    });
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await connect(general, ada);

    const [first, second, third, fourth] = [
      await post(client, `<p>One ${mention(bot)}</p>`),
      await post(client, `<p>Two ${mention(bot)}</p>`),
      await post(client, `<p>Three ${mention(bot)}</p>`),
      await post(client, `<p>Four ${mention(bot)}</p>`),
    ];
    await vi.waitFor(() => expect(delivered).toHaveLength(2));
    // The third and fourth wait their turn, by which time one is edited and the other deleted.
    client.send({ type: "message.update", messageId: third!.id, body: `<p>Three, edited ${mention(bot)}</p>` });
    await client.next("message.updated");
    client.send({ type: "message.delete", messageId: fourth!.id });
    await client.next("message.deleted");
    // A bot deleted after a message keeps its webhook, so what's on its way to it still goes.
    await deleteBot(ada, bot);
    expect(delivered).toHaveLength(2);

    answered = 1;
    await vi.waitFor(() => expect(delivered).toHaveLength(3));
    answered = 3;
    const performed = () => logs.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("Bot::WebhookJob"));
    await vi.waitFor(() => expect(performed()).toHaveLength(3));
    await vi.waitFor(() => expect(errors).toHaveBeenCalledWith(`Bot::WebhookJob of message ${fourth!.id} to bot ${bot.id} failed:`, "the message is gone"));
    expect(delivered.map((delivery) => payloadOf(delivery).message.id)).toEqual([first!.id, second!.id, third!.id]);
    expect(payloadOf(delivered[2]!).message.body.plain).toBe("Three, edited");
    // The second and third are answered together, so either may finish first.
    expect(performed().sort()).toEqual([first, second, third].map((sent) => `Bot::WebhookJob of message ${sent!.id} to bot ${bot.id} performed: 204`).sort());
    client.close();
  });

  it("logs a delivery that fails, never with the webhook's URL or the bot's key", async () => {
    const { ada, general } = await setUp();
    const bot = await addBot(ada, "Build Bot", "https://bots.example.com/build");
    await workspaceSql("UPDATE webhooks SET url = 'not a url' WHERE user_id = ?", bot.id);
    const delivered = bots();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await connect(general, ada);

    const sent = await post(client, `<p>Hey ${mention(bot)}</p>`);
    await vi.waitFor(() => expect(errors).toHaveBeenCalledWith(`Bot::WebhookJob of message ${sent.id} to bot ${bot.id} failed:`, "bad URI"));
    expect(delivered).toEqual([]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(bot.key);
    client.close();
  });

  it("queries webhooks first, finding each one's bot and membership by their keys", async () => {
    const plan = (await workspaceSql(`EXPLAIN QUERY PLAN ${MESSAGE_WEBHOOKS}`, "room", "user", "[]", 1)).map((row) => (row as { detail: string }).detail);
    expect(plan).toContain("SCAN webhooks");
    expect(plan.filter((step) => /^SCAN (users|memberships|rooms)\b/.test(step))).toEqual([]);
  });

  it("runs jobs a few at a time as they come, keeps some more waiting, and drops any beyond", async () => {
    const queue = new JobQueue(2, 1);
    const started: string[] = [];
    const finish = new Map<string, () => void>();
    const job = (name: string) => () =>
      new Promise<void>((resolve) => {
        started.push(name);
        finish.set(name, resolve);
      });

    const ran = ["a", "b", "c", "d"].map((name) => queue.run(job(name)));
    expect(started).toEqual(["a", "b"]);
    expect(await ran[3]).toBe(false);

    finish.get("b")!();
    await vi.waitFor(() => expect(started).toEqual(["a", "b", "c"]));
    finish.get("a")!();
    finish.get("c")!();
    expect(await Promise.all(ran.slice(0, 3))).toEqual([true, true, true]);
    // With nothing running, the next starts at once.
    const last = queue.run(job("e"));
    expect(started).toEqual(["a", "b", "c", "e"]);
    finish.get("e")!();
    expect(await last).toBe(true);
  });
});
