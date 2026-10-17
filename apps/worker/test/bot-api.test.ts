import { feature } from "@ember/parity";
import {
  HISTORY_PAGE_SIZE,
  MAX_MESSAGE_HTML_LENGTH,
  MAX_MESSAGE_LENGTH,
  MESSAGE_TOO_LONG,
  type BotAnswer,
  type BotSettings,
  type DirectRoom,
  type Directory,
  type Me,
  type NewWorkspace,
  type RoomId,
  type SearchResults,
} from "@ember/protocol";
import { MENTION_CONTENT_TYPE, mentionSgid } from "@ember/richtext";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withoutBotKeys } from "../src/bots/api";
import type { Env } from "../src/env";
import { AUTHORIZATION_TTL_MS } from "../src/revocations";
import { COUNT_MESSAGES } from "../src/store";
import { env } from "cloudflare:workers";
import { api, apiWith, connect, cookieOf, createRoom, freshDeploy, objectSql, origin, roomSql, roomStub, shown, startDirect, workspaceSql, type Session } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };
const grace = { name: "Grace Hopper", emailAddress: "grace@example.com", password: "compiler design" };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

/** Grace joins with the join link, as a member, signed in. */
async function joinAsGrace(): Promise<Session> {
  const [{ join_code: joinCode }] = (await workspaceSql("SELECT join_code FROM accounts")) as [{ join_code: string }];
  const response = await api(`/api/join/${joinCode}`, { method: "POST", body: JSON.stringify(grace) });
  expect(response.status, await response.clone().text()).toBe(201);
  return { user: shown(((await response.json()) as { user: Me }).user), cookie: cookieOf(response) };
}

/** Adds a bot as `administrator`, answering it as its edit page shows it, key and all. */
async function addBot(administrator: Session, name = "Build Bot"): Promise<BotSettings> {
  const response = await api("/api/account/bots", { method: "POST", headers: { Cookie: administrator.cookie }, body: JSON.stringify({ name }) });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as BotAnswer).bot;
}

/** Gives `bot` a new key, as `administrator` can on its edit page, answering it as the page then shows it. */
async function newKeyFor(administrator: Session, bot: BotSettings): Promise<BotSettings> {
  const response = await api(`/api/account/bots/${bot.id}/key`, { method: "PUT", headers: { Cookie: administrator.cookie } });
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as BotAnswer).bot;
}

/** Sets Ember up with a bot, which is in first run's general room. */
async function withBot() {
  const administrator = await setUp();
  const bot = await addBot(administrator);
  const [{ id: general }] = (await workspaceSql("SELECT id FROM rooms WHERE name = 'general'")) as [{ id: RoomId }];
  return { administrator, bot, general };
}

/** A room's address for the bot whose key is `key`. */
const botPath = (room: RoomId, key: string, query = "") => `/rooms/${room}/${key}/messages${query}`;

/** Posts `body` to `room` as the bot whose key is `key`, as `curl -d` does unless `headers` say otherwise. */
const postAs = (key: string, room: RoomId, body: BodyInit | null, headers: Record<string, string> = {}) =>
  api(botPath(room, key), { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers } });

/** Resolves once rooms have heard every revocation, as they do just after the change that queued it. */
const revocationsDelivered = () =>
  vi.waitFor(async () => expect(await workspaceSql("SELECT count(*) AS n FROM pending_revocations")).toEqual([{ n: 0 }]), { timeout: 5_000 });

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

/** Reads `room` as the bot whose key is `key`. */
const readAs = (key: string, room: RoomId, query = "", init: RequestInit = {}) => api(botPath(room, key, query), init);

/** Posts `body` as the bot whose key is `key`, answering the new message's id. */
async function posted(key: string, room: RoomId, body: string): Promise<string> {
  const response = await postAs(key, room, body);
  expect(response.status, await response.clone().text()).toBe(201);
  return response.headers.get("Location")!.split("/@")[1]!;
}

