import { feature } from "@ember/parity";
import { CloseCode, SIGN_IN_REFUSED, type Bootstrap, type HelpContact, type NewWorkspace, type User } from "@ember/protocol";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialsFor } from "../src/auth";
import type { Env } from "../src/env";
import { hashPassword } from "../src/passwords";
import type { Workspace } from "../src/workspace";
import type { WorkspaceStore } from "../src/workspace-store";
import { api, apiWith, closeOf, connect, cookieOf, forwardUpgrade, freshDeploy, freshRoom, origin, post, settle, signIn, upgrade, workspaceSql, workspaceStub, type Session } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };
const SIGN_IN_WINDOW_MS = 3 * 60 * 1000;

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  return { user: ((await response.json()) as NewWorkspace).user, cookie: cookieOf(response) };
}

/** A sign-in with an email address and password, from `ip`. */
const signInWith = (body: unknown, { ip = "203.0.113.7", headers = {} }: { ip?: string; headers?: Record<string, string> } = {}) =>
  api("/api/session", { method: "POST", headers: { "CF-Connecting-IP": ip, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

/** Signs in as Ada from another browser, in a session of its own. */
async function signInAsAda(): Promise<Session> {
  const response = await signInWith({ emailAddress: ada.emailAddress, password: ada.password });
  expect(response.status).toBe(201);
  return { user: ((await response.json()) as { user: User }).user, cookie: cookieOf(response) };
}

const sessionCount = async () => ((await workspaceSql("SELECT count(*) AS n FROM sessions")) as Array<{ n: number }>)[0]!.n;

const bootstrap = async (changes = {}) => (await (await apiWith(changes, "/api/bootstrap")).json()) as Bootstrap;

beforeEach(freshDeploy);
afterEach(() => vi.useRealTimers());

describe(feature("auth.sign-in"), () => {
  it("signs in an active person with their email address and password, in a session of its own", async () => {
    const { user, cookie: firstRunCookie } = await setUp();
    // Someone already signed in can sign in again, as in ember-rust.
    const response = await signInWith({ emailAddress: ada.emailAddress, password: ada.password }, { headers: { Cookie: firstRunCookie, "User-Agent": "Ada's phone" } });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ user });
    expect(response.headers.getSetCookie()).toEqual([expect.stringMatching(/^__Host-session_token=[\w-]{43}; Path=\/; Max-Age=34560000; HttpOnly; SameSite=Lax; Secure$/)]);

    const cookie = cookieOf(response);
    expect(cookie).not.toBe(firstRunCookie);
    expect(await workspaceSql("SELECT ip_address, user_agent FROM sessions WHERE user_agent = ?", "Ada's phone")).toEqual([{ ip_address: "203.0.113.7", user_agent: "Ada's phone" }]);
    expect(await sessionCount()).toBe(2);
    expect(await (await api("/api/me", { headers: { Cookie: cookie } })).json()).toEqual({ user });
    expect((await (await api("/api/bootstrap", { headers: { Cookie: cookie } })).json()) as Bootstrap).toMatchObject({ setup: "complete", user });
  });

  it.each([
    ["a wrong password", { emailAddress: ada.emailAddress, password: "difference engine" }],
    ["an unknown email address", { emailAddress: "grace@example.com", password: ada.password }],
    ["the address in other capitals", { emailAddress: "Ada@Example.com", password: ada.password }],
    ["the address with spaces around it", { emailAddress: ` ${ada.emailAddress} `, password: ada.password }],
    ["a blank password", { emailAddress: ada.emailAddress, password: "" }],
    ["a password longer than the form sends", { emailAddress: ada.emailAddress, password: ada.password.padEnd(73, "!") }],
    ["no password", { emailAddress: ada.emailAddress }],
    ["no email address", { password: ada.password }],
    ["a password that isn't text", { emailAddress: ada.emailAddress, password: 12345678 }],
    ["an empty body", {}],
    ["a null body", null],
    ["a number for a body", 42],
    ["a body that isn't JSON", "email_address=ada@example.com&password=analytical+engine"],
  ])("refuses %s with ember-rust's alert", async (_, body) => {
    await setUp();
    const response = await signInWith(body);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: SIGN_IN_REFUSED });
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(await sessionCount()).toBe(1);
  });

  it.each([
    ["deactivated", 1],
    ["banned", 2],
  ])("doesn't sign in someone who has been %s", async (_, status) => {
    const { user } = await setUp();
    await workspaceSql("UPDATE users SET status = ? WHERE id = ?", status, user.id);
    expect((await signInWith({ emailAddress: ada.emailAddress, password: ada.password })).status).toBe(401);
  });

  it("never signs in someone without a password", async () => {
    await setUp();
    // Bots, and in ember-rust people who joined with an empty password, have an address but no digest.
    const now = new Date().toISOString();
    await workspaceSql(
      "INSERT INTO users (id, name, email_address, password_digest, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      "botbotbotbotbot1",
      "Bot",
      "bot@example.com",
      "",
      2,
      now,
      now,
    );
    expect((await signInWith({ emailAddress: "bot@example.com", password: "" })).status).toBe(401);
    expect((await signInWith({ emailAddress: "bot@example.com", password: "anything at all" })).status).toBe(401);
  });

  it("signs in someone the administrator didn't create, with the password they chose", async () => {
    await setUp();
    const now = new Date().toISOString();
    const digest = await hashPassword("compiler");
    await workspaceSql(
      "INSERT INTO users (id, name, email_address, password_digest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      "gracegracegrace1",
      "Grace Hopper",
      "grace@example.com",
      digest,
      now,
      now,
    );
    const response = await signInWith({ emailAddress: "grace@example.com", password: "compiler" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ user: { id: "gracegracegrace1", name: "Grace Hopper" } });
  });

  it("refuses everyone before Ember is set up", async () => {
    expect((await signInWith({ emailAddress: ada.emailAddress, password: ada.password })).status).toBe(401);
  });
});

