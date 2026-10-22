import { feature } from "@ember/parity";
import {
  EMAIL_ADDRESS_TOO_LONG,
  MAX_EMAIL_ADDRESS_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_USER_NAME_LENGTH,
  NAME_TOO_LONG,
  PASSWORD_TOO_LONG,
  PASSWORD_TOO_SHORT,
  type Bootstrap,
  type NewWorkspace,
  type Room,
  type Sidebar,
} from "@ember/protocol";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import worker from "../src/index";
import { verifyPassword } from "../src/passwords";
import { NO_SETUP_TOKEN, SETUP_LINK_NEEDED, SETUP_LINK_REFUSED } from "../src/setup";
import { api, apiWith, builtPages, cookieOf, freshDeploy, listedRoom, origin, SETUP_TOKEN, signIn, workspaceSql, workspaceStub } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "12345678" };

const setUp = (form: object, headers: Record<string, string> = {}) =>
  api("/api/first_run", { method: "POST", headers: { "User-Agent": "Ada's laptop", "CF-Connecting-IP": "203.0.113.7", ...headers }, body: JSON.stringify(form) });

const bootstrap = async (cookie?: string) => (await (await api("/api/bootstrap", { headers: cookie ? { Cookie: cookie } : {} })).json()) as Bootstrap;

const count = async (table: string) => ((await workspaceSql(`SELECT count(*) AS n FROM ${table}`)) as Array<{ n: number }>)[0]!.n;

/** The setup page as the browser asks for it, with the built app standing in. */
const page = (path: string, init: RequestInit<IncomingRequestCfProperties> = {}) => apiWith({ ASSETS: builtPages }, path, { redirect: "manual", ...init });

beforeEach(freshDeploy);

