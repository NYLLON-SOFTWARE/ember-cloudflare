import type { BotAnswer, BotSettings, Message, NewWorkspace, RoomId, SpecialMention } from "@ember/protocol";
import { MENTION_CONTENT_TYPE } from "@ember/richtext";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, connect, cookieOf, direct, freshDeploy, freshRoom, post, roomSql, shown, signIn, workspaceSql, workspaceStub, type Session, type Socket } from "./support";

// Slack's special mentions, @here and @channel, which name no one but notify a room: whom a message
// making one notifies, and how edits change that. pushes.test.ts checks whom each pushes, and
// mentions.test.ts how the @ prompt offers them.

beforeEach(freshDeploy);

afterEach(() => {
  vi.restoreAllMocks();
});

/** How a message makes the special mention `name`, as the composer writes one picked from the @ prompt. */
const special = (name: SpecialMention) => `<action-text-attachment sgid="${name}" content-type="${MENTION_CONTENT_TYPE}"></action-text-attachment>`;

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" }) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

/** Adds a bot as `administrator`, delivering to `webhookUrl` if it's given. */
async function addBot(administrator: Session, name: string, webhookUrl?: string): Promise<BotSettings> {
  const response = await api("/api/account/bots", { method: "POST", headers: { Cookie: administrator.cookie }, body: JSON.stringify({ name, webhookUrl }) });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as BotAnswer).bot;
}

/** Replies to `parent` in its thread as `client`, sending the reply to the room too with `alsoSend`, and waits for the room to confirm it. */
async function reply(client: Socket, parent: Message, body: string, alsoSend = false): Promise<Message> {
  const clientMessageId = crypto.randomUUID();
  client.send({ type: "message.create", clientMessageId, body, parentId: parent.id, alsoSend });
  for (;;) {
    const { message } = await client.next("message.created");
    if (message.clientMessageId === clientMessageId) return message;
  }
}

/** Edits `message` to `body` as `client`, and waits for the room to say how it is now. */
async function edit(client: Socket, message: Message, body: string): Promise<Message> {
  client.send({ type: "message.update", messageId: message.id, body });
  for (;;) {
    const { message: edited } = await client.next("message.updated");
    if (edited.id === message.id) return edited;
  }
}

/** Whom each of room `room`'s messages notifies, as it keeps them, oldest first. */
const notifiedIn = async (room: RoomId) => ((await roomSql(room, "SELECT notifies FROM messages WHERE room_id = ? ORDER BY id", room)) as Array<{ notifies: string | null }>).map(({ notifies }) => notifies);