describe(feature("auth.rate-limit"), () => {
  it("allows each IP 10 attempts, successful or not, then answers 429 without checking the password", async () => {
    await setUp();
    const wrong = { emailAddress: ada.emailAddress, password: "difference engine" };
    for (let attempt = 1; attempt <= 9; attempt++) expect((await signInWith(wrong)).status, `attempt ${attempt}`).toBe(401);
    await signInAsAda();

    const limited = await signInWith({ emailAddress: ada.emailAddress, password: ada.password });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: SIGN_IN_REFUSED });
    expect(limited.headers.has("Set-Cookie")).toBe(false);
    // So is an attempt that wouldn't get as far as a password.
    expect((await signInWith({})).status).toBe(429);

    expect((await signInWith({ emailAddress: ada.emailAddress, password: ada.password }, { ip: "198.51.100.4" })).status).toBe(201);
  });

  it("starts counting again 3 minutes after an IP's first attempt", async () => {
    await setUp();
    const start = Date.now();
    // The Workspace runs in this isolate, so it sees the faked clock too.
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    const wrong = { emailAddress: ada.emailAddress, password: "difference engine" };
    expect((await signInWith(wrong)).status).toBe(401);
    vi.setSystemTime(start + SIGN_IN_WINDOW_MS - 60_000);
    for (let attempt = 2; attempt <= 10; attempt++) expect((await signInWith(wrong)).status, `attempt ${attempt}`).toBe(401);
    expect((await signInWith(wrong)).status).toBe(429);

    vi.setSystemTime(start + SIGN_IN_WINDOW_MS - 1);
    expect((await signInWith(wrong)).status).toBe(429);
    vi.setSystemTime(start + SIGN_IN_WINDOW_MS);
    expect((await signInWith({ emailAddress: ada.emailAddress, password: ada.password })).status).toBe(201);
  });

  it("doesn't count signing in with just a name", async () => {
    await setUp();
    for (let guest = 1; guest <= 10; guest++) {
      const response = await api("/api/session", { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.7" }, body: JSON.stringify({ name: `Guest ${guest}` }) });
      expect(response.status).toBe(201);
    }
    expect((await signInWith({ emailAddress: ada.emailAddress, password: ada.password })).status).toBe(201);
  });
});