describe(feature("auth.first-run"), () => {
  it("starts out waiting to be set up, with the setup page open to the first visitor", async () => {
    expect(await bootstrap()).toEqual({
      setup: "pending",
      // The suite's Worker has a setup token, so setup takes the link that carries it.
      setupAccess: "link",
      setupPlaceholders: { name: "Kevin Rose", emailAddress: "kevin@kevinrose.com" },
      guestSignIn: true,
      account: { name: "Ember", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null },
      helpContact: null,
      version: "0.1",
      // The suite's key pair's public key, uncompressed, without padding.
      vapidPublicKey: "BEYXTBB5_jNhNzXDmx5KEU55Vbbd-u--Lk9rM5OFQvUkPIBwZJ9QzAq0zdEzFw6yTV8cTriz_qYBVicY02_VxTQ",
      // What the useragent gem reads without a user agent, which it takes as "Mozilla/4.0 (compatible)".
      platform: { ios: false, android: false, desktop: true, windows: false, chrome: false, firefox: false, safari: false, edge: false, browser: "Mozilla", operatingSystem: "" },
      user: null,
    });
    expect((await api("/api/bootstrap")).headers.get("Cache-Control")).toBe("no-store");

    const response = await page("/first_run");
    expect(response.status).toBe(200);
    // The app's own page, which shows the form at /first_run.
    expect(await response.text()).toBe("page /");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // Rails' default, as any page has, since nothing private is on the way.
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("suggests the name and email address the deployment names in place of the defaults", async () => {
    const placeholders = async (changes: Partial<Env>) => ((await (await apiWith(changes, "/api/bootstrap")).json()) as Bootstrap).setupPlaceholders;
    expect(await placeholders({ EMBER_SETUP_NAME_PLACEHOLDER: "Grace Hopper", EMBER_SETUP_EMAIL_PLACEHOLDER: " grace@example.com " })).toEqual({
      name: "Grace Hopper",
      emailAddress: "grace@example.com",
    });
    // Each stands alone, and a blank one counts as unset.
    expect(await placeholders({ EMBER_SETUP_NAME_PLACEHOLDER: " ", EMBER_SETUP_EMAIL_PLACEHOLDER: "grace@example.com" })).toEqual({
      name: "Kevin Rose",
      emailAddress: "grace@example.com",
    });
  });

  it("creates the workspace, its administrator, general and random, and signs them in, opening general", async () => {
    const response = await setUp(ada);
    expect(response.status).toBe(201);
    const { user, room } = (await response.json()) as NewWorkspace;
    expect(user).toEqual({ id: expect.any(String), name: "Ada Lovelace", administrator: true });
    expect(room).toEqual({ id: expect.any(String), kind: "open", name: "general", icon: null });
    expect(response.headers.getSetCookie()).toEqual([expect.stringMatching(/^__Host-session_token=[\w-]{43}; Path=\/; Max-Age=34560000; HttpOnly; SameSite=Lax; Secure$/)]);

    const [account] = (await workspaceSql("SELECT name, join_code, settings, singleton_guard FROM accounts")) as Array<Record<string, unknown>>;
    expect(account).toEqual({ name: "Ember", join_code: expect.stringMatching(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/), settings: '{"restrict_room_creation_to_administrators":false}', singleton_guard: 0 });

    const [administrator] = (await workspaceSql("SELECT id, name, email_address, password_digest, role, status, guest FROM users")) as Array<Record<string, unknown>>;
    expect(administrator).toMatchObject({ id: user.id, name: "Ada Lovelace", email_address: "ada@example.com", role: 1, status: 0, guest: 0 });
    expect(await verifyPassword("12345678", administrator!.password_digest as string)).toBe(true);

    const rooms = (await workspaceSql("SELECT id, kind, name, icon, creator_id FROM rooms ORDER BY created_at, id")) as Array<Room & { creator_id: string }>;
    expect(rooms).toEqual([
      { ...room, creator_id: user.id },
      { id: expect.any(String), kind: "open", name: "random", icon: null, creator_id: user.id },
    ]);
    const random = rooms[1]!;
    expect(await workspaceSql("SELECT room_id, user_id, involvement FROM memberships JOIN rooms ON rooms.id = room_id ORDER BY rooms.created_at, rooms.id")).toEqual([
      { room_id: room.id, user_id: user.id, involvement: "mentions" },
      { room_id: random.id, user_id: user.id, involvement: "mentions" },
    ]);
    expect(await workspaceSql("SELECT user_id, ip_address, user_agent FROM sessions")).toEqual([{ user_id: user.id, ip_address: "203.0.113.7", user_agent: "Ada's laptop" }]);

    const cookie = cookieOf(response);
    expect(await bootstrap(cookie)).toMatchObject({ setup: "complete", account: { name: "Ember" }, user });
    const sidebar = (await (await api("/api/sidebar", { headers: { Cookie: cookie } })).json()) as Sidebar;
    // general is the first room, so it has the welcome card.
    expect(sidebar.rooms).toEqual([listedRoom(room), listedRoom({ ...room, id: random.id, name: "random" })]);
    expect(sidebar.invitation?.roomId).toBe(room.id);
  });

  it.each(["", "short", "1234567", "éééé", "🔐🔐🔐🔐"])("refuses the password %j and creates nothing", async (password) => {
    const response = await setUp({ ...ada, password });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: PASSWORD_TOO_SHORT, field: "password" });
    expect(response.headers.get("Set-Cookie")).toBeNull();
    for (const table of ["accounts", "users", "rooms", "sessions"]) expect(await count(table), table).toBe(0);
  });

  it.each([MAX_PASSWORD_LENGTH + 1, 2 ** 19])("refuses a password of %i characters, which the form can't send, and creates nothing", async (length) => {
    const response = await setUp({ ...ada, password: "x".repeat(length) });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: PASSWORD_TOO_LONG, field: "password" });
    expect(response.headers.get("Set-Cookie")).toBeNull();
    for (const table of ["accounts", "users", "rooms", "sessions"]) expect(await count(table), table).toBe(0);
  });

  it("takes a password as long as the form allows", async () => {
    const password = "x".repeat(MAX_PASSWORD_LENGTH);
    expect((await setUp({ ...ada, password })).status).toBe(201);
    const [administrator] = (await workspaceSql("SELECT password_digest FROM users")) as Array<{ password_digest: string }>;
    expect(await verifyPassword(password, administrator!.password_digest)).toBe(true);
  });

  it.each([
    ["a name", { ...ada, name: "x".repeat(MAX_USER_NAME_LENGTH + 1) }, { error: NAME_TOO_LONG, field: "name" }],
    ["an email address", { ...ada, emailAddress: `${"x".repeat(MAX_EMAIL_ADDRESS_LENGTH - 11)}@example.com` }, { error: EMAIL_ADDRESS_TOO_LONG, field: "emailAddress" }],
  ])("answers 422 to %s longer than Ember keeps, and creates nothing", async (_, form, body) => {
    const response = await setUp(form);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(body);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    for (const table of ["accounts", "users", "rooms", "sessions"]) expect(await count(table), table).toBe(0);
  });

  it("takes a name and an email address as long as Ember keeps", async () => {
    const name = "x".repeat(MAX_USER_NAME_LENGTH);
    const emailAddress = `${"x".repeat(MAX_EMAIL_ADDRESS_LENGTH - 12)}@example.com`;
    expect((await setUp({ ...ada, name, emailAddress })).status).toBe(201);
    expect(await workspaceSql("SELECT name, email_address FROM users")).toEqual([{ name, email_address: emailAddress }]);
  });

  it.each([
    ["a name", { ...ada, name: " " }],
    ["an email address", { ...ada, emailAddress: undefined }],
    ["a password", { ...ada, password: undefined }],
  ])("answers 400 without %s", async (_, form) => {
    const response = await setUp(form);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Name, email address and password are required" });
    expect(await count("accounts")).toBe(0);
  });

  it("refuses a post from another site", async () => {
    expect((await setUp(ada, { "Sec-Fetch-Site": "cross-site" })).status).toBe(422);
    expect(await count("accounts")).toBe(0);
  });

  it("happens once: then setup answers 409 and its pages send everyone home", async () => {
    expect((await setUp(ada)).status).toBe(201);

    const again = await setUp({ ...ada, name: "Mallory", emailAddress: "mallory@example.com" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "Ember is already set up", redirect: "/" });
    expect(again.headers.get("Set-Cookie")).toBeNull();
    expect(await workspaceSql("SELECT name FROM users")).toEqual([{ name: "Ada Lovelace" }]);

    for (const path of ["/first_run", "/first_run.json"]) {
      const response = await page(path);
      expect(response.status, path).toBe(302);
      expect(response.headers.get("Location"), path).toBe(`${origin}/`);
    }
  });

  it("creates one workspace however many people submit at once", async () => {
    const responses = await Promise.all(["Ada", "Grace", "Katherine", "Dorothy", "Mary"].map((name) => setUp({ ...ada, name, emailAddress: `${name}@example.com` })));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(responses.filter((response) => response.status === 409).every((response) => !response.headers.has("Set-Cookie"))).toBe(true);
    expect(await count("accounts")).toBe(1);
    expect(await workspaceSql("SELECT count(*) AS n FROM users WHERE role = 1")).toEqual([{ n: 1 }]);
    expect(await count("rooms")).toBe(2);
  });

  it("puts everyone already here in general and random, and the administrator in every open room", async () => {
    const guest = await signIn("Grace");
    // An open room from before setup, which guests can make where they're let in.
    const before = await api("/api/rooms", { method: "POST", headers: { Cookie: guest.cookie }, body: JSON.stringify({ kind: "open", name: "Design" }) });
    expect(before.status).toBe(201);

    const { user } = (await (await setUp(ada)).json()) as NewWorkspace;
    const memberships = (await workspaceSql("SELECT rooms.name, memberships.user_id FROM memberships JOIN rooms ON rooms.id = memberships.room_id")) as Array<{ name: string; user_id: string }>;
    expect(memberships.map(({ name, user_id }) => `${name}: ${user_id}`).sort()).toEqual(
      ["Design", "general", "random"].flatMap((name) => [`${name}: ${guest.user.id}`, `${name}: ${user.id}`]).sort(),
    );
  });

  it("answers the form's page only as a page, and nothing else under /first_run", async () => {
    expect((await page("/first_run.json")).status).toBe(406);
    expect((await page("/first_run/new")).status).toBe(404);
    expect((await page("/first_run", { method: "POST", body: "user[name]=Ada" })).status).toBe(404);
    expect((await page("/first_run/access")).status).toBe(404);
    // Not setup's, nor a page of the app's: the built app answers it, with Campfire's 404 page.
    expect(await (await page("/first_runs")).text()).toBe("page /first_runs");
  });
});