/** Whether room `room`'s object has opened a database of its own, as it does on DO SQLite once it's used. */
const opened = async (room: RoomId) => (await objectSql(roomStub(room), "SELECT name FROM sqlite_master WHERE name = 'messages'")).length > 0;

/** The messages `room` has, oldest first, as its database holds them: on DO SQLite, none until its object has opened one. */
async function storedIn(room: RoomId): Promise<Array<{ id: string; creator_id: string; body: string }>> {
  if (!(env as { DB?: D1Database }).DB && !(await opened(room))) return [];
  return (await roomSql(room, "SELECT id, creator_id, body FROM messages WHERE room_id = ? ORDER BY id", room)) as Array<{ id: string; creator_id: string; body: string }>;
}

/** The page of messages a bot reads, parsed. */
interface ListedMessage {
  id: string;
  created_at: string;
  body: { plain_text: string; html: string };
  creator: { id: string; name: string; role: string; avatar_url: string };
  room: { id: RoomId };
  url: string;
}

async function listedBy(key: string, room: RoomId, query = ""): Promise<ListedMessage[]> {
  const response = await readAs(key, room, query);
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}

/** Someone's avatar's address, as the people directory gives it to `viewer`. */
async function avatarOf(viewer: Session, userId: string): Promise<string> {
  const { users } = (await (await api("/api/users", { headers: { Cookie: viewer.cookie } })).json()) as Directory;
  return users.find((user) => user.id === userId)!.avatarUrl;
}

const tokenOf = (bot: BotSettings) => bot.key.slice(bot.id.length + 1);

beforeEach(freshDeploy);

afterEach(() => {
  vi.restoreAllMocks();
});

