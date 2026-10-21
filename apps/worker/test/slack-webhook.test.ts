import { feature } from "@ember/parity";
import { MAX_MESSAGE_HTML_LENGTH, MAX_MESSAGE_LENGTH, type BotAnswer, type BotSettings, type NewWorkspace, type RoomId, type SearchResults } from "@ember/protocol";
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
    const blank = [
      { type: "rich_text_list", style: "bullet", elements: [] },
      { type: "rich_text_list", style: "ordered", elements: [{ type: "rich_text_section", elements: [{ type: "text", text: " " }] }] },
      { type: "rich_text_section", elements: [{ type: "text", text: " \n " }] },
    ];
    expect(await answerTo(bot.key, general, { text: "Shown beside lists with nothing in them", blocks: [{ type: "rich_text", elements: blank }] })).toEqual(OK);

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
      "<p>Shown beside lists with nothing in them</p>",
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

  it("posts each legacy attachment as a card under the text, formatted only where mrkdwn_in says, with its blocks, or as its fallback", async () => {
    const { administrator, bot, general } = await withBot();
    const inRoom = await connect(general, administrator);
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
          pretext: "Before the card, *formatted*",
          author_name: "Ada & Grace",
          author_link: "https://example.com/ada",
          author_icon: "https://example.com/ada.png",
          text: "*Not formatted* without mrkdwn_in, but <https://example.com|linked> :tada:",
          fields: [
            { title: "Status", value: "*Passed*", short: true },
            { title: "Took", value: "42s", short: true },
            { title: "", value: "" },
          ],
          thumb_url: "https://example.com/thumb.png",
          footer: "CI &amp; CD <https://ci.example.com|:gear: CI>",
          footer_icon: "https://example.com/ci.png",
          ts: "1392734382.000200",
          mrkdwn_in: ["pretext", "fields"],
        },
        { fallback: "Not shown beside an image", image_url: "https://example.com/chart.png" },
        { fallback: "Only a fallback, *plain*" },
      ],
    };
    expect(await answerTo(bot.key, general, formattedHere)).toEqual(OK);
    // As Slack suggests a colored bar beside blocks.
    const blocksInside = {
      attachments: [
        {
          color: "good",
          fallback: "Deployed",
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: "*Deployed* to production" } },
            { type: "context", elements: [{ type: "mrkdwn", text: "by <@U1>" }] },
          ],
        },
        { fallback: "A chart, which doesn't show yet", blocks: [{ type: "image", image_url: "https://example.com/chart.png", alt_text: "chart" }] },
      ],
    };
    expect(await answerTo(bot.key, general, blocksInside)).toEqual(OK);

    const shown = await Promise.all([1, 2, 3].map(async () => (await inRoom.next("message.created")).message));
    expect(shown.map(({ body, plainText, cards }) => ({ body, plainText, cards }))).toEqual([
      {
        body: "",
        plainText: "[FIRING:1] InstanceDown (node-exporter prod)\nAlert: Instance down - critical\nDescription: node_1:9100 has been down for 5 minutes.\nRunbook 📓",
        cards: [
          {
            source: "attachment",
            color: "danger",
            parts: [
              { kind: "title", text: "[FIRING:1] InstanceDown (node-exporter prod)", href: "https://alertmanager.example.com/#/alerts?receiver=slack" },
              { kind: "text", html: "<p><strong>Alert:</strong> Instance down - <code>critical</code><br><strong>Description:</strong> node_1:9100 has been down for 5 minutes.</p>" },
              { kind: "buttons", buttons: [{ text: "Runbook 📓", href: "https://runbooks.example.com/instance-down", style: "danger" }] },
            ],
          },
        ],
      },
      {
        body: "<p>Nightly <strong>report</strong></p>",
        plainText: "Nightly report\nBefore the card, formatted\nAda & Grace\n*Not formatted* without mrkdwn_in, but linked 🎉\nStatus\nPassed\nTook\n42s\nCI & CD ⚙️ CI\nOnly a fallback, *plain*",
        cards: [
          {
            source: "attachment",
            pretext: "<p>Before the card, <strong>formatted</strong></p>",
            thumb: { url: "https://example.com/thumb.png", alt: "" },
            parts: [
              { kind: "author", name: "Ada & Grace", href: "https://example.com/ada", icon: "https://example.com/ada.png" },
              { kind: "text", html: '<p>*Not formatted* without mrkdwn_in, but <a href="https://example.com/">linked</a> 🎉</p>' },
              {
                kind: "fields",
                fields: [
                  { title: "Status", html: "<p><strong>Passed</strong></p>", short: true },
                  { title: "Took", html: "<p>42s</p>", short: true },
                ],
              },
              { kind: "footer", text: "CI & CD ⚙️ CI", icon: "https://example.com/ci.png", at: 1392734382.0002 },
            ],
          },
          { source: "attachment", parts: [{ kind: "image", image: { url: "https://example.com/chart.png", alt: "" } }] },
          { source: "attachment", parts: [{ kind: "text", html: "<p>Only a fallback, *plain*</p>" }] },
        ],
      },
      {
        body: "",
        plainText: "Deployed to production\n\nby @U1\nA chart, which doesn't show yet",
        cards: [
          { source: "attachment", color: "good", parts: [{ kind: "text", html: "<p><strong>Deployed</strong> to production</p><p>by @U1</p>" }] },
          { source: "attachment", parts: [{ kind: "text", html: "<p>A chart, which doesn't show yet</p>" }] },
        ],
      },
    ]);
    const later = await connect(general, administrator);
    expect(later.welcome.messages.map(({ id, cards }) => ({ id, cards }))).toEqual(shown.map(({ id, cards }) => ({ id, cards })));
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