describe("Notify a room", () => {
  it("notifies the room as the widest special mention a message sent to it makes, and says so to everyone who opens the room", async () => {
    const room = await freshRoom("Standup");
    const ada = await connect(room, "Ada");

    expect(await post(ada, `<p>${special("here")} ${special("channel")} Standup in 5</p>`)).toMatchObject({ notifies: "channel", plainText: "@here @channel Standup in 5" });
    expect(await post(ada, `<p>Back in 5 ${special("here")}</p>`)).toMatchObject({ notifies: "here", plainText: "Back in 5 @here" });
    expect((await post(ada, "<p>Nobody</p>")).notifies).toBeUndefined();
    expect((await connect(room, "Grace")).welcome.messages.map(({ notifies }) => notifies)).toEqual(["channel", "here", undefined]);
    expect(await notifiedIn(room)).toEqual(["channel", "here", null]);
  });

  it("notifies nobody with a message in a DM or a reply in a thread, sent to the room too or not, as Slack doesn't, though their special mentions show", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const dm = await direct(ada, grace);
    const inDm = await post(await connect(dm.id, ada), `<p>${special("here")} hi</p>`);
    expect(inDm).toMatchObject({ plainText: "@here hi" });
    expect(inDm.notifies).toBeUndefined();

    const room = await freshRoom("Threads");
    const adaThere = await connect(room, ada);
    const parent = await post(adaThere, "<p>Ship it?</p>");
    for (const alsoSend of [false, true]) {
      const sent = await reply(adaThere, parent, `<p>${special("channel")} yes</p>`, alsoSend);
      expect(sent).toMatchObject({ plainText: "@channel yes", alsoSent: alsoSend });
      expect(sent.notifies).toBeUndefined();
    }
    expect(await notifiedIn(room)).toEqual([null, null, null]);
  });

  it("lets a bot notify the room through its key, as anyone can, but not with what it says back to a delivery, which is a reply", async () => {
    const ada = await setUp();
    const [{ id: general }] = (await workspaceSql("SELECT id FROM rooms WHERE name = 'general'")) as [{ id: RoomId }];
    const bot = await addBot(ada, "Build Bot", "https://bots.example.com/build");
    // The webhook says back a message making @channel, made in the room's own context, which reads it.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(`<p>${special("channel")} deployed</p>`, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const posted = await api(`/rooms/${general}/${bot.key}/messages`, { method: "POST", body: `<p>${special("here")} build passed</p>`, headers: { "Content-Type": "text/html" } });
    expect(posted.status, await posted.clone().text()).toBe(201);
    const client = await connect(general, ada);

    await post(client, `<p>Deploy, <action-text-attachment sgid="${bot.id}" content-type="${MENTION_CONTENT_TYPE}"></action-text-attachment></p>`);
    expect((await client.next("message.created")).message).toMatchObject({ creator: { id: bot.id }, plainText: "@channel deployed" });
    expect(await notifiedIn(general)).toEqual(["here", null, null]);
  });

  it("lets anyone notify a room with either, but not a DM, nor an AI agent, which is a bot without a key", async () => {
    const [ada, grace, agent, bot] = [await signIn("Ada"), await signIn("Grace"), await signIn("Agent"), await signIn("Bot")];
    await workspaceSql("UPDATE users SET role = 2 WHERE id IN (?, ?)", agent.user.id, bot.user.id);
    await workspaceSql("UPDATE users SET bot_token = 'its-key' WHERE id = ?", bot.user.id);
    const room = await freshRoom("Leads");
    const dm = await direct(ada, grace);
    const workspace = workspaceStub();

    expect(await workspace.notifyingMentions(room, ada.user.id)).toEqual(["here", "channel"]);
    expect(await workspace.notifyingMentions(room, bot.user.id)).toEqual(["here", "channel"]);
    expect(await workspace.notifyingMentions(room, agent.user.id)).toEqual([]);
    expect(await workspace.notifyingMentions(dm.id, ada.user.id)).toEqual([]);
    expect(await workspace.notifyingMentions("0000000000000000", ada.user.id)).toEqual([]);
  });
});

describe("Edit a message that notifies a room", () => {
  it("notifies no more widely once edited, as an edit notifies nobody, and nobody once its special mentions are gone", async () => {
    const room = await freshRoom("Edits");
    const ada = await connect(room, "Ada");
    const sent = await post(ada, `<p>${special("channel")} ${special("here")} Standup</p>`);

    const steps = [`<p>${special("here")} Standup</p>`, `<p>${special("channel")} Standup</p>`, "<p>Standup</p>", `<p>${special("channel")} Standup</p>`];
    let message = sent;
    const notified = [];
    for (const body of steps) {
      message = await edit(ada, message, body);
      notified.push(message.notifies);
    }
    expect(notified).toEqual(["here", "here", undefined, undefined]);
    expect(await notifiedIn(room)).toEqual([null]);
  });

  it("keeps whom a message notifies when its link's preview is added after sending", async () => {
    const room = await freshRoom("Previews");
    const ada = await connect(room, "Ada");
    const sent = await post(ada, `<p>${special("here")} <a href="https://digg.com/tech/oe71bdha">https://digg.com/tech/oe71bdha</a></p>`);
    expect(sent.notifies).toBe("here");

    ada.send({ type: "message.preview", clientMessageId: sent.clientMessageId, preview: { title: "SignuDoc", url: "https://digg.com/tech/oe71bdha", image: "https://digg.com/og.png", description: "A signing app" } });
    const { message } = await ada.next("message.updated");
    expect(message).toMatchObject({ id: sent.id, notifies: "here", editedAt: null });
    expect(message.body).not.toBe(sent.body);
  });
});
