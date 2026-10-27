import { feature } from "@ember/parity";
import {
  CUSTOM_DOMAIN_NOT_A_HOST,
  NOT_A_CUSTOM_DOMAIN,
  type Account,
  type BotAnswer,
  type CustomDomainCheck,
  type BotSettings,
  type Bootstrap,
  type EmberAddresses,
  type NewWorkspace,
  type RoomId,
  type WorkspaceSettings,
} from "@ember/protocol";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cantGoBackTo, NOT_THIS_ADDRESS, PROBE_ANSWER_HEADER } from "../src/custom-domain";
import type { Env } from "../src/env";
import { workspace } from "../src/workspace";
import { api, apiWith, connect, cookieOf, freshDeploy, openWorkspaceSocket, origin, post, shown, signIn, workspaceSql, type Session } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };

/** The address an administrator gives Ember in these tests, as the Cloudflare dashboard attached it to the Worker. */
const DOMAIN = "chat.example.com";

/** Where a deploy puts Ember in these tests: the Worker named ember's workers.dev address. */
const DEPLOYED = "ember.kro.workers.dev";

/** Every Mac's user agent on the same Chrome, whose reduced user agent says no more. */
const CHROME_ON_A_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** A new workspace as pages show it, with the custom domain `customDomain`. */
const withDomain = (customDomain: string | null): Account => ({ name: "Ember", tagline: "", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain, joinLink: true, openSignUp: false, memberfulJoin: false, memberfulSignIn: false, emailDomainSignUp: false, emailDomains: [], navigationIcons: {} });

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

/** Opens a page at `host` as `session`, which asks what the app asks first there. */
async function open(host: string, session?: Session): Promise<Bootstrap> {
  const response = await at(host, "/api/bootstrap", { headers: as(session) });
  expect(response.status).toBe(200);
  return (await response.json()) as Bootstrap;
}

/** The addresses besides its own that Ember tells `session` of in workspace settings. */
const addressesFor = async (session: Session) => ((await (await api("/api/account", { headers: as(session) })).json()) as WorkspaceSettings).addresses;

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

  it("takes where a deploy or wrangler dev puts Ember from a page there, as Go back does, and a name under localhost", async () => {
    const administrator = await setUp();
    for (const host of [DEPLOYED, "workers.dev", "localhost:8787", "localhost", "127.0.0.1:8787", "chat.localhost:8787"]) {
      await use(administrator, host);
      expect([host, (await bootstrap()).account?.customDomain]).toEqual([host, host]);
    }
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

    const response = await change(administrator, DEPLOYED, { customDomain: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account: { ...withDomain(null), hideTranslationButtons: false } });
    // The domain it stops using reaches it still, until it's removed in Cloudflare.
    expect(await storedSettings()).toEqual({ restrict_room_creation_to_administrators: false, hide_translation_buttons: false, custom_domain: null, other_addresses: [DOMAIN] });

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

/** What `session` hears checking `domain`, as Check DNS in Workspace settings at ember.test asks. */
const check = (session: Session | null, domain: unknown) =>
  api("/api/account/custom_domain_checks", { method: "POST", headers: as(session), body: JSON.stringify({ domain }) });

/** What checking `domain` as `session` finds there. */
async function reachOf(session: Session, domain: string): Promise<unknown> {
  const response = await check(session, domain);
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as CustomDomainCheck).reaches;
}

/** A request this Worker sent the Internet. */
interface Sent {
  url: string;
  init: RequestInit | undefined;
}

/** Stands in for the Internet, where whatever `answer` says answers each request this Worker sends, which it keeps. */
function internet(answer: { with: (request: Request) => Promise<Response> }): Sent[] {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    sent.push({ url: request.url, init });
    return answer.with(request);
  });
  return sent;
}

/** Matches the address of a probe the Worker sends to `origin`. */
const probeAt = (origin: string) => new RegExp(`^${origin.replace(/\./g, "\\.")}/api/custom_domain_probes/[\\w-]{32}$`);