describe(feature("bots.api-auth"), () => {
  it("posts as the bot whose key is in the address, with or without .json, spaces around the key and anything after a second '-' ignored", async () => {
    const { administrator, bot, general } = await withBot();
    const inRoom = await connect(general, administrator);
    for (const key of [bot.key, `%20${bot.key}%0A`, `${bot.key}-ignored`]) {
      expect((await postAs(key, general, `Hello from ${key}`)).status).toBe(201);
      const { message } = await inRoom.next("message.created");
      expect(message.creator).toEqual({ id: bot.id, name: "Build Bot" });
    }
    const json = await api(`/rooms/${general}/${bot.key}/messages.json`, { method: "POST", body: "As JSON" });
    expect(json.status).toBe(201);
    expect((await storedIn(general)).map(({ creator_id }) => creator_id)).toEqual([bot.id, bot.id, bot.id, bot.id]);
  });

  it("answers 401 to a key that isn't an active bot's, posting and reading nothing, where ember-rust sends it to sign in", async () => {
    const { administrator, bot, general } = await withBot();
    const keys = [
      `${bot.id}-wrongwrongxx`,
      `${bot.id}-${tokenOf(bot)}x`,
      `${bot.id}-${tokenOf(bot).slice(1)}`,
      `0nobody0000000-${tokenOf(bot)}`,
      // Someone who isn't a bot has no token, so a key with an empty one can't be theirs.
      `${administrator.user.id}-`,
      `${administrator.user.id}--${tokenOf(bot)}`,
      `${bot.id}-`,
      bot.id,
      `-${tokenOf(bot)}`,
      "%E0%A4%A",
    ];
    for (const key of keys) {
      const post = await postAs(key, general, "Hello!");
      expect([key, post.status, await post.json()]).toEqual([key, 401, { error: "Unknown bot key" }]);
      const read = await readAs(key, general);
      expect([key, read.status]).toEqual([key, 401]);
    }
    expect(await storedIn(general)).toEqual([]);
  });

  it("stops taking a key once its bot is deleted, or given a new one", async () => {
    const { administrator, bot, general } = await withBot();
    const renewed = await newKeyFor(administrator, bot);
    expect((await postAs(bot.key, general, "Old key")).status).toBe(401);
    expect((await postAs(renewed.key, general, "New key")).status).toBe(201);

    expect((await api(`/api/account/bots/${bot.id}`, { method: "DELETE", headers: { Cookie: administrator.cookie } })).status).toBe(204);
    expect((await postAs(renewed.key, general, "Deleted")).status).toBe(401);
    expect((await readAs(renewed.key, general)).status).toBe(401);
    expect((await storedIn(general)).map(({ body }) => body)).toEqual(["New key"]);
  });

  it("checks the key again once the body has arrived, so a bot given a new key or taken out of the room while it sends posts nothing", async () => {
    const { administrator, bot, general } = await withBot();
    let renewed = bot;
    const reset = await postAs(bot.key, general, heldBack("Old key", async () => {
      renewed = await newKeyFor(administrator, bot);
    }));
    expect([reset.status, await reset.json()]).toEqual([401, { error: "Unknown bot key" }]);

    const room = await createRoom("Launch", { closedTo: [administrator.user.id, bot.id], as: administrator });
    const takeBotOut = JSON.stringify({ kind: "closed", memberIds: [administrator.user.id] });
    const out = await postAs(renewed.key, room.id, heldBack("Taken out", async () => {
      expect((await api(`/api/rooms/${room.id}`, { method: "PATCH", headers: { Cookie: administrator.cookie }, body: takeBotOut })).status).toBe(200);
    }));
    expect([out.status, await out.text()]).toEqual([404, ""]);

    expect(await storedIn(general)).toEqual([]);
    expect(await storedIn(room.id)).toEqual([]);
    expect((await postAs(renewed.key, general, "New key")).status).toBe(201);
  });

  it("posts nothing for a bot that the room has heard was taken out since its key was checked, as a socket would be turned away", async () => {
    const { administrator, bot, general } = await withBot();
    const room = await createRoom("Launch", { closedTo: [administrator.user.id, bot.id], as: administrator });
    const letThrough = { bot: { id: bot.id, name: bot.name }, authorizedAt: Date.now() };
    const takeBotOut = JSON.stringify({ kind: "closed", memberIds: [administrator.user.id] });
    expect((await api(`/api/rooms/${room.id}`, { method: "PATCH", headers: { Cookie: administrator.cookie }, body: takeBotOut })).status).toBe(200);
    await revocationsDelivered();
    expect(await roomStub(room.id).createBotMessage(room.id, letThrough, "Too late")).toBeNull();
    expect(await storedIn(room.id)).toEqual([]);
    // Nor after a check older than a socket's authorization can be, in a room it's still in.
    const stale = { bot: { id: bot.id, name: bot.name }, authorizedAt: Date.now() - AUTHORIZATION_TTL_MS - 1 };
    expect(await roomStub(general).createBotMessage(general, stale, "Too old")).toBeNull();
    expect(await storedIn(general)).toEqual([]);
  });

  it("answers an empty 404 for a room the bot isn't in, once the key is checked, and never wakes it", async () => {
    const { administrator, bot, general } = await withBot();
    const secrets = await createRoom("Secrets", { closedTo: [administrator.user.id], as: administrator });
    for (const room of [secrets.id, "0nowhere000000", "%E0%A4%A"]) {
      const post = await postAs(bot.key, room, "Hello!");
      expect([room, post.status, post.headers.get("Content-Type"), await post.text()]).toEqual([room, 404, "text/html", ""]);
      const read = await readAs(bot.key, room);
      expect([room, read.status, await read.text()]).toEqual([room, 404, ""]);
    }
    expect((await postAs(`${bot.id}-wrongwrongxx`, secrets.id, "Hello!")).status).toBe(401);
    expect(await opened(secrets.id)).toBe(false);
    expect(await storedIn(secrets.id)).toEqual([]);
    expect((await postAs(bot.key, general, "Hello!")).status).toBe(201);
  });

  it("posts in a DM the bot is in, which the bots page doesn't list", async () => {
    const { administrator, bot } = await withBot();
    const response = await startDirect(administrator, [bot.id]);
    expect(response.status).toBe(201);
    const { room } = (await response.json()) as { room: DirectRoom };
    expect((await postAs(bot.key, room.id, "Hello, Ada")).status).toBe(201);
    expect(await listedBy(bot.key, room.id)).toMatchObject([{ body: { plain_text: "Hello, Ada" }, creator: { id: bot.id } }]);
  });

  it("never reads a session, so a cookie makes no difference and posts from other sites are taken, where ember-rust acts as the cookie's person", async () => {
    const { administrator, bot, general } = await withBot();
    const fromElsewhere = { Cookie: administrator.cookie, "Sec-Fetch-Site": "cross-site", Origin: "https://elsewhere.example" };
    expect((await postAs(bot.key, general, "From CI", fromElsewhere)).status).toBe(201);
    expect((await postAs(`${bot.id}-wrongwrongxx`, general, "As Ada?", fromElsewhere)).status).toBe(401);
    expect(await storedIn(general)).toMatchObject([{ creator_id: bot.id, body: "From CI" }]);
  });

  it("isn't taken anywhere else: other addresses never read a bot key, and answer as they do to anyone signed out", async () => {
    const { bot } = await withBot();
    for (const path of [`/api/sidebar?bot_key=${bot.key}`, `/api/users?bot_key=${bot.key}`]) expect((await api(path)).status).toBe(401);
  });

  it("refuses posts from a banned IP address with 429, which can still read", async () => {
    const { administrator, bot, general } = await withBot();
    const member = await joinAsGrace();
    const signedIn = await api("/api/session", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.9" },
      body: JSON.stringify({ emailAddress: grace.emailAddress, password: grace.password }),
    });
    expect(signedIn.status).toBe(201);
    expect((await api(`/api/users/${member.user.id}/ban`, { method: "POST", headers: { Cookie: administrator.cookie } })).status).toBe(200);

    const refused = await postAs(bot.key, general, "Hello!", { "CF-Connecting-IP": "203.0.113.9" });
    expect([refused.status, await refused.text()]).toEqual([429, ""]);
    expect((await readAs(bot.key, general, "", { headers: { "CF-Connecting-IP": "203.0.113.9" } })).status).toBe(200);
    expect(await storedIn(general)).toEqual([]);
  });
});

