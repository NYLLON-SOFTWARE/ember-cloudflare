import { feature } from "@ember/parity";
import type { Bootstrap } from "@ember/protocol";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import refusedPage from "../../web/public/422.html";
import type { Env } from "../src/env";
import worker from "../src/index";
import { lockedPage } from "../src/setup-locked";
import { apiWith, builtPages, cookieOf, freshDeploy, origin, workspaceSql } from "./support";

const TOKEN = "0123456789abcdef".repeat(4);
const locked: Partial<Env> = { EMBER_SETUP_TOKEN: TOKEN, ASSETS: builtPages };

const FORGET_COOKIE = "__Host-ember_setup=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict";

/** A request to a deployment whose setup takes the private link. */
const request = (path: string, init: RequestInit<IncomingRequestCfProperties> = {}, changes: Partial<Env> = {}) => apiWith({ ...locked, ...changes }, path, { redirect: "manual", ...init });

/** The access page's post, as its script sends it. */
const exchange = (body: string, headers: Record<string, string> = {}, path = "/first_run/access") =>
  request(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Origin: origin, "Sec-Fetch-Site": "same-origin", ...headers }, body });

/** The cookie the private link gives this browser. */
async function unlock(): Promise<string> {
  const response = await exchange(`token=${TOKEN}`);
  expect(response.status).toBe(204);
  return cookieOf(response);
}

const setUp = (cookie?: string, changes: Partial<Env> = {}) =>
  request("/api/first_run", { method: "POST", headers: cookie ? { Cookie: cookie } : {}, body: JSON.stringify({ name: "Ada", emailAddress: "ada@example.com", password: "12345678" }) }, changes);

const accounts = async () => ((await workspaceSql("SELECT count(*) AS n FROM accounts")) as Array<{ n: number }>)[0]!.n;

function expectPrivate(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}

async function expectLocked(response: Response) {
  expect(response.status).toBe(403);
  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  expect(await response.text()).toBe(lockedPage(origin));
  expectPrivate(response);
}

beforeEach(freshDeploy);
afterEach(() => vi.useRealTimers());