describe(feature("bots.cards"), () => {
  /** Posts `payload` to general's webhook as its bot, answering the message it made, as the room sent it to `session`. */
  async function postedCards(payload: unknown) {
    const { administrator, bot, general } = await withBot();
    const inRoom = await connect(general, administrator);
    expect(await answerTo(bot.key, general, payload)).toEqual(OK);
    const { message } = await inRoom.next("message.created");
    return { administrator, bot, general, inRoom, message };
  }

  /** Message `id`'s address in `room` for the bot whose key is `key`. */
  const messagePath = (room: RoomId, key: string, id: string) => `/rooms/${room}/${key}/messages/${id}`;

  it("finds a message by its cards' text, which its plain text holds, carrying its cards to the search", async () => {
    const { administrator, general, message } = await postedCards({ attachments: [{ title: "Nightly deploy", fields: [{ title: "Region", value: "aardvark-east" }] }] });
    expect(message).toMatchObject({ body: "", plainText: "Nightly deploy\nRegion\naardvark-east" });

    await vi.waitFor(async () => expect(await roomSql(general, "SELECT seq FROM unindexed_messages WHERE room_id = ?", general)).toEqual([]));
    const found = (await (await api("/api/searches?q=aardvark", { headers: { Cookie: administrator.cookie } })).json()) as SearchResults;
    expect(found.messages.map(({ id, cards }) => ({ id, cards }))).toEqual([{ id: message.id, cards: message.cards }]);
  });

  it("leaves out links, images and icons that aren't web addresses on a named host, keeping the rest of the card, and email links in its text", async () => {
    const { message } = await postedCards({
      attachments: [
        {
          author_name: "Ada",
          author_link: "javascript:alert(1)",
          author_icon: "http://127.0.0.1/ada.png",
          title: "Deploy",
          title_link: "//example.com/deploy",
          text: "Ask <mailto:ada@example.com|Ada>",
          image_url: "data:image/png;base64,AAAA",
          thumb_url: "ftp://example.com/thumb.png",
          actions: [
            { type: "button", text: "Mail", url: "mailto:ada@example.com" },
            { type: "button", text: "Open", url: "https://example.com/open" },
          ],
          footer: "CI",
          footer_icon: "file:///etc/passwd",
        },
      ],
    });
    expect(message.cards).toEqual([
      {
        source: "attachment",
        parts: [
          { kind: "author", name: "Ada" },
          { kind: "title", text: "Deploy" },
          { kind: "text", html: '<p>Ask <a href="mailto:ada@example.com">Ada</a></p>' },
          { kind: "buttons", buttons: [{ text: "Open", href: "https://example.com/open" }] },
          { kind: "footer", text: "CI" },
        ],
      },
    ]);
  });

  it("answers no_text when neither text nor cards show anything, and msg_too_long for cards longer than a message's markup can be", async () => {
    const { bot, general } = await withBot();
    expect(await answerTo(bot.key, general, { attachments: [{ color: "good" }, { fallback: " ", footer: " " }] })).toEqual(refused(400, "no_text"));
    // Each escaped ampersand takes five characters.
    const attachments = Array.from({ length: 25 }, () => ({ text: "&".repeat(900) }));
    expect(await answerTo(bot.key, general, { attachments })).toEqual(refused(400, "msg_too_long"));
    expect(await bodiesIn(general)).toEqual([]);
  });

  it("refuses to change a message with cards from the room, which its editor offers only to delete", async () => {
    const { general, inRoom, message } = await postedCards({ text: "Deploying", attachments: [{ title: "web" }] });
    inRoom.send({ type: "message.update", messageId: message.id, body: "<p>Changed</p>" });
    expect(await inRoom.next("error")).toEqual({ type: "error", message: "Messages with cards can't be edited.", failed: "message.update" });
    expect(await bodiesIn(general)).toEqual(["<p>Deploying</p>"]);
  });

  it("takes a message's cards away when its bot replaces its text through the bot API", async () => {
    const { bot, general, inRoom, message } = await postedCards({ text: "Deploying", attachments: [{ title: "web" }] });
    const response = await api(messagePath(general, bot.key, message.id), { method: "PUT", body: "Deployed", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(response.status, await response.clone().text()).toBe(200);
    const { message: updated } = await inRoom.next("message.updated");
    expect(updated).toMatchObject({ id: message.id, body: "Deployed", plainText: "Deployed" });
    expect(updated.cards).toBeUndefined();
    expect(await roomSql(general, "SELECT cards FROM messages WHERE id = ?", message.id)).toEqual([{ cards: null }]);
  });

  it("keeps a message's cards and its plain text when its bot gives it a file", async () => {
    const { bot, general, inRoom, message } = await postedCards({ attachments: [{ title: "Build 42", text: "Passed" }] });
    const form = new FormData();
    form.set("attachment", new File(["Build passed"], "build.log", { type: "text/plain" }));
    const response = await api(messagePath(general, bot.key, message.id), { method: "PUT", body: form });
    expect(response.status, await response.clone().text()).toBe(200);
    const { message: updated } = await inRoom.next("message.updated");
    expect(updated).toMatchObject({ id: message.id, plainText: "Build 42\nPassed", cards: message.cards, attachment: { name: "build.log" } });
  });
});