describe(feature("bots.api-post"), () => {
  it("posts the request's body, whatever its type, as the bot's message, which reaches everyone in the room at once", async () => {
    const { administrator, bot, general } = await withBot();
    const inRoom = await connect(general, administrator);

    const response = await postAs(bot.key, general, "Hello!");
    expect(response.status).toBe(201);
    const { message } = await inRoom.next("message.created");
    expect(message).toMatchObject({ roomId: general, creator: { id: bot.id, name: "Build Bot" }, body: "Hello!", plainText: "Hello!", mentions: [] });

    await postAs(bot.key, general, '{"status":"passed"}', { "Content-Type": "application/json" });
    expect((await inRoom.next("message.created")).message.plainText).toBe('{"status":"passed"}');
    await postAs(bot.key, general, "Deploy finished 🚀 ünïcödé", { "Content-Type": "text/plain; charset=utf-8" });
    expect((await inRoom.next("message.created")).message.plainText).toBe("Deploy finished 🚀 ünïcödé");
  });

  it("answers 201 with an empty body and the message's permalink, on the host it was asked at, where ember-rust gives /messages/<id>", async () => {
    const { bot, general } = await withBot();
    const response = await postAs(bot.key, general, "Hello!");
    const [stored] = await storedIn(general);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Location")).toBe(`${origin}/rooms/${general}/@${stored!.id}`);

    const elsewhere = await apiWith({}, `https://chat.example.org${botPath(general, bot.key)}`, { method: "POST", body: "Hello again" });
    expect(elsewhere.headers.get("Location")).toMatch(new RegExp(`^https://chat\\.example\\.org/rooms/${general}/@`));
  });

  it("replaces bytes that aren't UTF-8, as ember-rust does", async () => {
    const { bot, general } = await withBot();
    expect((await postAs(bot.key, general, new Uint8Array([0x48, 0x69, 0xff, 0x21]), { "Content-Type": "application/octet-stream" })).status).toBe(201);
    expect((await listedBy(bot.key, general))[0]!.body.plain_text).toBe("Hi\uFFFD!");
  });

  it("posts rich text: its formatting shows and its mentions mention people", async () => {
    const { administrator, bot, general } = await withBot();
    const inRoom = await connect(general, administrator);
    const mention = `<action-text-attachment sgid="${mentionSgid(administrator.user.id)}" content-type="${MENTION_CONTENT_TYPE}"></action-text-attachment>`;
    await postAs(bot.key, general, `<p><strong>Build 42</strong> passed, ${mention}</p>`);
    const { message } = await inRoom.next("message.created");
    expect(message.body).toContain("<strong>Build 42</strong>");
    expect(message.mentions).toEqual([administrator.user]);
    expect(message.plainText).toMatch(/^Build 42 passed, @Ada/);
  });

  it("counts as unread for the room's people and can be searched for, as anyone's message can", async () => {
    const { bot, general } = await withBot();
    const member = await joinAsGrace();
    const id = await posted(bot.key, general, "Nightly deploy finished");

    while ((await roomSql(general, "SELECT seq FROM room_events WHERE room_id = ?", general)).length > 0) await sleep(5);
    const unread = await workspaceSql("SELECT user_id FROM memberships WHERE room_id = ? AND unread_at IS NOT NULL", general);
    expect(unread).toContainEqual({ user_id: member.user.id });
    expect(unread).not.toContainEqual({ user_id: bot.id });

    while ((await roomSql(general, "SELECT seq FROM unindexed_messages WHERE room_id = ?", general)).length > 0) await sleep(5);
    const found = (await (await api("/api/searches?q=deploy", { headers: { Cookie: member.cookie } })).json()) as SearchResults;
    expect(found.messages.map((message) => message.id)).toEqual([id]);
  });

  it("answers an empty 422 for a body that's empty or only spaces, posting nothing", async () => {
    const { bot, general } = await withBot();
    for (const body of [null, "", " \n\t "]) {
      const response = await postAs(bot.key, general, body);
      expect([JSON.stringify(body), response.status, await response.text()]).toEqual([JSON.stringify(body), 422, ""]);
    }
    expect(await storedIn(general)).toEqual([]);
  });

  it("refuses markup that shows nothing, or more text than a message can have, with 422 and why, where ember-rust posts it", async () => {
    const { bot, general } = await withBot();
    const empty = await postAs(bot.key, general, "<p> </p><p><br></p>");
    expect([empty.status, await empty.json()]).toEqual([422, { error: "Your message is empty." }]);
    const long = await postAs(bot.key, general, "x".repeat(MAX_MESSAGE_LENGTH + 1));
    expect([long.status, await long.json()]).toEqual([422, { error: MESSAGE_TOO_LONG }]);
    expect(await storedIn(general)).toEqual([]);
    expect((await postAs(bot.key, general, "x".repeat(MAX_MESSAGE_LENGTH))).status).toBe(201);
  });

  it("answers 413 to more markup than a message can arrive as, sent whole or in pieces, where ember-rust takes up to 16 MiB", async () => {
    const { bot, general } = await withBot();
    const whole = await postAs(bot.key, general, "x".repeat(MAX_MESSAGE_HTML_LENGTH + 1));
    expect([whole.status, await whole.json()]).toEqual([413, { status: 413, error: "Content Too Large" }]);

    // Without a length, read only until it's too long.
    const piece = new TextEncoder().encode("x".repeat(MAX_MESSAGE_HTML_LENGTH));
    const pieces = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(piece);
        controller.close();
      },
    });
    expect((await postAs(bot.key, general, pieces)).status).toBe(413);
    expect(await storedIn(general)).toEqual([]);
  });

  it("answers 415 to a form, as `curl -F` sends a file, until files can be stored", async () => {
    const { bot, general } = await withBot();
    const form = new FormData();
    form.set("attachment", new File(["report"], "report.txt", { type: "text/plain" }));
    const response = await api(botPath(general, bot.key), { method: "POST", body: form });
    expect([response.status, await response.json()]).toEqual([415, { error: "Bots can't post files yet" }]);
    expect(await storedIn(general)).toEqual([]);
  });

  it("posts nothing once the room has been deleted, which a post let through just before can find", async () => {
    const { administrator, bot, general } = await withBot();
    const room = await createRoom("Launch", { as: administrator });
    const letThrough = { bot: { id: bot.id, name: bot.name }, authorizedAt: Date.now() };
    expect((await api(`/api/rooms/${room.id}`, { method: "DELETE", headers: { Cookie: administrator.cookie } })).status).toBe(204);
    await revocationsDelivered();
    expect(await roomStub(room.id).createBotMessage(room.id, letThrough, "Too late")).toBeNull();
    expect(await storedIn(room.id)).toEqual([]);
    expect((await postAs(bot.key, room.id, "Too late")).status).toBe(404);
    expect((await postAs(bot.key, general, "Still here")).status).toBe(201);
  });
});

