import { feature } from "@ember/parity";
import { CUSTOM_DOMAIN_NOT_A_HOST, NOT_A_CUSTOM_DOMAIN, type Account, type BotAnswer, type BotSettings, type Bootstrap, type NewWorkspace, type RoomId, type WorkspaceSettings } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { NOT_THIS_ADDRESS } from "../src/custom-domain";
import { api, apiWith, connect, cookieOf, freshDeploy, openWorkspaceSocket, origin, post, shown, signIn, workspaceSql, type Session } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };

/** The address an administrator gives Ember in these tests, as the Cloudflare dashboard attached it to the Worker. */
const DOMAIN = "chat.example.com";

const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0";
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** A new workspace as pages show it, with the custom domain `customDomain`. */
const withDomain = (customDomain: string | null): Account => ({ name: "Ember", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain });

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

const as = (session?: Session | null): Record<string, string> => (session ? { Cookie: session.cookie } : {});

/** A request from the app's pages at `host`, as `api` sends one at ember.test. */
const at = (host: string, path: string, init: RequestInit<IncomingRequestCfProperties> = {}) => apiWith({}, `https://${host}${path}`, init);

/** What `PATCH /api/account` answers `session` for `body` from a page at `host`. */
const change = (session: Session | null, host: string, body: unknown) =>
  at(host, "/api/account", { method: "PATCH", headers: as(session), body: JSON.stringify(body) });

/** Makes `host` Ember's custom domain from a page there, as Use this address does, or none, as Stop using it does. */
async function use(session: Session, host: string, customDomain: string | null = host): Promise<void> {
  const response = await change(session, host, { customDomain });
  expect(response.status, await response.clone().text()).toBe(200);
}

const storedSettings = async () => JSON.parse(((await workspaceSql("SELECT settings FROM accounts")) as Array<{ settings: string }>)[0]!.settings) as Record<string, unknown>;

const storedUpdatedAt = async () => ((await workspaceSql("SELECT updated_at FROM accounts")) as Array<{ updated_at: string }>)[0]!.updated_at;

const bootstrap = async (session?: Session) => (await (await api("/api/bootstrap", { headers: as(session) })).json()) as Bootstrap;

/** Sets Ember up with a bot, which is in first run's general room. */
async function withBot() {
  const administrator = await setUp();
  const response = await api("/api/account/bots", { method: "POST", headers: as(administrator), body: JSON.stringify({ name: "Build Bot" }) });
  expect(response.status, await response.clone().text()).toBe(201);
  const bot: BotSettings = ((await response.json()) as BotAnswer).bot;
  const [{ id: general }] = (await workspaceSql("SELECT id FROM rooms WHERE name = 'general'")) as [{ id: RoomId }];
  return { administrator, bot, general };
}

/** Where the bot whose key is `bot.key` posts to and reads `room`. */
const messagesOf = (room: RoomId, bot: BotSettings) => `/rooms/${room}/${bot.key}/messages`;

/** As `curl -d` sends a body. */
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