/**
 * A first-run post as the Set up Ember page sends it to `url`, with `token` as its bearer token, or none,
 * to a Worker whose EMBER_SETUP_TOKEN is `secret`, or unset.
 */
function firstRunAt(url: string, { token, secret, body = JSON.stringify(ada) }: { token?: string; secret: string | undefined; body?: string }) {
  const headers = new Headers({ "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" });
  if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
  const request = new Request<unknown, IncomingRequestCfProperties>(url, { method: "POST", headers, body });
  return worker.fetch(request, { ...(env as unknown as Env), EMBER_SETUP_TOKEN: secret });
}

/** The same, to this suite's Worker, whose setup token is `SETUP_TOKEN` unless `secret` says otherwise. */
const firstRunWith = (options: { token?: string; secret?: string; body?: string }) => firstRunAt(`${origin}/api/first_run`, { secret: SETUP_TOKEN, ...options });

/** What setting Ember up takes, as `/api/bootstrap` at `url` tells a Worker whose EMBER_SETUP_TOKEN is `secret`. */
async function setupAccessAt(url: string, secret: string | undefined): Promise<Bootstrap["setupAccess"]> {
  const response = await worker.fetch(new Request<unknown, IncomingRequestCfProperties>(`${url}/api/bootstrap`), { ...(env as unknown as Env), EMBER_SETUP_TOKEN: secret });
  return ((await response.json()) as Bootstrap).setupAccess;
}