describe(feature("bots.api-list"), () => {
  /** Posts `count` messages as the bot, numbered from 1, answering their ids in order. */
  async function postMany(key: string, room: RoomId, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let n = 1; n <= count; n++) ids.push(await posted(key, room, `Message ${n}`));
    return ids;
  }

  it("answers the newest 40 messages, oldest first, with how many the room has and a Link to the older ones", async () => {
    const { bot, general } = await withBot();
    const ids = await postMany(bot.key, general, HISTORY_PAGE_SIZE + 5);

    const response = await readAs(bot.key, general);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("X-Total-Count")).toBe("45");
    expect(response.headers.get("Link")).toBe(`<${origin}/rooms/${general}/${bot.key}/messages?before=${ids[5]}>; rel="next"`);
    const page = (await response.json()) as ListedMessage[];
    expect(page.map(({ id }) => id)).toEqual(ids.slice(5));

    // The first page has nothing older, so no Link.
    const before = await readAs(bot.key, general, `?before=${ids[5]}`);
    expect(((await before.json()) as ListedMessage[]).map(({ id }) => id)).toEqual(ids.slice(0, 5));
    expect(before.headers.get("Link")).toBeNull();
    expect(before.headers.get("X-Total-Count")).toBe("45");
  });

  it("answers the 40 after ?after, with a Link to newer ones only while there are some", async () => {
    const { bot, general } = await withBot();
    const ids = await postMany(bot.key, general, HISTORY_PAGE_SIZE + 5);

    const after = await readAs(bot.key, general, `?after=${ids[0]}`);
    expect(((await after.json()) as ListedMessage[]).map(({ id }) => id)).toEqual(ids.slice(1, 41));
    expect(after.headers.get("Link")).toBe(`<${origin}/rooms/${general}/${bot.key}/messages?after=${ids[40]}>; rel="next"`);
    const last = await readAs(bot.key, general, `?after=${ids[40]}`);
    expect(((await last.json()) as ListedMessage[]).map(({ id }) => id)).toEqual(ids.slice(41));
    expect(last.headers.get("Link")).toBeNull();
  });

  it("reads before ?before when ?after is given too, with a Link after the page's last message, as ember-rust does", async () => {
    const { bot, general } = await withBot();
    const ids = await postMany(bot.key, general, 10);
    const both = await readAs(bot.key, general, `?after=${ids[0]}&before=${ids[5]}`);
    expect(((await both.json()) as ListedMessage[]).map(({ id }) => id)).toEqual(ids.slice(0, 5));
    expect(both.headers.get("Link")).toBe(`<${origin}/rooms/${general}/${bot.key}/messages?after=${ids[4]}>; rel="next"`);

    // A blank cursor is no cursor.
    const blank = await readAs(bot.key, general, "?before=&after=%20");
    expect(((await blank.json()) as ListedMessage[]).map(({ id }) => id)).toEqual(ids);
    expect(blank.headers.get("Link")).toBeNull();
  });

  it("answers 404 JSON for a cursor that isn't one of the room's messages", async () => {
    const { administrator, bot, general } = await withBot();
    const elsewhere = await createRoom("Elsewhere", { as: administrator });
    const theirs = await posted(bot.key, elsewhere.id, "Over here");
    await posted(bot.key, general, "Here");
    for (const query of [`?before=${theirs}`, `?after=${theirs}`, "?before=0nothing000000", "?after=x"]) {
      const response = await readAs(bot.key, general, query);
      expect([query, response.status, response.headers.get("Content-Type"), await response.text()]).toEqual([
        query,
        404,
        "application/json; charset=UTF-8",
        '{"status":404,"error":"Not Found"}',
      ]);
    }
  });

  it("answers [] for a room without messages, with a count of 0 and no Link", async () => {
    const { bot, general } = await withBot();
    const response = await readAs(bot.key, general);
    expect([response.status, await response.text()]).toEqual([200, "[]"]);
    expect(response.headers.get("X-Total-Count")).toBe("0");
    expect(response.headers.get("Link")).toBeNull();
  });

  it("writes each message as Campfire's JSON does, in its order, with its writer as they are now and absolute addresses", async () => {
    const { administrator, bot, general } = await withBot();
    const inRoom = await connect(general, administrator);
    inRoom.send({ type: "message.create", clientMessageId: "ada-1", body: "<p>Ship it &amp; <em>tell</em> me</p>" });
    const { message: adas } = await inRoom.next("message.created");
    await posted(bot.key, general, "Shipped 🚀");
    await api(`/api/account/bots/${bot.id}`, { method: "PATCH", headers: { Cookie: administrator.cookie }, body: JSON.stringify({ name: "Deploy Bot" }) });

    const response = await readAs(bot.key, general);
    const text = await response.text();
    const [first, second] = JSON.parse(text) as ListedMessage[];
    expect(Object.keys(first!)).toEqual(["id", "created_at", "body", "creator", "room", "url"]);
    expect(Object.keys(first!.creator)).toEqual(["id", "name", "role", "avatar_url"]);
    expect(first).toEqual({
      id: adas.id,
      created_at: adas.createdAt,
      body: { plain_text: "Ship it & tell me", html: `<div class="lexxy-content">\n  ${adas.body}\n</div>\n` },
      creator: { id: administrator.user.id, name: "Ada Lovelace", role: "administrator", avatar_url: `${origin}${await avatarOf(administrator, administrator.user.id)}` },
      room: { id: general },
      url: `${origin}/rooms/${general}/@${adas.id}`,
    });
    expect(first!.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(second).toMatchObject({ body: { plain_text: "Shipped 🚀" }, creator: { id: bot.id, name: "Deploy Bot", role: "bot", avatar_url: `${origin}${await avatarOf(administrator, bot.id)}` } });

    // `<`, `>` and `&` are escaped, as Rails escapes them, and emoji written as they are.
    expect(text).not.toMatch(/[<>&]/);
    expect(text).toContain("\\u003cdiv class=\\\"lexxy-content\\\"\\u003e");
    expect(text).toContain("Ship it \\u0026 tell me");
    expect(text).toContain("Shipped 🚀");
  });

  it("gives addresses on the host each request came to", async () => {
    const { bot, general } = await withBot();
    await postMany(bot.key, general, HISTORY_PAGE_SIZE + 1);
    const response = await apiWith({}, `https://chat.example.org${botPath(general, bot.key)}`);
    const [message] = (await response.json()) as ListedMessage[];
    expect(message!.url).toMatch(/^https:\/\/chat\.example\.org\/rooms\//);
    expect(message!.creator.avatar_url).toMatch(/^https:\/\/chat\.example\.org\/users\//);
    expect(response.headers.get("Link")).toMatch(/^<https:\/\/chat\.example\.org\/rooms\//);
  });

  it("answers HEAD with the same headers and no body, and 304 to a copy that's current", async () => {
    const { bot, general } = await withBot();
    await postMany(bot.key, general, HISTORY_PAGE_SIZE + 1);
    const got = await readAs(bot.key, general);
    const etag = got.headers.get("ETag")!;
    expect(etag).toMatch(/^W\/"[0-9a-f]{32}"$/);
    expect(got.headers.get("Cache-Control")).toBe("max-age=0, private, must-revalidate");

    const head = await readAs(bot.key, general, "", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    for (const name of ["Content-Type", "X-Total-Count", "Link", "ETag", "Cache-Control"]) expect([name, head.headers.get(name)]).toEqual([name, got.headers.get(name)]);

    const current = await readAs(bot.key, general, "", { headers: { "If-None-Match": etag } });
    expect([current.status, await current.text()]).toEqual([304, ""]);
    expect(current.headers.get("X-Total-Count")).toBe("41");
    expect(current.headers.get("Link")).toBe(got.headers.get("Link"));

    await posted(bot.key, general, "One more");
    expect((await readAs(bot.key, general, "", { headers: { "If-None-Match": etag } })).status).toBe(200);
  });

  it("counts a room's messages from an index, as it reads every one", async () => {
    const { bot, general } = await withBot();
    await posted(bot.key, general, "Hello!");
    const plan = (await roomSql(general, `EXPLAIN QUERY PLAN ${COUNT_MESSAGES}`, general)).map((row) => (row as { detail: string }).detail).join("; ");
    expect(plan).toMatch(/^SEARCH messages USING COVERING INDEX index_messages_on_room_id\w* \(room_id=\?\)$/);
  });
});

describe(feature("bots.log-redaction"), () => {
  it("filters bot keys out of addresses, as Campfire's log does, and leaves other addresses alone", () => {
    expect(withoutBotKeys("POST /rooms/0mgk3x2a9b4c5a/0mgk3x2a9b4c5e-Ab3xK9mQz1Rt/messages")).toBe("POST /rooms/0mgk3x2a9b4c5a/[FILTERED]/messages");
    expect(withoutBotKeys('Link: <https://ember.example/rooms/42/7-Zt9QmK1xz3Ab/messages?before=99>; rel="next"')).toBe(
      'Link: <https://ember.example/rooms/42/[FILTERED]/messages?before=99>; rel="next"',
    );
    const twice = withoutBotKeys("/rooms/1/5-Ab3xK9mQz1Rt/messages and /rooms/2/6-Cd4yL0nR2St7/messages.json");
    expect(twice).toBe("/rooms/1/[FILTERED]/messages and /rooms/2/[FILTERED]/messages.json");
    for (const path of ["/rooms/1", "/rooms/1/@5", "/api/rooms/1/socket", "/rooms/1/messages"]) expect(withoutBotKeys(path)).toBe(path);
  });

  it("logs a bot request that fails with its key filtered out, answering 500 JSON", async () => {
    const { bot, general } = await withBot();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { getByName: () => ({ botInRoom: () => Promise.reject(new Error("Workspace unavailable")) }) } as unknown as Env["WORKSPACE"];
    const response = await apiWith({ WORKSPACE: broken }, botPath(general, bot.key), { method: "POST", body: "Hello!" });
    expect([response.status, response.headers.get("Content-Type"), await response.text()]).toEqual([
      500,
      "application/json; charset=UTF-8",
      '{"status":500,"error":"Internal Server Error"}',
    ]);
    expect(errors).toHaveBeenCalledWith(`POST /rooms/${general}/[FILTERED]/messages failed:`, expect.any(Error));
    expect(JSON.stringify(errors.mock.calls)).not.toContain(tokenOf(bot));
  });
});
