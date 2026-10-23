import { feature } from "@ember/parity";
import { CUSTOM_DOMAIN_NOT_A_HOST, NOT_A_CUSTOM_DOMAIN, type Account, type BotAnswer, type BotSettings, type Bootstrap, type NewWorkspace, type RoomId, type WorkspaceSettings } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { NOT_THIS_ADDRESS } from "../src/custom-domain";
import { api, apiWith, connect, cookieOf, freshDeploy, openWorkspaceSocket, origin, post, shown, signIn, workspaceSql, type Session } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };

/** The address an administrator gives Ember in these tests, as the Cloudflare dashboard attached it to the Worker. */
const DOMAIN = "chat.example.com";

/** Every Mac's user agent on the same Chrome, whose reduced user agent says no more. */
const CHROME_ON_A_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

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

/** The P-256 key of the browser subscribed at `endpoint`, each browser's its own. */
const keyOf = (endpoint: string) => `BP-${endpoint}`;

/**
 * What `session` saves at `host` to subscribe the browser at `endpoint`, as turning notifications on
 * there does, replacing the subscription `body.replacing` names.
 */
const save = (session: Session | null, host: string, endpoint: string, body: Record<string, unknown> = {}) =>
  at(host, "/api/push-subscriptions", {
    method: "POST",
    headers: { ...as(session), "User-Agent": CHROME_ON_A_MAC },
    body: JSON.stringify({ endpoint: `https://fcm.googleapis.com/fcm/send/${endpoint}`, p256dhKey: keyOf(endpoint), authKey: "BTBZMqHH6r4Tts7J_aSIgg", ...body }),
  });

/** Saves the browser at `endpoint` for `session` at `host`, replacing `session`'s subscription at `replacing`, if given. */
async function subscribe(session: Session, host: string, endpoint: string, replacing?: string): Promise<void> {
  const response = await save(session, host, endpoint, replacing === undefined ? {} : { replacing: keyOf(replacing) });
  expect(response.status, await response.clone().text()).toBe(204);
}

/** The endpoints of `session`'s person's subscriptions, oldest first. */
const subscriptionsOf = async (session: Session) =>
  ((await workspaceSql("SELECT endpoint FROM push_subscriptions WHERE user_id = ? ORDER BY id", session.user.id)) as Array<{ endpoint: string }>).map(({ endpoint }) =>
    endpoint.slice("https://fcm.googleapis.com/fcm/send/".length),
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

  it("replaces the subscription a browser had at the address its page moved from with the one it saves there, and no other", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace");
    await subscribe(grace, "ember.test", "work-mac");
    await subscribe(grace, "ember.test", "home-mac");
    await subscribe(administrator, "ember.test", "adas-mac");
    await use(administrator, DOMAIN);

    await subscribe(grace, DOMAIN, "work-mac-there", "work-mac");
    // Her other Mac's stays, though its user agent is the same, until it moves too, and so does Ada's.
    expect(await subscriptionsOf(grace)).toEqual(["home-mac", "work-mac-there"]);
    expect(await subscriptionsOf(administrator)).toEqual(["adas-mac"]);
    await subscribe(grace, DOMAIN, "home-mac-there", "home-mac");
    expect(await subscriptionsOf(grace)).toEqual(["work-mac-there", "home-mac-there"]);

    // Saved again with the key it named, as the app saves a browser's as it opens, it stays.
    await subscribe(grace, DOMAIN, "home-mac-there", "home-mac-there");
    expect(await subscriptionsOf(grace)).toEqual(["work-mac-there", "home-mac-there"]);
  });

  it("replaces only a subscription of the person saving, and ignores a key that names none or can't be one", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace");
    await subscribe(administrator, "ember.test", "adas-mac");
    await use(administrator, DOMAIN);

    await subscribe(grace, DOMAIN, "graces-mac", "adas-mac");
    await subscribe(grace, DOMAIN, "graces-phone", "nobodys");
    for (const replacing of ["", 42, null, ["adas-mac"], "K".repeat(257)]) {
      expect((await save(grace, DOMAIN, "graces-mac", { replacing })).status).toBe(204);
    }
    expect(await subscriptionsOf(administrator)).toEqual(["adas-mac"]);
    expect(await subscriptionsOf(grace)).toEqual(["graces-mac", "graces-phone"]);

    // Nor anything signed out.
    expect((await save(null, DOMAIN, "graces-tablet", { replacing: keyOf("graces-mac") })).status).toBe(401);
    expect(await subscriptionsOf(grace)).toEqual(["graces-mac", "graces-phone"]);
  });
});
