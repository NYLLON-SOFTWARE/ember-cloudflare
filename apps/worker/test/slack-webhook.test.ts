import { feature } from "@ember/parity";
import { MAX_MESSAGE_HTML_LENGTH, MAX_MESSAGE_LENGTH, type BotAnswer, type BotSettings, type NewWorkspace, type RoomId } from "@ember/protocol";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withoutBotKeys } from "../src/bots/api";
import type { Env } from "../src/env";
import { api, apiWith, connect, cookieOf, createRoom, freshDeploy, objectSql, roomSql, roomStub, shown, workspaceSql, type Session } from "./support";

// What a Slack incoming webhook is sent, posted to a room at /rooms/<room id>/<bot key>/slack (bots/slack.ts),
// so tools that post to Slack can post to Ember, answered as Slack's webhooks answer.

/** Sets Ember up with a bot, which is in first run's general room. */
async function withBot(): Promise<{ administrator: Session; bot: BotSettings; general: RoomId }> {
  const setUp = await api("/api/first_run", { method: "POST", body: JSON.stringify({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" }) });
  expect(setUp.status).toBe(201);
  const administrator = { user: shown(((await setUp.json()) as NewWorkspace).user), cookie: cookieOf(setUp) };
  const added = await api("/api/account/bots", { method: "POST", headers: { Cookie: administrator.cookie }, body: JSON.stringify({ name: "Build Bot" }) });
  expect(added.status, await added.clone().text()).toBe(201);
  const [{ id: general }] = (await workspaceSql("SELECT id FROM rooms WHERE name = 'general'")) as [{ id: RoomId }];
  return { administrator, bot: ((await added.json()) as BotAnswer).bot, general };
}

/** A room's Slack-compatible webhook for the bot whose key is `key`. */
const slackPath = (room: RoomId, key: string) => `/rooms/${room}/${key}/slack`;

/** Sends `body` to `room`'s Slack-compatible webhook for the bot whose key is `key`, as JSON unless `headers` say otherwise. */
const sendAs = (key: string, room: RoomId, body: BodyInit | null, headers: Record<string, string> = { "Content-Type": "application/json" }) =>
  api(slackPath(room, key), { method: "POST", body, headers });

/** Sends `payload` as JSON, answering what Slack's webhooks would: status, type and text. */
async function answerTo(key: string, room: RoomId, payload: unknown, headers?: Record<string, string>) {
  const response = await sendAs(key, room, typeof payload === "string" ? payload : JSON.stringify(payload), headers);
  return [response.status, response.headers.get("Content-Type"), await response.text()];
}

const OK = [200, "text/plain; charset=utf-8", "ok"];
const refused = (status: number, error: string) => [status, "text/plain; charset=utf-8", error];

/** The bodies of the messages `room` has, oldest first: on DO SQLite, none until its object has opened its database. */
async function bodiesIn(room: RoomId): Promise<string[]> {
  const opened = (await objectSql(roomStub(room), "SELECT name FROM sqlite_master WHERE name = 'messages'")).length > 0;
  if (!(env as { DB?: D1Database }).DB && !opened) return [];
  return ((await roomSql(room, "SELECT body FROM messages WHERE room_id = ? ORDER BY id", room)) as { body: string }[]).map(({ body }) => body);
}

/** A body its sender holds back until `meanwhile` has run, once the Worker has begun to read it. */
const heldBack = (text: string, meanwhile: () => Promise<unknown>) =>
  new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        await meanwhile();
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );

beforeEach(freshDeploy);

afterEach(() => {
  vi.restoreAllMocks();
});

describe(feature("bots.slack-webhook"), () => {
  it("posts a payload's text as the bot's message, read as mrkdwn, and answers ok, as Slack's webhooks do", async () => {
    const { administrator, bot, general } = await withBot();
    const inRoom = await connect(general, administrator);
    const payload = { text: "Deploy *finished* :tada: <https://ci.example.com/builds/42|Build 42> for <@U024BE7LH> <!here>" };
    expect(await answerTo(bot.key, general, payload)).toEqual(OK);

    const { message } = await inRoom.next("message.created");
    expect(message).toMatchObject({
      roomId: general,
      creator: { id: bot.id, name: "Build Bot" },
      body: '<p>Deploy <strong>finished</strong> 🎉 <a href="https://ci.example.com/builds/42">Build 42</a> for @U024BE7LH @here</p>',
      plainText: "Deploy finished 🎉 Build 42 for @U024BE7LH @here",
      mentions: [],
    });
  });

  it("posts as the bot, to the room its address names, whatever name, icon, channel or thread the payload asks for", async () => {
    const { administrator, bot, general } = await withBot();
    const inRoom = await connect(general, administrator);
    const payload = { text: "Hello", username: "Impostor", icon_emoji: ":ghost:", icon_url: "https://example.com/ghost.png", channel: "#random", thread_ts: "1503435956.000247" };
    expect(await answerTo(bot.key, general, payload)).toEqual(OK);
    expect((await inRoom.next("message.created")).message).toMatchObject({ roomId: general, creator: { id: bot.id, name: "Build Bot" }, body: "<p>Hello</p>" });
  });

  it("reads JSON whatever type the request says it is, or a form's payload field, urlencoded or multipart", async () => {
    const { bot, general } = await withBot();
    const json = (text: string) => JSON.stringify({ text });
    // As `curl -d` sends it, as text, and with no type at all.
    expect(await answerTo(bot.key, general, json("Form type"), { "Content-Type": "application/x-www-form-urlencoded" })).toEqual(OK);
    expect(await answerTo(bot.key, general, json("Text type"), { "Content-Type": "text/plain" })).toEqual(OK);
    expect((await sendAs(bot.key, general, new TextEncoder().encode(` \n${json("No type")}`), {})).status).toBe(200);

    const urlencoded = new URLSearchParams({ payload: json("A form's payload & more") });
    expect((await sendAs(bot.key, general, urlencoded, {})).status).toBe(200);
    // As the urlencoded form is written, but sent as text.
    expect(await answerTo(bot.key, general, `payload=${encodeURIComponent(json("Written as a form"))}`, { "Content-Type": "text/plain" })).toEqual(OK);
    const multipart = new FormData();
    multipart.set("payload", json("A multipart payload"));
    expect((await sendAs(bot.key, general, multipart, {})).status).toBe(200);

    expect(await bodiesIn(general)).toEqual([
      "<p>Form type</p>",
      "<p>Text type</p>",
      "<p>No type</p>",
      "<p>A form's payload &amp; more</p>",
      "<p>Written as a form</p>",
      "<p>A multipart payload</p>",
    ]);
  });

  it("answers what's wrong in Slack's words, as text, posting nothing", async () => {
    const { bot, general } = await withBot();
    for (const [payload, headers] of [
      ["Hello!", undefined],
      ["[1, 2]", undefined],
      ['{"text": "unfinished"', undefined],
      ["text=Hello", { "Content-Type": "application/x-www-form-urlencoded" }],
      ['payload="a string"', { "Content-Type": "application/x-www-form-urlencoded" }],
    ] as const) {
      expect([payload, ...(await answerTo(bot.key, general, payload, headers))]).toEqual([payload, ...refused(400, "invalid_payload")]);
    }
    const unnamed = new FormData();
    unnamed.set("text", '{"text": "Hello"}');
    expect((await sendAs(bot.key, general, unnamed, {})).status).toBe(400);
    expect(await answerTo(bot.key, general, "--x\r\n", { "Content-Type": "multipart/form-data; boundary=x" })).toEqual(refused(400, "invalid_payload"));

    for (const payload of [{}, { text: " \n\t" }, { text: 42 }, { attachments: [{ color: "good" }] }, { blocks: [{ type: "divider" }] }]) {
      expect([payload, ...(await answerTo(bot.key, general, payload))]).toEqual([payload, ...refused(400, "no_text")]);
    }
    expect(await answerTo(bot.key, general, { attachments: Array.from({ length: 101 }, () => ({ text: "Hi" })) })).toEqual(refused(400, "too_many_attachments"));
    expect(await answerTo(bot.key, general, { text: "x".repeat(MAX_MESSAGE_LENGTH + 1) })).toEqual(refused(400, "msg_too_long"));
    expect(await answerTo(bot.key, general, { text: "x".repeat(MAX_MESSAGE_HTML_LENGTH) })).toEqual(refused(413, "msg_too_long"));
    expect(await bodiesIn(general)).toEqual([]);

    expect(await answerTo(bot.key, general, { text: "x".repeat(MAX_MESSAGE_LENGTH) })).toEqual(OK);
    expect(await answerTo(bot.key, general, { attachments: Array.from({ length: 100 }, () => ({ text: "Hi" })) })).toEqual(OK);
  });

  it("answers 403 invalid_token to a key that isn't an active bot's, and 404 channel_not_found for a room the bot isn't in", async () => {
    const { administrator, bot, general } = await withBot();
    const payload = { text: "Hello!" };
    for (const key of [`${bot.id}-wrongwrongxx`, bot.id, "%E0%A4%A"]) expect([key, ...(await answerTo(key, general, payload))]).toEqual([key, ...refused(403, "invalid_token")]);

    const closed = await createRoom("Launch", { closedTo: [administrator.user.id], as: administrator });
    expect(await answerTo(bot.key, closed.id, payload)).toEqual(refused(404, "channel_not_found"));
    expect(await answerTo(bot.key, "0noroom0000000", payload)).toEqual(refused(404, "channel_not_found"));
    expect(await bodiesIn(general)).toEqual([]);
    // Slack's webhooks only take posts.
    expect((await api(slackPath(general, bot.key))).status).toBe(404);
  });

  it("checks the key again once the payload has arrived, so a bot given a new key while it sends posts nothing", async () => {
    const { administrator, bot, general } = await withBot();
    const reset = await sendAs(bot.key, general, heldBack(JSON.stringify({ text: "Old key" }), async () => {
      expect((await api(`/api/account/bots/${bot.id}/key`, { method: "PUT", headers: { Cookie: administrator.cookie } })).status).toBe(200);
    }));
    expect([reset.status, await reset.text()]).toEqual([403, "invalid_token"]);
    expect(await bodiesIn(general)).toEqual([]);
  });

  it("formats nothing but links, mentions, emoji and escapes beside mrkdwn: false", async () => {
    const { bot, general } = await withBot();
    expect(await answerTo(bot.key, general, { text: "*as is* <https://example.com|link> <@U1> :tada: &lt;3", mrkdwn: false })).toEqual(OK);
    expect(await bodiesIn(general)).toEqual(['<p>*as is* <a href="https://example.com/">link</a> @U1 🎉 &lt;3</p>']);
  });

  it("shows blocks in place of the text, as rich text until cards draw them, and the text when they show nothing yet", async () => {
    const { bot, general } = await withBot();
    const blocks = [
      { type: "header", text: { type: "plain_text", text: "Deploy finished :rocket:", emoji: true } },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*web* is live at <https://example.com|example.com>" },
        fields: [
          { type: "mrkdwn", text: "*Environment:*\nproduction" },
          { type: "plain_text", text: "Took 42s *as is*" },
        ],
        accessory: { type: "image", image_url: "https://example.com/logo.png", alt_text: "logo" },
      },
      { type: "divider" },
      { type: "context", elements: [{ type: "image", image_url: "https://example.com/a.png", alt_text: "Ada" }, { type: "mrkdwn", text: "By <@U1>" }] },
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: [
              { type: "text", text: "Read " },
              { type: "text", text: "this", style: { bold: true, italic: true } },
              { type: "link", url: "https://example.com/notes", text: " notes" },
              { type: "emoji", name: "wave", skin_tone: 3 },
              { type: "text", text: "\n" },
            ],
          },
          { type: "rich_text_list", style: "ordered", elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "one" }] }, { type: "rich_text_section", elements: [{ type: "user", user_id: "U2" }] }] },
          { type: "rich_text_preformatted", elements: [{ type: "text", text: "npm run deploy\n<ok>" }] },
          { type: "rich_text_quote", elements: [{ type: "text", text: "Quoted", style: { code: true } }] },
        ],
      },
      { type: "markdown", text: "**Markdown** as it's written" },
      {
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: "View build" }, url: "https://ci.example.com/42" },
          { type: "button", text: { type: "plain_text", text: "Approve" }, action_id: "approve" },
        ],
      },
    ];
    expect(await answerTo(bot.key, general, { text: "Deploy finished (hidden beside blocks)", blocks })).toEqual(OK);
    expect(await answerTo(bot.key, general, { text: "Shown *instead*", blocks: [{ type: "divider" }, { type: "image", image_url: "https://example.com/a.png", alt_text: "chart" }] })).toEqual(OK);

    expect(await bodiesIn(general)).toEqual([
      [
        "<p><strong>Deploy finished 🚀</strong></p>",
        '<p><strong>web</strong> is live at <a href="https://example.com/">example.com</a></p>',
        "<p><strong>Environment:</strong><br>production</p>",
        "<p>Took 42s *as is*</p>",
        "<p>By @U1</p>",
        '<p>Read <strong><em>this</em></strong><a href="https://example.com/notes"> notes</a>👋🏼</p>',
        "<ol><li>one</li><li>@U2</li></ol>",
        "<pre>npm run deploy\n&lt;ok&gt;</pre>",
        "<blockquote><p><code>Quoted</code></p></blockquote>",
        "<p>**Markdown** as it's written</p>",
        '<p><a href="https://ci.example.com/42">View build</a></p>',
      ].join(""),
      "<p>Shown <strong>instead</strong></p>",
    ]);
  });

  it("skips what it can't read in a block, such as a date or skin tone that isn't a number, rather than failing", async () => {
    const { bot, general } = await withBot();
    const elements = [
      { type: "date", timestamp: { valueOf: 1, toString: 1 } },
      { type: "text", text: "Deployed" },
      { type: "emoji", name: "wave", skin_tone: 2.5 },
    ];
    expect(await answerTo(bot.key, general, { blocks: [{ type: "rich_text", elements: [{ type: "rich_text_section", elements }] }] })).toEqual(OK);
    expect(await answerTo(bot.key, general, { text: ">>> Quoted\n```\nwith its code\n```\nto the end" })).toEqual(OK);
    expect(await bodiesIn(general)).toEqual(["<p>Deployed👋</p>", "<blockquote><p>Quoted</p><pre>with its code</pre><p>to the end</p></blockquote>"]);
  });

  it("posts each legacy attachment as a quote after its pretext, formatted only where mrkdwn_in says, or as its fallback", async () => {
    const { bot, general } = await withBot();
    // As Prometheus Alertmanager's Slack notifier sends an alert, by default.
    const alertmanager = {
      channel: "#alerts",
      username: "Alertmanager",
      attachments: [
        {
          color: "danger",
          title: "[FIRING:1] InstanceDown (node-exporter prod)",
          title_link: "https://alertmanager.example.com/#/alerts?receiver=slack",
          pretext: "",
          text: "*Alert:* Instance down - `critical`\n*Description:* node_1:9100 has been down for 5 minutes.",
          fallback: "[FIRING:1] InstanceDown (node-exporter prod) | https://alertmanager.example.com/#/alerts?receiver=slack",
          callback_id: "",
          footer: "",
          mrkdwn_in: ["fallback", "pretext", "text"],
          actions: [{ type: "button", text: "Runbook :notebook:", url: "https://runbooks.example.com/instance-down", style: "danger" }],
        },
      ],
    };
    expect(await answerTo(bot.key, general, alertmanager)).toEqual(OK);
    const formattedHere = {
      text: "Nightly *report*",
      attachments: [
        {
          pretext: "Before the quote, *formatted*",
          author_name: "Ada & Grace",
          author_link: "https://example.com/ada",
          text: "*Not formatted* without mrkdwn_in, but <https://example.com|linked> :tada:",
          fields: [
            { title: "Status", value: "*Passed*", short: true },
            { title: "Took", value: "42s", short: true },
          ],
          footer: "CI &amp; CD",
          ts: 1392734382,
          mrkdwn_in: ["pretext", "fields"],
        },
        { fallback: "Only a fallback, *plain*", image_url: "https://example.com/chart.png" },
      ],
    };
    expect(await answerTo(bot.key, general, formattedHere)).toEqual(OK);

    expect(await bodiesIn(general)).toEqual([
      "<blockquote>" +
        '<p><strong><a href="https://alertmanager.example.com/#/alerts?receiver=slack">[FIRING:1] InstanceDown (node-exporter prod)</a></strong></p>' +
        "<p><strong>Alert:</strong> Instance down - <code>critical</code><br><strong>Description:</strong> node_1:9100 has been down for 5 minutes.</p>" +
        '<p><a href="https://runbooks.example.com/instance-down">Runbook 📓</a></p>' +
        "</blockquote>",
      "<p>Nightly <strong>report</strong></p>" +
        "<p>Before the quote, <strong>formatted</strong></p>" +
        "<blockquote>" +
        '<p><a href="https://example.com/ada">Ada &amp; Grace</a></p>' +
        '<p>*Not formatted* without mrkdwn_in, but <a href="https://example.com/">linked</a> 🎉</p>' +
        "<p><strong>Status</strong></p><p><strong>Passed</strong></p>" +
        "<p><strong>Took</strong></p><p>42s</p>" +
        "<p>CI &amp; CD</p>" +
        "</blockquote>" +
        "<blockquote><p>Only a fallback, *plain*</p></blockquote>",
    ]);
  });

  it("filters the key out of its address in logs, as the bot API's, answering a failure with 500 JSON", async () => {
    expect(withoutBotKeys("POST /rooms/0mgk3x2a9b4c5a/0mgk3x2a9b4c5e-Ab3xK9mQz1Rt/slack")).toBe("POST /rooms/0mgk3x2a9b4c5a/[FILTERED]/slack");
    expect(withoutBotKeys("/rooms/1/slack")).toBe("/rooms/1/slack");

    const { bot, general } = await withBot();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { getByName: () => ({ botInRoom: () => Promise.reject(new Error("Workspace unavailable")) }) } as unknown as Env["WORKSPACE"];
    const response = await apiWith({ WORKSPACE: broken }, slackPath(general, bot.key), { method: "POST", body: '{"text": "Hello!"}' });
    expect([response.status, await response.json()]).toEqual([500, { status: 500, error: "Internal Server Error" }]);
    expect(errors).toHaveBeenCalledWith(`POST /rooms/${general}/[FILTERED]/slack failed:`, expect.any(Error));
    expect(JSON.stringify(errors.mock.calls)).not.toContain(bot.key.split("-")[1]);
  });
});
