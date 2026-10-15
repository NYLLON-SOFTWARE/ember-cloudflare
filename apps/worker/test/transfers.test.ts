import { feature } from "@ember/parity";
import type { Me, NewWorkspace, PersonAnswer, ProfileAnswer, UserId } from "@ember/protocol";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { newTransferId, TRANSFER_LINK_EXPIRY_MS, transferredUser } from "../src/transfers";
import { api, apiWith, builtPages, cookieOf, freshDeploy, shown, signIn, workspaceSql, type Session } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };
const SECRET = (env as unknown as Env).SESSION_SECRET;

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

const as = (session?: Session | null): Record<string, string> => (session ? { Cookie: session.cookie } : {});

/** The sign-in link `session`'s profile gives them. */
const yourTransferId = async (session: Session) => ((await (await api("/api/users/me/profile", { headers: as(session) })).json()) as ProfileAnswer).transferId;

/** What someone's page tells `viewer` about `userId`. */
const personAnswer = async (viewer: Session, userId: UserId) => (await (await api(`/api/users/${userId}`, { headers: as(viewer) })).json()) as PersonAnswer;

/** Opens the sign-in link `transferId` in a browser signed in with `session`, if any, as its page does. */
const transfer = (transferId: string, session?: Session | null, init: RequestInit = {}) =>
  api(`/api/session/transfers/${encodeURIComponent(transferId)}`, { method: "PUT", ...init, headers: { ...as(session), ...init.headers } });

/** Who `cookie` signs in, or the status that says nobody. */
async function whoIs(cookie: string): Promise<Me | number> {
  const response = await api("/api/me", { headers: { Cookie: cookie } });
  return response.ok ? ((await response.json()) as { user: Me }).user : response.status;
}

/** Expects `response` to refuse, as ember-rust's empty 400 does, signing nobody in. */
async function expectRefused(response: Response, why: string) {
  expect(response.status, why).toBe(400);
  expect(await response.text(), why).toBe("");
  expect(response.headers.has("Set-Cookie"), why).toBe(false);
}

beforeEach(freshDeploy);