describe(feature("accounts.custom-domain"), () => {
  afterEach(() => vi.restoreAllMocks());

  it("checks that a domain reaches this Ember by asking it for a probe only this Ember waits for, once", async () => {
    const administrator = await setUp();
    // As Cloudflare sends the domain to this Worker, once its dashboard has added it.
    const sent = internet({ with: (request) => exports.default.fetch(request) });
    expect(await reachOf(administrator, DOMAIN)).toBe("ember");
    expect(sent).toHaveLength(1);
    const [{ url, init }] = sent as [Sent];
    expect(url).toMatch(probeAt(`https://${DOMAIN}`));
    // It sends nothing but the probe, follows no redirect, and waits only so long.
    expect(init).toEqual({ redirect: "manual", signal: expect.any(AbortSignal) });
    expect((await exports.default.fetch(url)).status).toBe(404);

    // By the scheme the check came by, and with the domain's port.
    expect(await reachOf(administrator, "chat.example.com:8443")).toBe("ember");
    expect(sent[1]!.url).toMatch(probeAt("https://chat.example.com:8443"));
  });

  it("says something else answers there when a site does, but not as this Ember", async () => {
    const administrator = await setUp();
    const answer = { with: async (_: Request) => new Response() };
    internet(answer);
    for (const [what, response] of [
      ["a parked page", () => new Response("<html>Parked</html>", { headers: { "Content-Type": "text/html" } })],
      ["a site that answers anything", () => new Response(null, { status: 204 })],
      // Another Ember's Workspace waits for no such probe, as another Worker's wouldn't.
      ["another Ember", () => Response.json({ error: "Not found" }, { status: 404 })],
      ["a guess at the answer", () => new Response(null, { status: 204, headers: { [PROBE_ANSWER_HEADER]: "a guess" } })],
      ["a redirect, which isn't followed", () => Response.redirect(`https://${DOMAIN}/elsewhere`, 302)],
      ["a failing site", () => new Response(null, { status: 500 })],
    ] as const) {
      answer.with = async () => response();
      expect([what, await reachOf(administrator, DOMAIN)]).toEqual([what, "elsewhere"]);
    }
  });

  it("says nothing answers there yet when nothing does, or only Cloudflare for an origin it can't reach", async () => {
    const administrator = await setUp();
    const answer = { with: async (_: Request) => new Response() };
    internet(answer);
    for (const [what, response] of [
      ["no address", () => Promise.reject(new TypeError("Network connection lost."))],
      ["no answer in time", () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"))],
      ["a domain DNS doesn't know, as Cloudflare's error 1016", () => Promise.resolve(new Response("error code: 1016", { status: 530 }))],
      ["an origin that's down", () => Promise.resolve(new Response(null, { status: 521 }))],
      ["a certificate that isn't ready", () => Promise.resolve(new Response(null, { status: 525 }))],
    ] as const) {
      answer.with = response;
      expect([what, await reachOf(administrator, DOMAIN)]).toEqual([what, "nothing"]);
    }
  });

  it("finds what answers there by the answer's head, even when the rest of it fails", async () => {
    const administrator = await setUp();
    // A body that fails, as when the connection drops after the head.
    const failing = () => new ReadableStream({ start: (controller) => controller.error(new TypeError("Network connection lost.")) });
    const answer = { with: async (request: Request) => new Response(failing(), { headers: (await exports.default.fetch(request)).headers }) };
    internet(answer);
    expect(await reachOf(administrator, DOMAIN)).toBe("ember");
    answer.with = async () => new Response(failing(), { headers: { "Content-Type": "text/html" } });
    expect(await reachOf(administrator, DOMAIN)).toBe("elsewhere");
  });

  it("lets only administrators check, telling anyone else so before checking what they sent", async () => {
    await setUp();
    const member = await signIn("Grace");
    const sent = internet({ with: (request) => exports.default.fetch(request) });
    for (const domain of [DOMAIN, "ember.kro.workers.dev", 42]) {
      const response = await check(member, domain);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Only administrators can change the workspace" });
    }
    expect((await check(null, DOMAIN)).status).toBe(401);
    expect(sent).toEqual([]);
  });

  it("refuses a domain that can't be Ember's, sending nothing", async () => {
    const administrator = await setUp();
    const sent = internet({ with: (request) => exports.default.fetch(request) });
    for (const [domain, error] of [
      ["ember.kro.workers.dev", NOT_A_CUSTOM_DOMAIN],
      ["localhost:8787", NOT_A_CUSTOM_DOMAIN],
      [`https://${DOMAIN}`, CUSTOM_DOMAIN_NOT_A_HOST],
      [`${DOMAIN}/api/health`, CUSTOM_DOMAIN_NOT_A_HOST],
      [`${DOMAIN}:99999`, CUSTOM_DOMAIN_NOT_A_HOST],
      [42, CUSTOM_DOMAIN_NOT_A_HOST],
    ] as const) {
      const response = await check(administrator, domain);
      expect([domain, response.status]).toEqual([domain, 422]);
      expect(await response.json()).toEqual({ error });
    }
    expect(sent).toEqual([]);
  });

  it("answers a probe only while a check waits for it, and only for the latest few checks", async () => {
    const probe = (n: number) => `${String(n).padStart(2, "0")}${"p".repeat(30)}`;
    const answerTo = async (n: number) => (await exports.default.fetch(`https://${DOMAIN}/api/custom_domain_probes/${probe(n)}`)).headers.get(PROBE_ANSWER_HEADER);
    expect(await answerTo(1)).toBeNull();
    const waiting = workspace(env as unknown as Env);
    for (let n = 1; n <= 21; n++) await waiting.expectProbe(probe(n), `answer ${n}`);
    expect(await answerTo(1)).toBeNull();
    expect(await answerTo(2)).toBe("answer 2");
    expect(await answerTo(21)).toBe("answer 21");
    expect(await answerTo(21)).toBeNull();
    // Only GET asks.
    await waiting.expectProbe(probe(3), "answer 3");
    expect((await exports.default.fetch(`https://${DOMAIN}/api/custom_domain_probes/${probe(3)}`, { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } })).status).toBe(404);
    expect(await answerTo(3)).toBe("answer 3");
  });
});