const nothingCreated = async () => {
  for (const table of ["accounts", "users", "rooms", "sessions"]) expect(await count(table), table).toBe(0);
};

describe(feature("auth.protected-setup"), () => {
  it("sets Ember up only through the deploy's setup link: without its token the form is refused before it's read", async () => {
    expect(await setupAccessAt(origin, SETUP_TOKEN)).toBe("link");
    const refused = await firstRunWith({});
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: SETUP_LINK_NEEDED });
    expect(refused.headers.get("Set-Cookie")).toBeNull();
    // Before the form is read: one that isn't even JSON is refused the same way, not as a bad request.
    const unread = await firstRunWith({ body: "not a form" });
    expect([unread.status, await unread.json()]).toEqual([403, { error: SETUP_LINK_NEEDED }]);
    await nothingCreated();

    const created = await firstRunWith({ token: SETUP_TOKEN });
    expect(created.status).toBe(201);
    expect(cookieOf(created)).toMatch(/^__Host-session_token=/);
  });

  it("refuses a token that isn't this deployment's, however close, and asks for the link given none", async () => {
    for (const token of [`${SETUP_TOKEN.slice(0, -1)}f`, SETUP_TOKEN.toUpperCase(), ` ${SETUP_TOKEN}`, "0".repeat(64)]) {
      const response = await firstRunWith({ token });
      expect(response.status, token).toBe(403);
      expect(await response.json()).toEqual({ error: SETUP_LINK_REFUSED });
    }
    const blank = await firstRunWith({ token: "" });
    expect([blank.status, await blank.json()]).toEqual([403, { error: SETUP_LINK_NEEDED }]);
    await nothingCreated();
  });

  it("checks the link before whether Ember is set up, so without it setup says nothing more", async () => {
    expect((await setUp(ada)).status).toBe(201);
    expect((await firstRunWith({})).status).toBe(403);
    expect((await firstRunWith({ token: SETUP_TOKEN })).status).toBe(409);
  });

  it("is closed, and says so, while the deployment has no setup token, or a blank one", async () => {
    for (const secret of [undefined, ""]) {
      expect(await setupAccessAt(origin, secret), String(secret)).toBe("closed");
      const response = await firstRunWith({ secret, token: SETUP_TOKEN });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: NO_SETUP_TOKEN });
    }
    await nothingCreated();
  });

  it("counts a token that can't be one as none, and says so in the log, without repeating it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "Hunter2".repeat(10);
    expect(await setupAccessAt(origin, secret)).toBe("closed");
    expect(error).not.toHaveBeenCalled();
    const response = await firstRunWith({ secret, token: secret });
    expect([response.status, await response.json()]).toEqual([403, { error: NO_SETUP_TOKEN }]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("64 lowercase hex characters"));
    expect(error.mock.calls.flat().join(" ")).not.toContain(secret);
    error.mockRestore();
  });

  it("is open over loopback without a token, where `wrangler dev` serves, and still takes the link there with one", async () => {
    const local = "http://localhost:8787";
    expect(await setupAccessAt(local, undefined)).toBe("open");
    expect(await setupAccessAt(local, SETUP_TOKEN)).toBe("link");
    expect((await firstRunAt(`${local}/api/first_run`, { secret: SETUP_TOKEN })).status).toBe(403);
    const created = await firstRunAt(`${local}/api/first_run`, { secret: undefined });
    expect(created.status).toBe(201);
    expect(await workspaceSql("SELECT name FROM users")).toEqual([{ name: "Ada Lovelace" }]);
  });
});

describe(feature("rooms.legacy-rooms"), () => {
  it("makes no second general or random where they were registered, and opens the old general", async () => {
    await workspaceStub().registerLegacyRooms(["general", "random"]);
    const response = await setUp(ada);
    expect(response.status).toBe(201);
    const { user, room } = (await response.json()) as NewWorkspace;
    expect(room).toEqual({ id: "general", kind: "open", name: "general", icon: null });
    expect(await workspaceSql("SELECT id, name, creator_id FROM rooms ORDER BY created_at, id")).toEqual([
      { id: "general", name: "general", creator_id: null },
      { id: "random", name: "random", creator_id: null },
    ]);
    expect(await workspaceSql("SELECT room_id FROM memberships WHERE user_id = ? ORDER BY room_id", user.id)).toEqual([{ room_id: "general" }, { room_id: "random" }]);

    // The old general, registered first, is the first room, as the old preview's is.
    const sidebar = (await (await api("/api/sidebar", { headers: { Cookie: cookieOf(response) } })).json()) as Sidebar;
    expect(sidebar.rooms.map(({ id }) => id)).toEqual(["general", "random"]);
    expect(sidebar.invitation?.roomId).toBe("general");
  });
});