describe(feature("auth.sign-in-link"), () => {
  describe("its id", () => {
    it("names whom it signs in until it expires, 4 hours after it's made", async () => {
      const transferId = await newTransferId("someone", SECRET, 0);
      expect(transferId).toMatch(/^someone\.[0-9a-z]+\.[\w-]+$/);
      expect(await transferredUser(transferId, SECRET, 0)).toBe("someone");
      expect(await transferredUser(transferId, SECRET, TRANSFER_LINK_EXPIRY_MS - 1)).toBe("someone");
      expect(await transferredUser(transferId, SECRET, TRANSFER_LINK_EXPIRY_MS)).toBeNull();
      expect(await transferredUser(await newTransferId("some.one", SECRET, 0), SECRET, 0)).toBe("some.one");
    });

    it("names nobody once changed, or when another secret signed it", async () => {
      const [userId, expiresAt, signature] = (await newTransferId("someone", SECRET, 0)).split(".") as [string, string, string];
      const later = (TRANSFER_LINK_EXPIRY_MS * 2).toString(36);
      const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
      for (const changed of [`another.${expiresAt}.${signature}`, `${userId}.${later}.${signature}`, `${userId}.${expiresAt}.${flipped}`, `${userId}.${expiresAt}.`]) {
        expect(await transferredUser(changed, SECRET, 0), changed).toBeNull();
      }
      expect(await transferredUser(await newTransferId("someone", "another secret", 0), SECRET, 0)).toBeNull();
    });

    it("names nobody when it isn't one", async () => {
      for (const id of ["", "someone", "someone.0", ".", "..", "..signature", "someone..signature", ".0.signature"]) {
        expect(await transferredUser(id, SECRET, 0), id).toBeNull();
      }
    });
  });

  it("comes with your profile, whenever it loads or saves", async () => {
    const administrator = await setUp();
    const loaded = await yourTransferId(administrator);
    expect(await transferredUser(loaded, SECRET, Date.now())).toBe(administrator.user.id);

    const saved = (await (await api("/api/users/me/profile", { method: "PATCH", headers: as(administrator), body: JSON.stringify({ bio: "Countess" }) })).json()) as ProfileAnswer;
    expect(await transferredUser(saved.transferId, SECRET, Date.now())).toBe(administrator.user.id);
  });

  it("comes with the page of anyone active who isn't a bot, themselves included, for administrators only", async () => {
    const administrator = await setUp();
    const people = await Promise.all(["Grace Hopper", "Alan Turing", "Edsger Dijkstra", "Bender"].map((name) => signIn(name)));
    const [grace, banned, removed, bot] = people.map((person) => person.user.id) as [UserId, UserId, UserId, UserId];
    await workspaceSql("UPDATE users SET status = 2 WHERE id = ?", banned);
    await workspaceSql("UPDATE users SET status = 1 WHERE id = ?", removed);
    await workspaceSql("UPDATE users SET role = 2 WHERE id = ?", bot);

    for (const userId of [grace, administrator.user.id]) {
      const { transferId } = await personAnswer(administrator, userId);
      expect(await transferredUser(transferId!, SECRET, Date.now())).toBe(userId);
    }
    for (const userId of [banned, removed, bot]) expect(await personAnswer(administrator, userId), userId).not.toHaveProperty("transferId");
    expect(await personAnswer(people[0]!, administrator.user.id)).not.toHaveProperty("transferId");
    expect(await personAnswer(people[0]!, grace)).not.toHaveProperty("transferId");
  });

  it("signs whoever opens it in as the person it's for, again and again, in sessions of their own", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    const transferId = await yourTransferId(grace);

    for (const browser of [null, administrator, grace]) {
      const response = await transfer(transferId, browser);
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ user: { id: grace.user.id, name: "Grace Hopper", administrator: false } });
      expect(response.headers.get("Set-Cookie")).toMatch(/^__Host-session_token=[\w-]{43}; Path=\/; Max-Age=34560000; HttpOnly; SameSite=Lax; Secure$/);
      const cookie = cookieOf(response);
      expect(cookie).not.toBe(grace.cookie);
      expect(await whoIs(cookie)).toMatchObject({ id: grace.user.id });
    }
    // The sessions the link replaced stay signed in, as ember-rust's do.
    expect(await whoIs(administrator.cookie)).toMatchObject({ id: administrator.user.id });
    expect(await whoIs(grace.cookie)).toMatchObject({ id: grace.user.id });
    expect(await workspaceSql("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?", grace.user.id)).toEqual([{ count: 4 }]);
  });

  it("signs administrators in as administrators", async () => {
    const administrator = await setUp();
    const response = await transfer(await yourTransferId(administrator));
    expect(await response.json()).toEqual({ user: { id: administrator.user.id, name: "Ada Lovelace", administrator: true } });
  });

  it("answers 400 with nothing else for a link that's expired, changed or made up", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    const [, expiresAt, signature] = (await yourTransferId(grace)).split(".") as [string, string, string];

    const refused = {
      expired: await newTransferId(grace.user.id, SECRET, Date.now() - TRANSFER_LINK_EXPIRY_MS - 1),
      "for someone else": `${administrator.user.id}.${expiresAt}.${signature}`,
      "signed with another secret": await newTransferId(grace.user.id, "another secret", Date.now()),
      "for nobody": await newTransferId("nobody", SECRET, Date.now()),
      "made up": "nonsense",
    };
    for (const [why, transferId] of Object.entries(refused)) await expectRefused(await transfer(transferId, administrator), why);
    await expectRefused(await api("/api/session/transfers/%FF", { method: "PUT" }), "not text");
    expect(await whoIs(administrator.cookie)).toMatchObject({ id: administrator.user.id });
  });

  it("answers 400 once the person it's for is banned or removed", async () => {
    await setUp();
    const grace = await signIn("Grace Hopper");
    const transferId = await yourTransferId(grace);

    for (const status of [2, 1]) {
      await workspaceSql("UPDATE users SET status = ? WHERE id = ?", status, grace.user.id);
      await expectRefused(await transfer(transferId), `status ${status}`);
    }
    await workspaceSql("UPDATE users SET status = 0 WHERE id = ?", grace.user.id);
    expect((await transfer(transferId)).status).toBe(201);
  });

  it("answers 400 for someone who signed in with just a name, while EMBER_GUEST_SIGN_IN doesn't allow it", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    const put = (transferId: string, changes: Partial<Env>) => apiWith(changes, `/api/session/transfers/${transferId}`, { method: "PUT" });

    await expectRefused(await put(await yourTransferId(grace), { EMBER_GUEST_SIGN_IN: undefined }), "guest");
    expect((await put(await yourTransferId(administrator), { EMBER_GUEST_SIGN_IN: undefined })).status).toBe(201);
  });

  it("refuses to sign in from other sites", async () => {
    const grace = await signIn("Grace Hopper");
    const response = await transfer(await yourTransferId(grace), null, { headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(response.status).toBe(422);
    expect(response.headers.has("Set-Cookie")).toBe(false);
  });

  it("is the app's page, signed in or out, whatever the id, which no cache keeps", async () => {
    const administrator = await setUp();
    const transferId = await yourTransferId(administrator);
    const page = (path: string, { method, session }: { method?: string; session?: Session } = {}) =>
      apiWith({ ASSETS: builtPages }, path, { method, headers: as(session), redirect: "manual" });

    for (const [path, session] of [
      [`/session/transfers/${transferId}`, undefined],
      [`/session/transfers/${transferId}`, administrator],
      ["/session/transfers/nonsense", undefined],
    ] as const) {
      const response = await page(path, { session });
      expect(response.status, path).toBe(200);
      expect(await response.text()).toBe("page /");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    // ember-rust's page signs in with a PUT to itself, which this one sends to the API.
    expect((await page(`/session/transfers/${transferId}`, { method: "PUT" })).status).toBe(404);
  });
});
