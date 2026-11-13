import { MAX_MESSAGE_LENGTH, type BotAnswer, type BotSettings, type NewWorkspace, type RoomId } from "@ember/protocol";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";
import { api, apiWith, connect, cookieOf, createRoom, freshDeploy, origin, post, roomSql, shown, startDirect, workspaceSql, type Session } from "./support";

// Slack's Web API, answered for bots at /api/<method> (bots/slack-web.ts), so scripts and SDKs written
// for Slack work by swapping the address they call and the token they send, which is the bot's key.

/** Sets Ember up with a bot, which is in first run's general and random rooms. */
async function withBot(): Promise<{ administrator: Session; bot: BotSettings; general: RoomId; random: RoomId }> {
  const setUp = await api("/api/first_run", { method: "POST", body: JSON.stringify({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" }) });
  expect(setUp.status).toBe(201);
  const administrator = { user: shown(((await setUp.json()) as NewWorkspace).user), cookie: cookieOf(setUp) };
  const added = await api("/api/account/bots", { method: "POST", headers: { Cookie: administrator.cookie }, body: JSON.stringify({ name: "Build Bot" }) });
  expect(added.status, await added.clone().text()).toBe(201);
  const rooms = (await workspaceSql("SELECT id, name FROM rooms WHERE kind <> 'direct'")) as Array<{ id: RoomId; name: string }>;
  const roomNamed = (name: string) => rooms.find(({ name: known }) => known === name)!.id;
  return { administrator, bot: ((await added.json()) as BotAnswer).bot, general: roomNamed("general"), random: roomNamed("random") };
}

/** Sends `payload` to a method with the bot's key as its bearer token, as Slack's SDKs do. */
const send = (method: string, key: string, payload?: unknown, init: RequestInit = {}) =>
  api(`/api/${method}`, {
    ...init,
    method: init.method ?? "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(payload !== undefined && typeof payload !== "string" && !(payload instanceof FormData) && init.body === undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
    body: init.body ?? (payload === undefined || typeof payload === "string" || payload instanceof FormData || payload instanceof URLSearchParams ? (payload as BodyInit | undefined) : JSON.stringify(payload)),
  });

/** What a method answered: its status and its envelope, which Slack's have at 200 whatever they say. */
const envelopeOf = async (response: Response) => [response.status, await response.json()] as const;

/** What conversations.history answers for `channel` with `fields`, read as its envelope. */
async function historyOf(key: string, channel: string, fields: Record<string, string> = {}) {
  const response = await send("conversations.history", key, new URLSearchParams({ channel, ...fields }).toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return (await response.json()) as { ok: boolean; error?: string; channel?: string; messages?: HistoryMessage[]; has_more?: boolean };
}

/** A message as conversations.history writes one. */
interface HistoryMessage {
  type: string;
  text: string;
  ts: string;
  user: string;
}

/** Sends what curl sends: no browser headers at all, which the app's own API refuses as cross-site. */
const curlPost = (path: string, body: string, key: string) =>
  worker.fetch(new Request(`${origin}${path}`, { method: "POST", body, headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` } }), env as unknown as Env);

beforeEach(freshDeploy);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Slack Web API auth", () => {
  it("tells the bot auth.test names, and refuses invalid_auth for a key no bot has", async () => {
    const { bot } = await withBot();
    expect(await envelopeOf(await send("auth.test", bot.key))).toEqual([200, { ok: true, user: "Build Bot", user_id: bot.id }]);
    for (const key of [`${bot.id}-wrongwrongxx`, bot.id, "", `${bot.id}-`, "nodashatall"]) {
      expect([key, await envelopeOf(await send("auth.test", key))]).toEqual([key, [200, { ok: false, error: "invalid_auth" }]]);
    }
    // No header at all is no key either.
    expect(await envelopeOf(await api("/api/auth.test", { method: "POST" }))).toEqual([200, { ok: false, error: "invalid_auth" }]);
    // And a token only a webhook's delivery gives a bot, which has no "-" in it, names nothing.
    expect(await envelopeOf(await send("auth.test", "d4f10a52b6c871e3"))).toEqual([200, { ok: false, error: "invalid_auth" }]);
  });

  it("takes the key whatever the request's body and headers are like, as curl sends them", async () => {
    const { administrator, bot, general } = await withBot();
    // Without the browser headers the app's own API asks for, since the key is what only the bot has.
    const response = await curlPost("/api/chat.postMessage", JSON.stringify({ channel: general, text: "Hello" }), bot.key);
    expect(await envelopeOf(response)).toEqual([200, expect.objectContaining({ ok: true })]);
    // From a page of another site, too, whose headers name it: the key can't be forged there.
    const crossSite = await send("chat.postMessage", bot.key, { channel: general, text: "Hello" }, { headers: { Origin: "https://elsewhere.example", "Sec-Fetch-Site": "cross-site" } });
    expect(await envelopeOf(crossSite)).toEqual([200, expect.objectContaining({ ok: true })]);
    expect(await historyOf(bot.key, general)).toMatchObject({ ok: true, messages: [{ text: "Hello" }, { text: "Hello" }] });
    // But a session carries no bot with it: without the key, nothing is answered.
    const cookieOnly = await api(`/api/chat.postMessage?channel=${general}&text=Hello`, { method: "POST", headers: { Cookie: administrator.cookie } });
    expect(await envelopeOf(cookieOnly)).toEqual([200, { ok: false, error: "invalid_auth" }]);
  });
});

describe("Slack Web API posting", () => {
  it("posts a payload's text to the room its id names, as the bot's message, and answers with where it is", async () => {
    const { administrator, bot, general } = await withBot();
    const inRoom = await connect(general, administrator);
    const answer = (await (await send("chat.postMessage", bot.key, { channel: general, text: "Deploy *finished* :tada:" })).json()) as {
      ok: boolean;
      channel?: string;
      ts?: string;
      message?: HistoryMessage;
    };
    const { message } = await inRoom.next("message.created");
    expect(answer).toEqual({
      ok: true,
      channel: general,
      ts: message.id,
      message: { type: "message", text: "Deploy finished 🎉", ts: message.id, user: bot.id },
    });
    expect(message).toMatchObject({ roomId: general, creator: { id: bot.id }, body: "<p>Deploy <strong>finished</strong> 🎉</p>" });
  });

  it("takes a room's name for its channel, with or without its #, ignoring case", async () => {
    const { bot, general, random } = await withBot();
    // A bare name that reads as an id, which no room has, is the room of theirs the name names.
    for (const channel of ["#general", "General", "#GENERAL", general, "random"]) {
      const answer = (await (await send("chat.postMessage", bot.key, { channel, text: "Hello" })).json()) as { ok: boolean; channel?: string };
      const expected = channel === "random" ? random : general;
      expect([channel, answer.ok, answer.channel]).toEqual([channel, true, expected]);
    }
    const randomAnswer = (await (await send("chat.postMessage", bot.key, { channel: "#Random", text: "To random" })).json()) as { ok: boolean };
    expect(randomAnswer.ok).toBe(true);
    expect(await historyOf(bot.key, "#Random")).toMatchObject({ ok: true, channel: random, messages: [{ text: "Hello" }, { text: "To random" }] });
  });

  it("reads its fields from a form's, urlencoded or multipart, or a payload field's JSON, as its webhooks are sent", async () => {
    const { bot, general } = await withBot();
    const urlencoded = await send("chat.postMessage", bot.key, `text=From a form&channel=${general}`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(await envelopeOf(urlencoded)).toEqual([200, expect.objectContaining({ ok: true })]);

    const multipart = new FormData();
    multipart.set("channel", general);
    multipart.set("text", "From a multipart form");
    expect(await envelopeOf(await send("chat.postMessage", bot.key, multipart))).toEqual([200, expect.objectContaining({ ok: true })]);

    const payload = await send("chat.postMessage", bot.key, `payload=${encodeURIComponent(JSON.stringify({ channel: general, text: "From a webhook's payload" }))}`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(await envelopeOf(payload)).toEqual([200, expect.objectContaining({ ok: true })]);

    // A list a form writes as JSON, as Slack's forms take attachments.
    const attachments = await send(
      "chat.postMessage",
      bot.key,
      new URLSearchParams({ channel: general, text: "Nightly report", attachments: JSON.stringify([{ title: "web" }]) }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
    expect(await envelopeOf(attachments)).toEqual([200, expect.objectContaining({ ok: true })]);
    expect(await historyOf(bot.key, general)).toMatchObject({
      ok: true,
      messages: [{ text: "From a form" }, { text: "From a multipart form" }, { text: "From a webhook's payload" }, { text: "Nightly report\nweb" }],
    });
  });

  it("answers in the envelope what it refuses, at 200, posting nothing", async () => {
    const { administrator, bot, general } = await withBot();
    const closed = await createRoom("Launch", { closedTo: [administrator.user.id], as: administrator });
    for (const [fields, error] of [
      [{ channel: general }, "no_text"],
      [{ channel: general, text: " \n\t" }, "no_text"],
      [{ channel: general, text: "x".repeat(MAX_MESSAGE_LENGTH + 1) }, "msg_too_long"],
      [{ channel: "0noroom0000000", text: "Hello" }, "channel_not_found"],
      [{ channel: "#nosuch", text: "Hello" }, "channel_not_found"],
      [{ text: "Hello" }, "channel_not_found"],
      [{ channel: closed.id, text: "Hello" }, "not_in_channel"],
    ] as const) {
      const response = await send("chat.postMessage", bot.key, fields);
      expect([fields, response.status, await response.json()]).toEqual([fields, 200, { ok: false, error }]);
    }
    // A body that is neither JSON nor a form names no fields to post with.
    const unreadable = await send("chat.postMessage", bot.key, '{"text": "unfinished"', { headers: { "Content-Type": "text/plain" } });
    expect(await envelopeOf(unreadable)).toEqual([200, { ok: false, error: "invalid_payload" }]);
    expect(await historyOf(bot.key, general)).toMatchObject({ ok: true, messages: [] });
  });

  it("posts to a thread its thread_ts names, only there, and answers message_not_found for one there isn't", async () => {
    const { bot, general } = await withBot();
    const posted = (await (await send("chat.postMessage", bot.key, { channel: general, text: "Deploying" })).json()) as { ts?: string };
    const replied = await send("chat.postMessage", bot.key, { channel: general, text: "Done", thread_ts: posted.ts });
    expect(await envelopeOf(replied)).toEqual([200, { ok: true, channel: general, ts: expect.any(String), message: expect.objectContaining({ text: "Done" }) }]);
    const replies = (await roomSql(general, "SELECT id, parent_id, in_room FROM messages WHERE parent_id IS NOT NULL")) as Array<{ id: string; parent_id: string; in_room: number }>;
    expect(replies).toEqual([expect.objectContaining({ parent_id: posted.ts, in_room: 0 })]);
    // The room's history reads the timeline, which a thread-only reply isn't in.
    expect(await historyOf(bot.key, general)).toMatchObject({ ok: true, messages: [{ text: "Deploying" }] });
    expect(await envelopeOf(await send("chat.postMessage", bot.key, { channel: general, text: "Done", thread_ts: "0nother00000000" }))).toEqual([
      200,
      { ok: false, error: "message_not_found" },
    ]);
  });

  it("posts to the DM someone started with the bot, which is a room it's in though its list has none", async () => {
    const { administrator, bot } = await withBot();
    const started = await startDirect(administrator, [bot.id]);
    expect(started.status).toBe(201);
    const { id: dm } = ((await started.json()) as { room: { id: RoomId } }).room;
    const answer = (await (await send("chat.postMessage", bot.key, { channel: dm, text: "Psst" })).json()) as { ok: boolean; channel?: string };
    expect(answer).toEqual({ ok: true, channel: dm, ts: expect.any(String), message: expect.objectContaining({ text: "Psst" }) });
    expect(await historyOf(bot.key, dm)).toMatchObject({ ok: true, messages: [{ text: "Psst" }] });
  });
});

describe("Slack Web API editing", () => {
  it("lets a bot replace its own message's text, and its cards when the fields bring blocks", async () => {
    const { bot, general } = await withBot();
    const posted = (await (await send("chat.postMessage", bot.key, { channel: general, text: "Deploying", attachments: [{ title: "web" }] })).json()) as { ts?: string };
    const updated = await send("chat.update", bot.key, { channel: general, ts: posted.ts, text: "Deployed to *production*" });
    expect(await envelopeOf(updated)).toEqual([200, { ok: true, channel: general, ts: posted.ts, message: expect.objectContaining({ text: "Deployed to production" }) }]);
    expect(await historyOf(bot.key, general)).toMatchObject({ ok: true, messages: [{ text: "Deployed to production" }] });

    const blocks = await send("chat.update", bot.key, { channel: general, ts: posted.ts, blocks: [{ type: "section", text: { type: "mrkdwn", text: "*Rolled* back" } }] });
    expect(await envelopeOf(blocks)).toEqual([200, { ok: true, channel: general, ts: posted.ts, message: expect.objectContaining({ text: "Rolled back" }) }]);
    expect(await historyOf(bot.key, general)).toMatchObject({ ok: true, messages: [{ text: "Rolled back" }] });
    const cards = (await roomSql(general, "SELECT cards FROM messages WHERE id = ?", posted.ts!)) as Array<{ cards: string | null }>;
    expect(cards).toEqual([{ cards: expect.stringContaining("Rolled") }]);
  });

  it("answers what it refuses: a message that isn't the bot's, and one there isn't", async () => {
    const { administrator, bot, general } = await withBot();
    const inRoom = await connect(general, administrator);
    const adminMessage = await post(inRoom, "Ada's own");
    const posted = (await (await send("chat.postMessage", bot.key, { channel: general, text: "The bot's own" })).json()) as { ts?: string };
    for (const [method, ts, error] of [
      ["chat.update", adminMessage.id, "cant_update_message"],
      ["chat.delete", adminMessage.id, "cant_delete_message"],
      ["chat.delete", "0nother00000000", "message_not_found"],
    ] as const) {
      const response = await send(method, bot.key, { channel: general, ts, text: "Hello" });
      expect([method, ts, await envelopeOf(response)]).toEqual([method, ts, [200, { ok: false, error }]]);
    }
    // Slack asks for text or blocks before it says whose the message is.
    expect(await envelopeOf(await send("chat.update", bot.key, { channel: general, ts: posted.ts }))).toEqual([200, { ok: false, error: "no_text" }]);
    expect(await envelopeOf(await send("chat.update", bot.key, { channel: general, ts: "0nother00000000", text: "Hello" }))).toEqual([
      200,
      { ok: false, error: "message_not_found" },
    ]);
    expect(await envelopeOf(await send("chat.delete", bot.key, { channel: general, ts: posted.ts }))).toEqual([200, { ok: true, channel: general, ts: posted.ts }]);
    expect(await historyOf(bot.key, general)).toMatchObject({ ok: true, messages: [{ text: "Ada's own" }] });
  });
});

describe("Slack Web API reading", () => {
  it("lists the rooms the bot is in but its DMs, as Slack's channels are written", async () => {
    const { administrator, bot, general, random } = await withBot();
    const inner = await createRoom("Inner", { closedTo: [administrator.user.id, bot.id], as: administrator });
    const started = await startDirect(administrator, [bot.id]);
    const { id: dm } = ((await started.json()) as { room: { id: RoomId } }).room;
    const listed = (await (await send("conversations.list", bot.key, undefined, { method: "GET" })).json()) as { channels?: Array<Record<string, unknown>> };
    expect((listed.channels ?? []).map(({ id, name, is_channel, is_private }) => ({ id, name, is_channel, is_private }))).toEqual([
      { id: general, name: "general", is_channel: true, is_private: false },
      { id: inner.id, name: "Inner", is_channel: false, is_private: true },
      { id: random, name: "random", is_channel: true, is_private: false },
    ]);
    expect((listed.channels ?? [])[0]).toEqual({
      id: general,
      name: "general",
      name_normalized: "general",
      is_channel: true,
      is_group: false,
      is_im: false,
      is_mpim: false,
      is_private: false,
      is_shared: false,
      is_archived: false,
      is_member: true,
      created: expect.any(Number),
      creator: administrator.user.id,
    });
    // A POST reads the same, and a DM is in neither.
    const posted = (await (await send("conversations.list", bot.key, {})).json()) as { channels?: Array<{ id: RoomId }> };
    expect((posted.channels ?? []).map(({ id }) => id)).not.toContain(dm);
    expect(await envelopeOf(await send("conversations.list", `${bot.id}-wrongwrongxx`))).toEqual([200, { ok: false, error: "invalid_auth" }]);
  });

  it("reads a room's history, oldest first, as its plain text, with whose each is, and its limit honored", async () => {
    const { administrator, bot, general } = await withBot();
    const inRoom = await connect(general, administrator);
    await post(inRoom, "First, from Ada");
    await send("chat.postMessage", bot.key, { channel: general, text: "Second, from the bot" });
    await send("chat.postMessage", bot.key, { channel: general, text: "Third, from the bot" });
    const read = await historyOf(bot.key, general);
    expect(read).toEqual({
      ok: true,
      channel: general,
      has_more: false,
      messages: [
        { type: "message", text: "First, from Ada", ts: expect.any(String), user: administrator.user.id },
        { type: "message", text: "Second, from the bot", ts: expect.any(String), user: bot.id },
        { type: "message", text: "Third, from the bot", ts: expect.any(String), user: bot.id },
      ],
    });

    const lastTwo = await historyOf(bot.key, general, { limit: "2" });
    expect(lastTwo.messages?.map(({ text }) => text)).toEqual(["Second, from the bot", "Third, from the bot"]);
    expect(lastTwo.has_more).toBe(true);
    // A JSON body's limit, which a number holds, too.
    const jsonLimit = (await (await send("conversations.history", bot.key, { channel: general, limit: 1 })).json()) as { messages?: HistoryMessage[]; has_more?: boolean };
    expect(jsonLimit.messages?.map(({ text }) => text)).toEqual(["Third, from the bot"]);
    expect(jsonLimit.has_more).toBe(true);

    const closed = await createRoom("Launch", { closedTo: [administrator.user.id], as: administrator });
    expect(await envelopeOf(await send("conversations.history", bot.key, { channel: closed.id }))).toEqual([200, { ok: false, error: "not_in_channel" }]);
  });
});

describe("Slack Web API failures", () => {
  it("answers an exception with its envelope, at 500, and leaves the methods' addresses to no other request", async () => {
    const { bot, general } = await withBot();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { getByName: () => ({ slackBot: () => Promise.reject(new Error("Workspace unavailable")) }) } as unknown as Env["WORKSPACE"];
    const response = await apiWith({ WORKSPACE: broken }, "/api/chat.postMessage", {
      method: "POST",
      body: JSON.stringify({ channel: general, text: "Hello" }),
      headers: { Authorization: `Bearer ${bot.key}` },
    });
    expect([response.status, await response.json()]).toEqual([500, { ok: false, error: "internal_error" }]);
    expect(errors).toHaveBeenCalledWith("POST /api/chat.postMessage failed:", expect.any(Error));
    // Only the methods the API takes are its: anything else at /api answers Ember's own 404.
    expect((await api("/api/chat.postMessage", { method: "GET" })).status).toBe(404);
    expect((await api("/api/chat.delete", { method: "GET" })).status).toBe(404);
    expect((await api("/api/conversations.history", { method: "GET" })).status).toBe(404);
    expect((await api("/api/conversations.list/x", { method: "POST" })).status).toBe(404);
  });
});