/** A browser's subscription, with RFC 8291's example keys, at an endpoint of its own. */
const subscription = (endpoint: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${endpoint}`,
  p256dhKey: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  authKey: "BTBZMqHH6r4Tts7J_aSIgg",
});

/** Saves the subscription at `endpoint` for `session` at `host`, as turning notifications on there does, from a browser with `userAgent`, or none. */
async function save(session: Session, host: string, endpoint: string, userAgent: string | null = FIREFOX): Promise<void> {
  const response = await at(host, "/api/push-subscriptions", {
    method: "POST",
    headers: { ...as(session), ...(userAgent === null ? {} : { "User-Agent": userAgent }) },
    body: JSON.stringify(subscription(endpoint)),
  });
  expect(response.status, await response.clone().text()).toBe(204);
}

/** The endpoints of `session`'s person's subscriptions, oldest first, each with the host it was saved at. */
const subscriptionsOf = async (session: Session) =>
  ((await workspaceSql("SELECT endpoint, host FROM push_subscriptions WHERE user_id = ? ORDER BY id", session.user.id)) as Array<{ endpoint: string; host: string | null }>).map(
    ({ endpoint, host }) => [endpoint.slice("https://fcm.googleapis.com/fcm/send/".length), host],
  );

beforeEach(freshDeploy);

describe(feature("accounts.custom-domain"), () => {
  it("makes the address the page asking is open at Ember's, which every page then learns", async () => {
    const administrator = await setUp();
    const member = await signIn("Grace");

    const response = await change(administrator, DOMAIN, { customDomain: DOMAIN });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account: withDomain(DOMAIN) });
    expect((await storedSettings()).custom_domain).toBe(DOMAIN);

    // Pages at the old address, signed in or out, move there as they open.
    expect((await bootstrap()).account).toEqual(withDomain(DOMAIN));
    expect((await bootstrap(member)).account).toEqual(withDomain(DOMAIN));
    const settings = (await (await api("/api/account", { headers: as(member) })).json()) as WorkspaceSettings;
    expect(settings.account).toEqual(withDomain(DOMAIN));
  });

  it("starts with none, and takes a host with its port where it isn't the scheme's own", async () => {
    const administrator = await setUp();
    expect((await bootstrap()).account?.customDomain).toBeNull();
    await use(administrator, "chat.example.com:8443");
    expect((await bootstrap()).account?.customDomain).toBe("chat.example.com:8443");
    // A port is part of the address, so the host alone is another.
    expect(await (await change(administrator, "chat.example.com:8443", { customDomain: DOMAIN })).json()).toEqual({ error: NOT_THIS_ADDRESS });
  });

  it("refuses any address but the one the request came to, changing nothing", async () => {
    const administrator = await setUp();
    for (const [host, customDomain] of [
      ["ember.test", DOMAIN],
      [DOMAIN, "ember.test"],
      [DOMAIN, "www.example.com"],
    ]) {
      const response = await change(administrator, host!, { customDomain });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: NOT_THIS_ADDRESS });
    }
    // A name changed along with it isn't saved either.
    expect((await change(administrator, "ember.test", { name: "Ember Studio", customDomain: DOMAIN })).status).toBe(422);
    expect((await bootstrap()).account).toEqual(withDomain(null));
    expect((await storedSettings()).custom_domain).toBeUndefined();
  });

  it("refuses where a deploy or wrangler dev puts Ember, but not a name under localhost", async () => {
    const administrator = await setUp();
    for (const host of ["ember.kro.workers.dev", "workers.dev", "localhost:8787", "localhost", "127.0.0.1:8787"]) {
      const response = await change(administrator, host, { customDomain: host });
      expect([host, response.status]).toEqual([host, 422]);
      expect(await response.json()).toEqual({ error: NOT_A_CUSTOM_DOMAIN });
    }
    await use(administrator, "chat.localhost:8787");
    expect((await bootstrap()).account?.customDomain).toBe("chat.localhost:8787");
  });

  it("refuses anything but a host or null", async () => {
    const administrator = await setUp();
    for (const customDomain of [`https://${DOMAIN}`, `${DOMAIN}/`, "Chat.Example.com", "", " ", "chat..example.com", ".example.com", `${"a".repeat(260)}.com`, 42, true, {}, [DOMAIN]]) {
      const response = await change(administrator, DOMAIN, { customDomain });
      expect([customDomain, response.status]).toEqual([customDomain, 422]);
      expect(await response.json()).toEqual({ error: CUSTOM_DOMAIN_NOT_A_HOST });
    }
    expect((await bootstrap()).account?.customDomain).toBeNull();
  });

  it("lets only administrators change it, telling anyone else so before checking what they sent", async () => {
    await setUp();
    const member = await signIn("Grace");
    for (const customDomain of [DOMAIN, "ember.test", 42]) {
      const response = await change(member, DOMAIN, { customDomain });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Only administrators can change the workspace" });
    }
    expect((await change(null, DOMAIN, { customDomain: DOMAIN })).status).toBe(401);
    expect((await bootstrap()).account?.customDomain).toBeNull();
  });

  it("stops using it from any address, leaving the other settings as they are", async () => {
    const administrator = await setUp();
    expect((await api("/api/account", { method: "PATCH", headers: as(administrator), body: JSON.stringify({ settings: { hideTranslationButtons: false } }) })).status).toBe(200);
    await use(administrator, DOMAIN);

    const response = await change(administrator, "ember.kro.workers.dev", { customDomain: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account: { ...withDomain(null), hideTranslationButtons: false } });
    expect(await storedSettings()).toEqual({ restrict_room_creation_to_administrators: false, hide_translation_buttons: false, custom_domain: null });

    // And uses another once more.
    await use(administrator, "ember.example.org");
    expect((await bootstrap()).account?.customDomain).toBe("ember.example.org");
  });

  it("tells every open tab, but only when it changes", async () => {
    const administrator = await setUp();
    const member = await signIn("Grace");
    const sockets = [await openWorkspaceSocket(administrator), await openWorkspaceSocket(member)];
    const long = "2026-01-01T00:00:00.000Z";
    await workspaceSql("UPDATE accounts SET updated_at = ?", long);

    await use(administrator, DOMAIN);
    for (const socket of sockets) expect(await socket.next()).toEqual({ type: "account.updated", account: withDomain(DOMAIN) });
    const usedAt = await storedUpdatedAt();
    expect(usedAt).not.toBe(long);

    // Saved again unchanged, nothing's written or said.
    await use(administrator, DOMAIN);
    expect(await storedUpdatedAt()).toBe(usedAt);
    for (const socket of sockets) expect(await socket.answers()).toBe(true);

    await use(administrator, DOMAIN, null);
    for (const socket of sockets) expect(await socket.next()).toEqual({ type: "account.updated", account: withDomain(null) });
  });

  it("names it in the bot API's links, at whichever address the bot asks", async () => {
    const { administrator, bot, general } = await withBot();
    await use(administrator, DOMAIN);
    const room = await connect(general, administrator);
    const adas = await post(room, "Ship it?");

    for (const host of ["ember.test", DOMAIN]) {
      const posted = await at(host, messagesOf(general, bot), { method: "POST", body: "Shipped", headers: FORM });
      expect(posted.status).toBe(201);
      expect(posted.headers.get("Location")).toMatch(new RegExp(`^https://chat\\.example\\.com/rooms/${general}/@`));

      const boosted = await at(host, `${messagesOf(general, bot)}/${adas.id}/boosts`, { method: "POST", body: "👀", headers: FORM });
      expect(boosted.status).toBe(201);
      const boost = (await boosted.json()) as { booster: { avatar_url: string }; message: { url: string } };
      expect(boost.message.url).toBe(`https://${DOMAIN}/rooms/${general}/@${adas.id}`);
      expect(boost.booster.avatar_url).toMatch(/^https:\/\/chat\.example\.com\/users\//);
    }

    const shipped = (await at("ember.test", messagesOf(general, bot), { method: "POST", body: "Again", headers: FORM })).headers.get("Location")!.split("/@")[1]!;
    const edited = await at("ember.test", `${messagesOf(general, bot)}/${shipped}`, { method: "PATCH", body: "Edited", headers: FORM });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { url: string }).url).toBe(`https://${DOMAIN}/rooms/${general}/@${shipped}`);

    for (let i = 0; i < 40; i++) expect((await at("ember.test", messagesOf(general, bot), { method: "POST", body: `Build ${i}`, headers: FORM })).status).toBe(201);
    const listed = await at("ember.test", messagesOf(general, bot));
    const [message] = (await listed.json()) as Array<{ url: string; creator: { avatar_url: string } }>;
    expect(message!.url).toMatch(/^https:\/\/chat\.example\.com\/rooms\//);
    expect(message!.creator.avatar_url).toMatch(/^https:\/\/chat\.example\.com\/users\//);
    expect(listed.headers.get("Link")).toMatch(new RegExp(`^<https://chat\\.example\\.com/rooms/${general}/${bot.key}/messages\\?before=`));
  });

  it("names the address each request came to again once Ember stops using it", async () => {
    const { administrator, bot, general } = await withBot();
    await use(administrator, DOMAIN);
    await use(administrator, DOMAIN, null);
    const posted = await at("ember.example.org", messagesOf(general, bot), { method: "POST", body: "Shipped", headers: { "Content-Type": "text/plain" } });
    expect(posted.headers.get("Location")).toMatch(new RegExp(`^https://ember\\.example\\.org/rooms/${general}/@`));
    expect((await api(messagesOf(general, bot), { method: "POST", body: "Shipped" })).headers.get("Location")).toMatch(new RegExp(`^${origin}/rooms/`));
  });

  it("replaces a browser's subscription at the old address with the one it saves at the custom domain", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace");
    await save(grace, "ember.test", "firefox-before");
    await save(grace, "ember.test", "safari-before", SAFARI);
    await save(administrator, "ember.test", "adas-firefox");
    await use(administrator, DOMAIN);

    await save(grace, DOMAIN, "firefox-after");
    // Her phone's, and Ada's in the same browser, stay until they turn notifications on there.
    expect(await subscriptionsOf(grace)).toEqual([
      ["safari-before", "ember.test"],
      ["firefox-after", DOMAIN],
    ]);
    expect(await subscriptionsOf(administrator)).toEqual([["adas-firefox", "ember.test"]]);
  });

  it("replaces none saved anywhere but the custom domain, or from a browser that sends no user agent", async () => {
    const administrator = await setUp();
    await save(administrator, "ember.test", "before");
    await save(administrator, "ember.test", "no-agent-before", null);
    await use(administrator, DOMAIN);

    await save(administrator, "ember.test", "old-address-again");
    await save(administrator, "ember.example.org", "elsewhere");
    await save(administrator, DOMAIN, "no-agent-after", null);
    expect(await subscriptionsOf(administrator)).toEqual([
      ["before", "ember.test"],
      ["no-agent-before", "ember.test"],
      ["old-address-again", "ember.test"],
      ["elsewhere", "ember.example.org"],
      ["no-agent-after", DOMAIN],
    ]);
    await save(administrator, DOMAIN, "after");
    expect(await subscriptionsOf(administrator)).toEqual([
      ["no-agent-before", "ember.test"],
      ["no-agent-after", DOMAIN],
      ["after", DOMAIN],
    ]);
  });

  it("counts a subscription saved before hosts were recorded as saved at another address", async () => {
    const administrator = await setUp();
    await save(administrator, "ember.test", "before");
    await workspaceSql("UPDATE push_subscriptions SET host = NULL");
    await use(administrator, DOMAIN);
    expect(await subscriptionsOf(administrator)).toEqual([["before", null]]);
    await save(administrator, DOMAIN, "after");
    expect(await subscriptionsOf(administrator)).toEqual([["after", DOMAIN]]);
  });
});