describe(feature("accounts.custom-domain"), () => {
  afterEach(() => vi.restoreAllMocks());

  /** Ember as a deploy left it, opened at its workers.dev address, with Ada as its administrator, signed in. */
  async function deployed(): Promise<Session> {
    const administrator = await setUp();
    await open(DEPLOYED);
    return administrator;
  }

  it("remembers where a deploy puts Ember from the pages opened there, which only administrators hear of", async () => {
    const administrator = await setUp();
    const member = await signIn("Grace");
    const sockets = [await openWorkspaceSocket(administrator), await openWorkspaceSocket(member)];
    const long = "2026-01-01T00:00:00.000Z";
    await workspaceSql("UPDATE accounts SET updated_at = ?", long);
    // Not from a page anywhere else.
    await open(DOMAIN);
    await bootstrap();
    expect(await addressesFor(administrator)).toEqual({ deployed: null, others: [] } satisfies EmberAddresses);

    await open(DEPLOYED, member);
    expect((await storedSettings()).deployed_address).toBe(DEPLOYED);
    expect(await addressesFor(administrator)).toEqual({ deployed: DEPLOYED, others: [] } satisfies EmberAddresses);
    expect(await addressesFor(member)).toEqual({ deployed: null, others: [] } satisfies EmberAddresses);
    // It's no change to the account, which pages show as they were.
    expect(await storedUpdatedAt()).toBe(long);
    for (const socket of sockets) expect(await socket.answers()).toBe(true);
    expect((await open(DEPLOYED)).account).toEqual(withDomain(null));

    // Wherever the Worker's workers.dev address moves, as when it's renamed, or wrangler dev's.
    await open("ember-studio.kro.workers.dev");
    expect((await addressesFor(administrator)).deployed).toBe("ember-studio.kro.workers.dev");
    await open("localhost:8787");
    expect((await addressesFor(administrator)).deployed).toBe("localhost:8787");
  });

  it("remembers nothing before first run", async () => {
    expect((await open(DEPLOYED)).setup).toBe("pending");
    const administrator = await setUp();
    expect(await addressesFor(administrator)).toEqual({ deployed: null, others: [] } satisfies EmberAddresses);
  });

  it("goes back to where a deploy puts Ember from any address, once a check finds it reaches Ember there", async () => {
    const administrator = await deployed();
    await use(administrator, DOMAIN);
    // As Cloudflare sends the workers.dev address to this Worker.
    const sent = internet({ with: (request) => exports.default.fetch(request) });

    const response = await change(administrator, DOMAIN, { customDomain: DEPLOYED });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ account: withDomain(DEPLOYED) });
    expect(sent.map(({ url }) => url)).toEqual([expect.stringMatching(probeAt(`https://${DEPLOYED}`))]);
    // Pages at the domain it left move there, and the domain is remembered, as it reaches Ember until it's removed in Cloudflare.
    expect((await open(DOMAIN)).account?.customDomain).toBe(DEPLOYED);
    expect(await addressesFor(administrator)).toEqual({ deployed: DEPLOYED, others: [DOMAIN] } satisfies EmberAddresses);
    expect(await storedSettings()).toMatchObject({ custom_domain: DEPLOYED, deployed_address: DEPLOYED, other_addresses: [DOMAIN] });
  });

  it("goes back from the address a deploy puts Ember at without a check, as the request came there", async () => {
    const administrator = await deployed();
    await use(administrator, DOMAIN);
    const sent = internet({ with: (request) => exports.default.fetch(request) });
    await use(administrator, DEPLOYED);
    expect(sent).toEqual([]);
    expect(await addressesFor(administrator)).toEqual({ deployed: DEPLOYED, others: [DOMAIN] } satisfies EmberAddresses);
  });

  it("won't go back while Ember doesn't answer where a deploy put it, changing nothing", async () => {
    const administrator = await deployed();
    await use(administrator, DOMAIN);
    const answer = { with: async (_: Request) => new Response() };
    internet(answer);
    for (const [what, response] of [
      ["its workers.dev address turned off, as Cloudflare's error 1042", () => Promise.resolve(new Response("error code: 1042", { status: 404 }))],
      ["no answer in time", () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"))],
    ] as const) {
      answer.with = response;
      const refused = await change(administrator, DOMAIN, { customDomain: DEPLOYED, name: "Ember Studio" });
      expect([what, refused.status]).toEqual([what, 422]);
      expect(await refused.json()).toEqual({ error: cantGoBackTo(DEPLOYED) });
    }
    expect((await bootstrap()).account).toEqual(withDomain(DOMAIN));
    expect(await addressesFor(administrator)).toEqual({ deployed: DEPLOYED, others: [] } satisfies EmberAddresses);
  });

  it("goes back nowhere but where a deploy put Ember, sending nothing for anywhere else", async () => {
    const administrator = await setUp();
    await use(administrator, DOMAIN);
    const sent = internet({ with: (request) => exports.default.fetch(request) });
    // Before a page there has told Ember where it is.
    expect(await (await change(administrator, DOMAIN, { customDomain: DEPLOYED })).json()).toEqual({ error: NOT_THIS_ADDRESS });
    await open(DEPLOYED);
    for (const customDomain of ["ember-studio.kro.workers.dev", "localhost:8787", "team.example.com"]) {
      expect(await (await change(administrator, DOMAIN, { customDomain })).json()).toEqual({ error: NOT_THIS_ADDRESS });
    }
    expect(sent).toEqual([]);
    expect((await bootstrap()).account?.customDomain).toBe(DOMAIN);
  });

  it("lets only administrators go back, telling anyone else so before checking anything", async () => {
    const administrator = await deployed();
    await use(administrator, DOMAIN);
    const member = await signIn("Grace");
    const sent = internet({ with: (request) => exports.default.fetch(request) });
    const response = await change(member, DOMAIN, { customDomain: DEPLOYED });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Only administrators can change the workspace" });
    expect((await change(null, DOMAIN, { customDomain: DEPLOYED })).status).toBe(401);
    expect(sent).toEqual([]);
  });

  it("remembers the custom domains it moves away from, and where each move was asked, newest first", async () => {
    const administrator = await deployed();
    await use(administrator, DOMAIN);
    await use(administrator, "team.example.com");
    expect(await addressesFor(administrator)).toEqual({ deployed: DEPLOYED, others: [DOMAIN] } satisfies EmberAddresses);
    // Gone back from a domain it left before, which reaches it too.
    internet({ with: (request) => exports.default.fetch(request) });
    expect((await change(administrator, "old.example.com", { customDomain: DEPLOYED })).status).toBe(200);
    expect((await addressesFor(administrator)).others).toEqual(["team.example.com", "old.example.com", DOMAIN]);
    // A domain it moves to again is its own once more.
    await use(administrator, DOMAIN);
    expect((await addressesFor(administrator)).others).toEqual(["team.example.com", "old.example.com"]);
  });

  it("forgets a domain it moved away from once a check finds it no longer reaches Ember, and no other", async () => {
    const administrator = await deployed();
    await use(administrator, DOMAIN);
    await use(administrator, "team.example.com");
    await use(administrator, DEPLOYED);
    expect((await addressesFor(administrator)).others).toEqual(["team.example.com", DOMAIN]);
    const updatedAt = await storedUpdatedAt();
    const answer = { with: (request: Request) => exports.default.fetch(request) };
    internet(answer);

    expect(await reachOf(administrator, DOMAIN)).toBe("ember");
    expect((await addressesFor(administrator)).others).toEqual(["team.example.com", DOMAIN]);
    // Removed from the Worker in Cloudflare.
    answer.with = async () => new Response("error code: 1016", { status: 530 });
    expect(await reachOf(administrator, DOMAIN)).toBe("nothing");
    expect(await reachOf(administrator, "www.example.com")).toBe("nothing");
    expect((await addressesFor(administrator)).others).toEqual(["team.example.com"]);
    // Something else answers there now.
    answer.with = async () => new Response("<html>Parked</html>", { headers: { "Content-Type": "text/html" } });
    expect(await reachOf(administrator, "team.example.com")).toBe("elsewhere");
    expect(await addressesFor(administrator)).toEqual({ deployed: DEPLOYED, others: [] } satisfies EmberAddresses);
    expect(await storedUpdatedAt()).toBe(updatedAt);
  });
});