describe(feature("auth.sign-out"), () => {
  it("closes the sockets this browser opened, in every room, and leaves the person's other sessions connected", async () => {
    const laptop = await setUp();
    const lobby = await freshRoom("lobby");
    const annex = await freshRoom("annex");
    const phone = await signInAsAda();
    const grace = await signIn("Grace");

    const laptopInLobby = await connect(lobby, laptop);
    const laptopInAnnex = await connect(annex, laptop);
    const phoneInLobby = await connect(lobby, phone);
    const graceInLobby = await connect(lobby, grace);
    const graceInAnnex = await connect(annex, grace);
    const closes = [laptopInLobby, laptopInAnnex].map((tab) => closeOf(tab.ws));

    expect((await api("/api/session", { method: "DELETE", headers: { Cookie: laptop.cookie } })).status).toBe(204);
    for (const close of await Promise.all(closes)) expect(close).toMatchObject({ code: CloseCode.Reconnect, reason: "Reconnect" });
    expect((await api(`/api/rooms/${lobby}/socket`, upgrade(laptop.cookie))).status).toBe(401);
    expect(await workspaceSql("SELECT * FROM pending_revocations")).toEqual([]);

    // Ada's phone still has the lobby open, so she's still there; she has left the annex, once.
    expect(await graceInLobby.next("typing")).toEqual({ type: "typing", user: laptop.user, typing: false });
    expect(await graceInAnnex.next("presence.left")).toEqual({ type: "presence.left", userId: laptop.user.id });
    expect((await post(phoneInLobby, "Still here")).body).toBe("Still here");
    await settle(graceInLobby, graceInAnnex);
    expect(graceInLobby.log.filter((frame) => frame.type === "presence.left")).toEqual([]);
    expect(graceInAnnex.log.filter((frame) => frame.type === "presence.left")).toHaveLength(1);
  });

  it("turns away a socket the Workspace let through just before the session ended, which reaches the room after", async () => {
    const laptop = await setUp();
    const lobby = await freshRoom("lobby");
    const grace = await connect(lobby, "Grace");
    const tab = await connect(lobby, laptop);
    const closed = closeOf(tab.ws);
    // The Workspace lets another of the browser's tabs into the lobby, and the Worker is held up.
    const token = laptop.cookie.slice(laptop.cookie.indexOf("=") + 1);
    const access = await workspaceStub().roomAccess(await credentialsFor(token, new Request(origin), env as unknown as Env), lobby);

    expect((await api("/api/session", { method: "DELETE", headers: { Cookie: laptop.cookie } })).status).toBe(204);
    expect(await closed).toMatchObject({ code: CloseCode.Reconnect });
    const late = await forwardUpgrade(lobby, access!);
    expect(late.status).toBe(101);
    late.webSocket!.accept();
    expect(await closeOf(late.webSocket!)).toMatchObject({ code: CloseCode.Reconnect, reason: "Reconnect" });

    // Nobody saw it arrive, and another of the person's sessions still gets in.
    await settle(grace);
    expect(grace.log.filter((frame) => frame.type === "presence.joined")).toEqual([{ type: "presence.joined", user: laptop.user }]);
    const phone = await signInAsAda();
    expect((await connect(lobby, phone)).me).toEqual(laptop.user);
  });
});

describe(feature("auth.help-contact"), () => {
  it("names no one until Ember is set up", async () => {
    expect((await bootstrap()).helpContact).toBeNull();
  });

  it("names the first administrator, whether or not they're still active", async () => {
    const { user } = await setUp();
    expect((await bootstrap()).helpContact).toEqual({ name: "Ada Lovelace", emailAddress: "ada@example.com" });

    await workspaceSql("UPDATE users SET status = 1 WHERE id = ?", user.id);
    // A Workspace that starts afresh reads them again.
    await evictDurableObject(workspaceStub());
    expect((await bootstrap()).helpContact).toEqual({ name: "Ada Lovelace", emailAddress: "ada@example.com" });
  });

  it("keeps the administrator first run names when a read from before it finishes after it", async () => {
    // On D1 a read is a network call, during which first run can finish.
    await runInDurableObject(workspaceStub(), async (workspace: Workspace) => {
      const store = (workspace as unknown as { store: WorkspaceStore }).store;
      let finishReading!: (contact: HelpContact | null) => void;
      vi.spyOn(store, "helpContact").mockReturnValueOnce(new Promise((resolve) => (finishReading = resolve)));
      const reading = workspace.bootstrap(null);
      await workspace.createWorkspace({ name: ada.name, emailAddress: ada.emailAddress, passwordDigest: await hashPassword(ada.password) }, "digest", { ip: null, userAgent: null });
      finishReading(null);
      await reading;
    });
    expect((await bootstrap()).helpContact).toEqual({ name: "Ada Lovelace", emailAddress: "ada@example.com" });
  });
});

describe(feature("platform.version"), () => {
  it("is APP_VERSION, else GIT_REVISION, else the release, counting blank values as unset", async () => {
    expect((await bootstrap()).version).toBe("0.1");
    expect((await bootstrap({ APP_VERSION: "1.2.3", GIT_REVISION: "abc123" })).version).toBe("1.2.3");
    expect((await bootstrap({ APP_VERSION: "", GIT_REVISION: "abc123" })).version).toBe("abc123");
    expect((await bootstrap({ APP_VERSION: " ", GIT_REVISION: " " })).version).toBe("0.1");
  });
});