describe(feature("auth.protected-setup"), () => {
  it("locks setup until this browser has opened the private link", async () => {
    await expectLocked(await request("/first_run"));
    expect((await (await request("/api/bootstrap")).json()) as Bootstrap).toMatchObject({ setup: "pending", setupProtected: true });

    const post = await setUp();
    expect(post.status).toBe(403);
    expect(await post.json()).toEqual({ error: "Setup is locked" });
    expect(await accounts()).toBe(0);
  });

  it("says on the locked page why setup is locked and how to unlock it, with this deployment's link", async () => {
    const page = await (await request("/first_run")).text();
    expect(page).toContain('<h1 id="title">Setup is locked</h1>');
    expect(page).toContain("Whoever sets up Ember becomes its administrator, so setup only opens from this deployment's private link.");
    expect(page).toContain("<strong>Have the link?</strong> Open it in this browser. It unlocks setup here for a day.");
    expect(page).toContain(`followed by the setup token, the Worker's <code>EMBER_SETUP_TOKEN</code> secret:<pre>${origin}/<wbr>first_run/<wbr>access#token=</pre>`);
    expect(page).toContain("make a new one and save it as that secret, then open the link with it.<pre>openssl rand -hex 32\nwrangler secret put EMBER_SETUP_TOKEN</pre>");
  });

  it("serves the access page over HTTPS alone, with a policy that allows only its script and post", async () => {
    const page = await request("/first_run/access");
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("page /first_run/access");
    expect(page.headers.get("Content-Security-Policy")).toBe("default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    expect(page.headers.get("X-Frame-Options")).toBe("DENY");
    expectPrivate(page);

    expect((await request("/first_run/access?token=x")).status).toBe(400);
    expect((await request("http://localhost:8787/first_run/access")).status).toBe(403);
    const unprotected = await request("/first_run/access", {}, { EMBER_SETUP_TOKEN: undefined });
    expect(unprotected.status).toBe(404);
    expectPrivate(unprotected);
  });

  it("trades the token for a day-long cookie that unlocks the form until setup is done", async () => {
    const response = await exchange(`token=${TOKEN}`);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expectPrivate(response);
    const [setCookie] = response.headers.getSetCookie();
    expect(setCookie).toMatch(/^__Host-ember_setup=[\w-]+; Max-Age=86400; Path=\/; Secure; HttpOnly; SameSite=Strict$/);
    expect(setCookie).not.toContain(TOKEN);
    const cookie = cookieOf(response);

    const form = await request("/first_run", { headers: { Cookie: cookie } });
    expect(form.status).toBe(200);
    expect(await form.text()).toBe("page /");
    // As ember-rust's form does, whose native post would say it comes from `Origin: null` under no-referrer.
    expect(form.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(form.headers.get("Cache-Control")).toBe("no-store");

    const created = await setUp(cookie);
    expect(created.status).toBe(201);
    expect(created.headers.getSetCookie()).toEqual([expect.stringMatching(/^__Host-session_token=/), FORGET_COOKIE]);

    for (const path of ["/first_run", "/first_run/access"]) {
      const home = await request(path, { headers: { Cookie: cookie } });
      expect(home.status, path).toBe(302);
      expect(home.headers.get("Location"), path).toBe(`${origin}/`);
      expect(home.headers.get("Set-Cookie"), path).toBe(FORGET_COOKIE);
      expectPrivate(home);
    }
    expect((await exchange(`token=${TOKEN}`)).status).toBe(302);
  });

  it.each([
    ["a wrong token", `token=${"f".repeat(64)}`, {}, 403],
    ["an empty token", "token=", {}, 403],
    ["the token in uppercase", `token=${TOKEN.toUpperCase()}`, {}, 403],
    ["the token as a list", `token[]=${TOKEN}`, {}, 403],
    ["the token twice", `token=${TOKEN}&token=${TOKEN}`, {}, 403],
    ["JSON", JSON.stringify({ token: TOKEN }), { "Content-Type": "application/json" }, 415],
    ["no content type", `token=${TOKEN}`, { "Content-Type": "" }, 415],
    ["a same-site post", `token=${TOKEN}`, { "Sec-Fetch-Site": "same-site" }, 422],
    ["a cross-site post", `token=${TOKEN}`, { "Sec-Fetch-Site": "cross-site" }, 422],
    ["Origin: null", `token=${TOKEN}`, { Origin: "null" }, 422],
    ["another origin", `token=${TOKEN}`, { Origin: "https://evil.test" }, 422],
  ])("refuses %s", async (_, body, headers, status) => {
    const response = await exchange(body, headers);
    expect(response.status).toBe(status);
    // As in ember-rust, a post refused as cross-site gets Campfire's 422 page, and the others nothing.
    expect(await response.text()).toBe(status === 422 ? refusedPage : "");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expectPrivate(response);
  });

  it("takes the token only from a post's body, over HTTPS, from the access page's own fetch", async () => {
    expect((await exchange(`token=${TOKEN}`, {}, `/first_run/access?token=${TOKEN}`)).status).toBe(400);
    expect((await exchange(`token=${TOKEN}`, { Origin: "http://localhost:8787" }, "http://localhost:8787/first_run/access")).status).toBe(403);
    // A fetch always says where it comes from; a request that doesn't isn't the access page's.
    const withoutFetchMetadata = await worker.fetch(
      new Request(`${origin}/first_run/access`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin }, body: `token=${TOKEN}` }),
      { ...(env as unknown as Env), ...locked },
    );
    expect(withoutFetchMetadata.status).toBe(422);
    expect(await accounts()).toBe(0);
  });

  it("stays unlocked for a day, so a form left open can still be sent", async () => {
    const cookie = await unlock();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 23 * 60 * 60 * 1000);
    expect((await request("/first_run", { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await setUp(cookie)).status).toBe(201);
  });

  it("locks again, forgetting the cookie, once it has expired", async () => {
    const cookie = await unlock();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1000);
    const response = await request("/first_run", { headers: { Cookie: cookie } });
    await expectLocked(response);
    expect(response.headers.get("Set-Cookie")).toBe(FORGET_COOKIE);
    expect((await setUp(cookie)).status).toBe(403);
  });

  it.each([
    ["tampered with", (cookie: string) => cookie.slice(0, -2) + (cookie.endsWith("AA") ? "BB" : "AA"), {}],
    ["issued for an earlier token", (cookie: string) => cookie, { EMBER_SETUP_TOKEN: "f".repeat(64) }],
    ["sealed under another SESSION_SECRET", (cookie: string) => cookie, { SESSION_SECRET: "a-new-secret" }],
    ["the token itself", () => `__Host-ember_setup=${TOKEN}`, {}],
  ])("stays locked with a cookie %s", async (_, change: (cookie: string) => string, changes: Partial<Env>) => {
    const cookie = change(await unlock());
    const response = await request("/first_run", { headers: { Cookie: cookie } }, changes);
    await expectLocked(response);
    expect(response.headers.get("Set-Cookie")).toBe(FORGET_COOKIE);
    expect((await setUp(cookie, changes)).status).toBe(403);
    expect(await accounts()).toBe(0);
  });

  it("refuses a query string and plain HTTP even with the cookie", async () => {
    const cookie = await unlock();
    const query = await request(`/first_run?token=${TOKEN}`, { headers: { Cookie: cookie } });
    expect(query.status).toBe(400);
    expectPrivate(query);
    expect((await request("http://localhost:8787/first_run", { headers: { Cookie: cookie } })).status).toBe(403);
    const overHttp = await request("http://localhost:8787/api/first_run", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://localhost:8787" },
      body: JSON.stringify({ name: "Ada", emailAddress: "ada@example.com", password: "12345678" }),
    });
    expect(overHttp.status).toBe(403);
    expect(await accounts()).toBe(0);
  });

  it.each(["", "short", TOKEN.toUpperCase(), `${TOKEN}0`, ` ${TOKEN}`])("fails closed when EMBER_SETUP_TOKEN is %j", async (token) => {
    const changes = { EMBER_SETUP_TOKEN: token };
    for (const path of ["/first_run", "/first_run/access"]) {
      const response = await request(path, {}, changes);
      expect(response.status, path).toBe(500);
      expectPrivate(response);
    }
    expect((await setUp(undefined, changes)).status).toBe(500);
    expect(await accounts()).toBe(0);

    const health = await request("/api/health", {}, changes);
    expect(health.status).toBe(503);
    expect(await health.json()).toMatchObject({ ok: false, error: "EMBER_SETUP_TOKEN must be 64 lowercase hex characters" });
    expect((await (await request("/api/bootstrap", {}, changes)).json()) as Bootstrap).toMatchObject({ setupProtected: true });
  });
});
