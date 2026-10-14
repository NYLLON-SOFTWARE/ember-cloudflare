import { feature } from "@ember/parity";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { api, apiWith, builtPages, freshRoom, signIn, upgrade } from "./support";

// User agents from ember-rust's vectors/campfire_user_agents.json, with whether it blocks them.
/** Chrome 119, one version too old. */
const OLD_CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.199 Safari/537.36";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const INTERNET_EXPLORER = "Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko";
/** Apple Messages fetching a link's preview, which says it's Safari 9 and blocked. */
const APPLE_MESSAGES =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0";
/** Chrome 100 as Googlebot, which gets through as a bot. */
const GOOGLEBOT =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.6099.216 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

type Init = RequestInit<IncomingRequestCfProperties>;

/** `init` from a browser that says it's `userAgent`. */
const as = (userAgent: string, init: { headers?: Record<string, string> } = {}): Init => ({ ...init, headers: { ...init.headers, "User-Agent": userAgent } });
/** The app's own page, as the built app serves it, for `path`. */
const page = (path: string, init: Init = {}) => apiWith({ ASSETS: builtPages }, path, init);
/** Over plain HTTP, to a host that isn't this machine. */
const overHttp = (path: string, init: RequestInit = {}) => exports.default.fetch(`http://ember.test${path}`, { redirect: "manual", ...init });

const RAILS_DEFAULTS = {
  "x-frame-options": "SAMEORIGIN",
  "x-xss-protection": "0",
  "x-content-type-options": "nosniff",
  "x-permitted-cross-domain-policies": "none",
  "referrer-policy": "strict-origin-when-cross-origin",
};

function expectRailsDefaults(response: Response) {
  for (const [name, value] of Object.entries(RAILS_DEFAULTS)) expect(response.headers.get(name), name).toBe(value);
}

describe(feature("platform.health"), () => {
  it("answers /up with Rails' green page", async () => {
    const response = await api("/up");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<!DOCTYPE html><html><body style="background-color: green"></body></html>');
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.has("Vary")).toBe(false);
  });

  it("answers /up.json, or /up asked for JSON, with the time to the second", async () => {
    for (const response of [await api("/up.json"), await api("/up", { headers: { Accept: "application/json" } })]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
      const body = (await response.json()) as { status: string; timestamp: string };
      expect(Object.keys(body)).toEqual(["status", "timestamp"]);
      expect(body.status).toBe("up");
      expect(body.timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      expect(Math.abs(Date.parse(body.timestamp) - Date.now())).toBeLessThan(5_000);
    }
  });

  it("picks its format from Accept as Rails does, saying so with Vary", async () => {
    const formatFor = async (accept: string) => {
      const response = await api("/up", { headers: { Accept: accept } });
      return [response.status, response.headers.get("Content-Type"), response.headers.get("Vary")];
    };
    const html = [200, "text/html; charset=utf-8", "Accept"];
    const json = [200, "application/json; charset=utf-8", "Accept"];
    expect(await formatFor("text/html")).toEqual(html);
    expect(await formatFor("*/*")).toEqual(html);
    expect(await formatFor("application/json, text/html")).toEqual(json);
    expect(await formatFor("text/html;q=0.5, application/json")).toEqual(json);
    // A browser lists every type, and Rails reads that as HTML whatever comes first.
    expect(await formatFor("application/json,text/html;q=0.9,*/*;q=0.8")).toEqual([200, "text/html; charset=utf-8", null]);
    expect((await formatFor("text/plain"))[0]).toBe(406);
  });

  it("answers 406 for any other format", async () => {
    expect((await api("/up.xml")).status).toBe(406);
    expect((await api("/up.txt")).status).toBe(406);
    expect((await api("/up.html")).status).toBe(200);
  });

  it("isn't checked for old browsers, and carries Rails' headers but no version", async () => {
    const response = await apiWith({ GIT_REVISION: "abc123" }, "/up", as(OLD_CHROME));
    expect(await response.text()).toContain("background-color: green");
    expectRailsDefaults(response);
    expect(response.headers.has("X-Version")).toBe(false);
    expect(response.headers.has("X-Rev")).toBe(false);
  });
});

