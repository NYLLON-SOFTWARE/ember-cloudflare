import { feature } from "@ember/parity";
import { MAX_PASSWORD_LENGTH, PASSWORD_TOO_LONG, PASSWORD_TOO_SHORT, type Bootstrap, type NewWorkspace, type Room } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../src/passwords";
import { api, apiWith, builtPages, cookieOf, freshDeploy, origin, signIn, workspaceSql } from "./support";

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
    expect(await bootstrap()).toEqual({ setup: "pending", setupProtected: false, guestSignIn: true, account: { name: "Ember" }, helpContact: null, version: "0.1", user: null });
    expect((await api("/api/bootstrap")).headers.get("Cache-Control")).toBe("no-store");

    const response = await page("/first_run");
    expect(response.status).toBe(200);
    // The app's own page, which shows the form at /first_run.
    expect(await response.text()).toBe("page /");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBeNull();
  });

  it("creates the workspace, its administrator and All Talk, and signs them in", async () => {
    const response = await setUp(ada);
    expect(response.status).toBe(201);
    const { user, room } = (await response.json()) as NewWorkspace;
    expect(user).toEqual({ id: expect.any(String), name: "Ada Lovelace" });
    expect(room).toEqual({ id: expect.any(String), kind: "open", name: "All Talk" });
    expect(response.headers.getSetCookie()).toEqual([expect.stringMatching(/^__Host-session_token=[\w-]{43}; Path=\/; Max-Age=34560000; HttpOnly; SameSite=Lax; Secure$/)]);

    const [account] = (await workspaceSql("SELECT name, join_code, settings, singleton_guard FROM accounts")) as Array<Record<string, unknown>>;
    expect(account).toEqual({ name: "Ember", join_code: expect.stringMatching(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/), settings: '{"restrict_room_creation_to_administrators":false}', singleton_guard: 0 });

    const [administrator] = (await workspaceSql("SELECT id, name, email_address, password_digest, role, status, guest FROM users")) as Array<Record<string, unknown>>;
    expect(administrator).toMatchObject({ id: user.id, name: "Ada Lovelace", email_address: "ada@example.com", role: 1, status: 0, guest: 0 });
    expect(await verifyPassword("12345678", administrator!.password_digest as string)).toBe(true);

    expect(await workspaceSql("SELECT id, kind, name, creator_id FROM rooms")).toEqual([{ id: room.id, kind: "open", name: "All Talk", creator_id: user.id }]);
    expect(await workspaceSql("SELECT user_id, involvement FROM memberships")).toEqual([{ user_id: user.id, involvement: "mentions" }]);
    expect(await workspaceSql("SELECT user_id, ip_address, user_agent FROM sessions")).toEqual([{ user_id: user.id, ip_address: "203.0.113.7", user_agent: "Ada's laptop" }]);

    const cookie = cookieOf(response);
    expect(await bootstrap(cookie)).toMatchObject({ setup: "complete", account: { name: "Ember" }, user });
    const rooms = (await (await api("/api/rooms", { headers: { Cookie: cookie } })).json()) as { rooms: Room[] };
    expect(rooms.rooms).toEqual([room]);
  });

  it.each(["", "short", "1234567", "éééé", "🔐🔐🔐🔐"])("refuses the password %j and creates nothing", async (password) => {
    const response = await setUp({ ...ada, password });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: PASSWORD_TOO_SHORT, field: "password" });
    expect(response.headers.get("Set-Cookie")).toBeNull();
    for (const table of ["accounts", "users", "rooms", "sessions"]) expect(await count(table), table).toBe(0);
  });

  it.each([MAX_PASSWORD_LENGTH + 1, 2 ** 20])("refuses a password of %i characters, which the form can't send, and creates nothing", async (length) => {
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

    for (const path of ["/first_run", "/first_run.json", "/first_run/access"]) {
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
    expect(await count("rooms")).toBe(1);
  });

  it("puts everyone already here in All Talk, and the administrator in every open room", async () => {
    const guest = await signIn("Grace");
    // An open room from before setup, such as one LEGACY_ROOMS registers.
    const before = await api("/api/rooms", { method: "POST", headers: { Cookie: guest.cookie }, body: JSON.stringify({ kind: "open", name: "general" }) });
    expect(before.status).toBe(201);

    const { user } = (await (await setUp(ada)).json()) as NewWorkspace;
    const memberships = (await workspaceSql("SELECT rooms.name, memberships.user_id FROM memberships JOIN rooms ON rooms.id = memberships.room_id")) as Array<{ name: string; user_id: string }>;
    expect(memberships.map(({ name, user_id }) => `${name}: ${user_id}`).sort()).toEqual(
      [`All Talk: ${guest.user.id}`, `All Talk: ${user.id}`, `general: ${guest.user.id}`, `general: ${user.id}`].sort(),
    );
  });

  it("answers the form's page only as a page, and nothing else under /first_run", async () => {
    expect((await page("/first_run.json")).status).toBe(406);
    expect((await page("/first_run/new")).status).toBe(404);
    expect((await page("/first_run", { method: "POST", body: "user[name]=Ada" })).status).toBe(404);
    expect((await page("/first_run/access")).status).toBe(404);
    // Not setup's: the app's page, as any unknown path gets.
    expect(await (await page("/first_runs")).text()).toBe("page /first_runs");
  });
});