describe(feature("platform.security-headers"), () => {
  it("adds Rails' default headers to the API's answers, its errors and redirects included", async () => {
    expectRailsDefaults(await api("/api/bootstrap"));
    expectRailsDefaults(await api("/api/me"));
    expectRailsDefaults(await api("/api/nope"));
    const { cookie } = await signIn("Ada");
    const redirect = await api("/join/AAAA-BBBB-CCCC", { headers: { Cookie: cookie }, redirect: "manual" });
    expect(redirect.status).toBe(302);
    expectRailsDefaults(redirect);
  });

  it("adds them to the app's page, which comes through the Worker", async () => {
    for (const path of ["/", "/rooms/general", "/session/new"]) {
      const response = await page(path);
      expect(await response.text()).toBe(`page ${path}`);
      expectRailsDefaults(response);
    }
  });

  it("leaves a header an answer sets itself", async () => {
    // Setup's access page keeps itself out of frames and sends no referrer.
    const access = await apiWith({ ASSETS: builtPages, EMBER_SETUP_TOKEN: "0123456789abcdef".repeat(4) }, "/first_run/access");
    expect(access.headers.get("X-Frame-Options")).toBe("DENY");
    expect(access.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(access.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("pins HTTPS with HSTS on every answer", async () => {
    for (const response of [await api("/api/bootstrap"), await page("/"), await api("/up")]) {
      expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    }
  });

  it("sends plain HTTP to the same address over HTTPS, without its port", async () => {
    const response = await exports.default.fetch("http://ember.test:8080/rooms/general?x=1&y=%3C", { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://ember.test/rooms/general?x=1&y=%3C");
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe('<a href="https://ember.test/rooms/general?x=1&amp;y=%3C">Moved Permanently</a>.\n\n');
    expect(response.headers.has("Strict-Transport-Security")).toBe(false);

    const head = await overHttp("/", { method: "HEAD" });
    expect([head.status, head.headers.get("Content-Type")]).toEqual([301, "text/html; charset=utf-8"]);
    // Whatever the method, as ember-rust's TLS front answers it.
    const post = await overHttp("/api/session", { method: "POST", body: "{}" });
    expect([post.status, post.headers.get("Location"), post.headers.has("Content-Type")]).toEqual([301, "https://ember.test/api/session", false]);
    expect(await post.text()).toBe("");
  });

  it("keeps setup's addresses out of caches and referrers, and refuses them with a query", async () => {
    for (const path of ["/first_run", "/first_run/access", "/first_run.json"]) {
      const redirect = await overHttp(path);
      expect(redirect.status).toBe(301);
      expect(redirect.headers.get("Cache-Control")).toBe("no-store");
      expect(redirect.headers.get("Referrer-Policy")).toBe("no-referrer");

      const withQuery = await overHttp(`${path}?token=PRIVATE_SETUP_CREDENTIAL`);
      expect(withQuery.status).toBe(400);
      expect(withQuery.headers.has("Location")).toBe(false);
      expect(withQuery.headers.get("Cache-Control")).toBe("no-store");
      expect(withQuery.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(await withQuery.text()).toBe("Bad Request\n");
    }
  });

  it("lets plain HTTP through without HSTS on this machine, or when DISABLE_SSL is set", async () => {
    for (const host of ["localhost:8787", "127.0.0.1:8788", "[::1]", "ember.localhost"]) {
      const response = await exports.default.fetch(`http://${host}/api/bootstrap`);
      expect(response.status, host).toBe(200);
      expect(response.headers.has("Strict-Transport-Security"), host).toBe(false);
    }
    // HTTPS on this machine, as `wrangler dev --local-protocol https` serves it, carries none either.
    expect((await exports.default.fetch("https://localhost:8787/api/bootstrap")).headers.has("Strict-Transport-Security")).toBe(false);

    const disabled = await apiWith({ DISABLE_SSL: "true" }, "http://ember.test/api/bootstrap");
    expect(disabled.status).toBe(200);
    expectRailsDefaults(disabled);
    expect((await apiWith({ DISABLE_SSL: "false" }, "/api/bootstrap")).headers.has("Strict-Transport-Security")).toBe(false);
    // A blank value counts as unset, as ember-rust's config reads it.
    expect((await apiWith({ DISABLE_SSL: " " }, "http://ember.test/api/bootstrap", { redirect: "manual" })).status).toBe(301);
  });

  it("leaves a room's socket upgrade as it is", async () => {
    const room = await freshRoom("lobby");
    const { cookie } = await signIn("Ada");
    const response = await api(`/api/rooms/${room}/socket`, upgrade(cookie));
    expect(response.status).toBe(101);
    expect(response.headers.has("X-Frame-Options")).toBe(false);
    expect(response.headers.has("X-Version")).toBe(false);
    response.webSocket!.accept();
    response.webSocket!.close();
  });
});

describe(feature("platform.version"), () => {
  it("names the version on pages and the API's answers", async () => {
    expect((await api("/api/bootstrap")).headers.get("X-Version")).toBe("0.1");
    expect((await page("/")).headers.get("X-Version")).toBe("0.1");
    expect((await api("/api/nope")).headers.get("X-Version")).toBe("0.1");
    const configured = await apiWith({ APP_VERSION: "1.2.3", GIT_REVISION: "abc123" }, "/api/me");
    expect([configured.headers.get("X-Version"), configured.headers.get("X-Rev")]).toEqual(["1.2.3", "abc123"]);
  });

  it("sends X-Rev only when GIT_REVISION is set, blank or not", async () => {
    expect((await api("/api/bootstrap")).headers.has("X-Rev")).toBe(false);
    const blank = await apiWith({ GIT_REVISION: "" }, "/api/bootstrap");
    expect([blank.headers.get("X-Version"), blank.headers.get("X-Rev")]).toEqual(["0.1", ""]);
    expect((await apiWith({ GIT_REVISION: "abc123" }, "/api/bootstrap")).headers.get("X-Version")).toBe("abc123");
  });
});

describe(feature("platform.browser-support"), () => {
  it("answers an old browser with the upgrade page, status 200, whatever it asked for", async () => {
    for (const path of ["/", "/rooms/general", "/session/new", "/join/AAAA-BBBB-CCCC", "/first_run", "/api/bootstrap", "/webmanifest.json"]) {
      const response = await page(path, as(OLD_CHROME, { headers: { Accept: "application/json" } }));
      expect(response.status, path).toBe(200);
      expect(response.headers.get("Content-Type"), path).toBe("text/html; charset=utf-8");
      const html = await response.text();
      expect(html, path).toContain("<title>Unsupported browser</title>");
      expect(html, path).toContain("<h1>Upgrade to a supported web browser</h1>");
      expectRailsDefaults(response);
      expect(response.headers.get("X-Version")).toBe("0.1");
    }
  });

  it("lists the browsers Ember supports, with Campfire's icons", async () => {
    const html = await (await page("/", as(INTERNET_EXPLORER))).text();
    expect(html).toContain("Ember requires a modern web browser. Please use one of the browsers listed below and make sure auto-updates are enabled.");
    const listed = [...html.matchAll(/<img src="(\/browsers\/\w+\.svg)" alt="" aria-hidden="true"><div><strong>(\w+)<\/strong><span> ([\d.]+\+)<\/span>/g)].map((match) => match.slice(1));
    expect(listed).toEqual([
      ["/browsers/safari.svg", "Safari", "17.2+"],
      ["/browsers/chrome.svg", "Chrome", "120+"],
      ["/browsers/firefox.svg", "Firefox", "121+"],
      ["/browsers/opera.svg", "Opera", "104+"],
    ]);
  });

  it('titles the page "Ember" for Apple Messages\' link previews', async () => {
    const html = await (await page("/join/AAAA-BBBB-CCCC", as(APPLE_MESSAGES))).text();
    expect(html).toContain("<title>Ember</title>");
    expect(html).toContain("Upgrade to a supported web browser");
  });

  it("lets current browsers, bots and requests without a user agent through", async () => {
    for (const userAgent of [CHROME, GOOGLEBOT, ""]) {
      expect(await (await page("/", as(userAgent))).text(), userAgent).toBe("page /");
    }
    expect(await (await page("/")).text()).toBe("page /");
  });

  it("never checks /api/health or a room's live connection", async () => {
    expect(await (await api("/api/health", as(OLD_CHROME))).json()).toMatchObject({ ok: true });
    const room = await freshRoom("lobby");
    const { cookie } = await signIn("Ada");
    const socket = await api(`/api/rooms/${room}/socket`, as(OLD_CHROME, upgrade(cookie)));
    expect(socket.status).toBe(101);
    socket.webSocket!.accept();
    socket.webSocket!.close();
  });
});
