import { feature } from "@ember/parity";
import {
  MEMBERFUL_CALLBACK_PATH,
  MEMBERFUL_SIGN_IN_NEEDED,
  memberfulSignInPath,
  SIGN_IN_REFUSED,
  type Account,
  type Bootstrap,
  type Me,
  type NewWorkspace,
  type Sidebar,
  type UserId,
  type WorkspaceSettings,
} from "@ember/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialsFor, newSessionToken } from "../src/auth";
import type { Env } from "../src/env";
import type { Workspace } from "../src/workspace";
import type { WorkspaceStore } from "../src/workspace-store";
import { api, apiWith, builtPages, cookieOf, freshDeploy, openWorkspaceSocket, origin, shown, workspaceSql, workspaceStub, type Session } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };
const grace = { name: "Grace Hopper", emailAddress: "grace@example.com", password: "compiler" };

/** The Memberful site whose members sign in, and its custom app's keys, as the deployment's secrets give them. */
const SITE = "https://example.memberful.com";
const KEYS = { MEMBERFUL_URL: `${SITE}/`, MEMBERFUL_CLIENT_ID: "ember-client-id", MEMBERFUL_CLIENT_SECRET: "ember-client-secret" };
/** The code Memberful sends the browser back with, and the access token it's exchanged for. */
const CODE = "a-code-from-memberful";
const ACCESS_TOKEN = "an-access-token";
/** Where Memberful sign-ins come from, unless a test says otherwise. */
const IP = "203.0.113.20";

/** A member of the Memberful site as its member API describes them. */
interface MemberfulMember {
  id: string;
  email: string | null;
  fullName: string | null;
  unrestrictedAccess: boolean;
  subscriptions: Array<{ active: boolean }>;
}

/** Katherine, a member of the Memberful site with an active subscription, and no account here yet. */
const katherine: MemberfulMember = {
  id: "4242",
  email: "katherine@example.com",
  fullName: "Katherine Johnson",
  unrestrictedAccess: false,
  subscriptions: [{ active: true }],
};

/** A request the fake Memberful site was sent. */
interface SentToMemberful {
  method: string;
  url: string;
  redirect: string;
  authorization: string | null;
  body: string;
}

/**
 * Stands in for the Memberful site: its token endpoint gives an access token for `CODE` sent with the
 * app's keys, and its member API describes `site.member`, which a test can change, to that token. What
 * it's sent goes in `site.requests`.
 */
function fakeMemberful(member: Partial<MemberfulMember> | null = {}) {
  const site = { member: member && { ...katherine, ...member }, requests: [] as SentToMemberful[] };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    // Read as bytes, which workerd doesn't warn of for a form, as it does reading one as text.
    const body = new TextDecoder().decode(await request.arrayBuffer());
    site.requests.push({ method: request.method, url: request.url, redirect: request.redirect, authorization: request.headers.get("Authorization"), body });
    const url = new URL(request.url);
    if (request.method === "POST" && url.href === `${SITE}/oauth/token`) {
      const form = new URLSearchParams(body);
      const valid =
        form.get("grant_type") === "authorization_code" &&
        form.get("code") === CODE &&
        form.get("client_id") === KEYS.MEMBERFUL_CLIENT_ID &&
        form.get("client_secret") === KEYS.MEMBERFUL_CLIENT_SECRET;
      if (!valid) return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ access_token: ACCESS_TOKEN, token_type: "bearer", expires_in: 900, refresh_token: "a-refresh-token" });
    }
    if (url.origin === SITE && url.pathname === "/api/graphql/member" && request.headers.get("Authorization") === `Bearer ${ACCESS_TOKEN}`) {
      return Response.json({ data: { currentMember: site.member } });
    }
    return new Response("Unauthorized", { status: 401 });
  });
  return site;
}

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

const as = (session?: Session | null): Record<string, string> => (session ? { Cookie: session.cookie } : {});

/** A request to a Worker that has the Memberful keys, answered as the Worker answers it, without following a redirect. `path` may be a whole URL. */
const withKeys = (path: string, init: RequestInit<IncomingRequestCfProperties> = {}) => apiWith(KEYS, path, init);

/** The same, to a Worker without them, as this suite's is. */
const withoutKeys = (path: string, init: RequestInit<IncomingRequestCfProperties> = {}) => apiWith({}, path, init);

/** What `PATCH /api/account` answers `session` for `body`, on a deployment with the Memberful keys unless `keys` is false. */
const change = (session: Session | null, body: unknown, { keys = true } = {}) =>
  apiWith(keys ? KEYS : {}, "/api/account", { method: "PATCH", headers: as(session), body: JSON.stringify(body) });

/** Turns Memberful sign-in on, or off, as `administrator`. */
async function turnMemberful(administrator: Session, on: boolean): Promise<void> {
  const response = await change(administrator, { settings: { memberfulSignIn: on } });
  expect(response.status, await response.clone().text()).toBe(200);
}

/** Sets Ember up with Memberful sign-in on, with Ada as its administrator. */
async function setUpWithMemberful(): Promise<Session> {
  const administrator = await setUp();
  await turnMemberful(administrator, true);
  return administrator;
}

const joinCode = async () => ((await workspaceSql("SELECT join_code FROM accounts")) as Array<{ join_code: string }>)[0]!.join_code;

/** Joins as Grace with the join link, with a password, as people did before Memberful sign-in was on. */
async function joinAsGrace(): Promise<Session> {
  const response = await api(`/api/join/${await joinCode()}`, { method: "POST", body: JSON.stringify(grace) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as { user: Me }).user), cookie: cookieOf(response) };
}

/** A sign-in with an email address and password, from `ip`. */
const signInWithPassword = (body: unknown, ip = IP) => api("/api/session", { method: "POST", headers: { "CF-Connecting-IP": ip }, body: JSON.stringify(body) });

/** Starts signing in with Memberful, coming back to `returnTo` once signed in, if given. */
const start = (returnTo: string | null = null, host = origin) => withKeys(`${host}${memberfulSignInPath(returnTo)}`);

/** The state a start sent the browser to Memberful with, and the cookie it keeps it in. */
function startedWith(started: Response): { state: string; cookie: string } {
  expect(started.status).toBe(302);
  return { state: new URL(started.headers.get("Location")!).searchParams.get("state")!, cookie: cookieOf(started) };
}

/** Where Memberful sends the browser back to, with `params`, from a browser with the cookie `cookie`, at `ip`. */
const callback = (params: Record<string, string>, cookie?: string, ip = IP) =>
  withKeys(`${MEMBERFUL_CALLBACK_PATH}?${new URLSearchParams(params)}`, {
    headers: { "CF-Connecting-IP": ip, "User-Agent": "Katherine's laptop", ...(cookie ? { Cookie: cookie } : {}) },
  });

/** Signs in with Memberful from a new browser, from start to the callback's answer, coming back to `returnTo` if given. */
async function signInWithMemberful({ returnTo = null, ip = IP }: { returnTo?: string | null; ip?: string } = {}): Promise<Response> {
  const { state, cookie } = startedWith(await start(returnTo));
  return callback({ code: CODE, state }, cookie, ip);
}

/** Where an answer sends the browser. */
const locationOf = (response: Response) => response.headers.get("Location");

/** Where the callback sends the browser back to sign in, saying why signing in with Memberful didn't work. */
const backToSignIn = (problem: string) => `${origin}/session/new?memberful=${problem}`;

/** The session a callback's answer signs the browser in with, as the app sees it. */
async function signedInAs(response: Response): Promise<Me> {
  expect(response.status).toBe(302);
  const answer = await api("/api/me", { headers: { Cookie: cookieOf(response) } });
  expect(answer.status).toBe(200);
  return ((await answer.json()) as { user: Me }).user;
}

const count = async (table: string) => ((await workspaceSql(`SELECT count(*) AS n FROM ${table}`)) as Array<{ n: number }>)[0]!.n;

const identities = () => workspaceSql("SELECT issuer, subject, user_id FROM identities");

const bootstrap = async () => (await (await api("/api/bootstrap")).json()) as Bootstrap;

/** The workspace as pages show a new one, with Memberful sign-in on or off. */
const account = (memberfulSignIn: boolean): Account => ({
  name: "Ember",
  hideTranslationButtons: true,
  customStyles: "",
  restrictRoomCreation: false,
  logo: null,
  customDomain: null,
  memberfulSignIn,
});

beforeEach(freshDeploy);
afterEach(() => vi.restoreAllMocks());

describe(feature("auth.memberful-sign-in"), () => {
  describe("the setting", () => {
    it("lets an administrator turn it on once the deployment has the keys, and tells every tab", async () => {
      const administrator = await setUp();
      const socket = await openWorkspaceSocket(administrator);
      const response = await change(administrator, { settings: { memberfulSignIn: true } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ account: account(true) });
      expect(await socket.next()).toEqual({ type: "account.updated", account: account(true) });
      const [{ settings }] = (await workspaceSql("SELECT settings FROM accounts")) as [{ settings: string }];
      expect(JSON.parse(settings)).toMatchObject({ memberful_sign_in: true });
      expect((await bootstrap()).account).toEqual(account(true));

      await turnMemberful(administrator, false);
      expect((await bootstrap()).account).toEqual(account(false));
      socket.ws.close(1000);
    });

    it("names the Memberful site to administrators' settings once the deployment has all three keys, its address's origin", async () => {
      const administrator = await setUp();
      const settings = async (changes = {}) =>
        ((await (await apiWith(changes, "/api/account", { headers: as(administrator) })).json()) as WorkspaceSettings).memberfulSite;
      expect(await settings(KEYS)).toBe(SITE);
      expect(await settings({ ...KEYS, MEMBERFUL_URL: `${SITE}/members?ref=1` })).toBe(SITE);
      expect(await settings()).toBeNull();
      expect(await settings({ ...KEYS, MEMBERFUL_CLIENT_SECRET: " " })).toBeNull();
      // A site Ember would send the client secret to in the clear, or that isn't an address at all, is none.
      expect(await settings({ ...KEYS, MEMBERFUL_URL: "http://example.memberful.com" })).toBeNull();
      expect(await settings({ ...KEYS, MEMBERFUL_URL: "example.memberful.com" })).toBeNull();
    });

    it("can't be turned on until the deployment has the keys, but can be turned off without them", async () => {
      const administrator = await setUp();
      const refused = await change(administrator, { settings: { memberfulSignIn: true } }, { keys: false });
      expect(refused.status).toBe(422);
      expect(await refused.json()).toEqual({ error: "Memberful sign-in needs MEMBERFUL_URL, MEMBERFUL_CLIENT_ID and MEMBERFUL_CLIENT_SECRET set first" });
      expect((await bootstrap()).account.memberfulSignIn).toBe(false);

      await turnMemberful(administrator, true);
      expect((await change(administrator, { settings: { memberfulSignIn: false } }, { keys: false })).status).toBe(200);
      expect((await bootstrap()).account.memberfulSignIn).toBe(false);
    });

    it("is an administrator's to change", async () => {
      await setUp();
      const member = await joinAsGrace();
      expect((await change(member, { settings: { memberfulSignIn: true } })).status).toBe(403);
      expect((await change(null, { settings: { memberfulSignIn: true } })).status).toBe(401);
      expect((await bootstrap()).account.memberfulSignIn).toBe(false);
    });
  });

  describe("while it's on", () => {
    it("turns the join link off: its page sends people to sign in, and its form is refused before it's read", async () => {
      await setUpWithMemberful();
      const code = await joinCode();
      const page = await apiWith({ ASSETS: builtPages }, `/join/${code}`);
      expect(page.status).toBe(302);
      expect(locationOf(page)).toBe(`${origin}/session/new`);
      // A code that isn't the join code is still nothing.
      expect((await apiWith({ ASSETS: builtPages }, "/join/not-the-code")).status).toBe(404);

      const joined = await api(`/api/join/${code}`, { method: "POST", body: JSON.stringify(grace) });
      expect(joined.status).toBe(403);
      expect(await joined.json()).toEqual({ error: MEMBERFUL_SIGN_IN_NEEDED, redirect: "/session/new" });
      expect(joined.headers.get("Set-Cookie")).toBeNull();
      expect(await count("users")).toBe(1);
    });

    it("turns signing in with just a name off", async () => {
      await setUpWithMemberful();
      expect((await bootstrap()).guestSignIn).toBe(false);
      const response = await api("/api/session", { method: "POST", body: JSON.stringify({ name: "Guest" }) });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: MEMBERFUL_SIGN_IN_NEEDED });
      expect(await count("users")).toBe(1);
    });

    it("doesn't add someone with just a name while it's being turned on", async () => {
      const administrator = await setUp();
      const [adas, guests] = await Promise.all(
        [administrator.cookie.split("=")[1]!, newSessionToken()].map((token) => credentialsFor(token, new Request(origin), env as unknown as Env)),
      );
      const signedIn = await runInDurableObject(workspaceStub(), async (workspace: Workspace) => {
        const store = (workspace as unknown as { store: WorkspaceStore }).store;
        const changeAccount = store.changeAccount.bind(store);
        let reach!: () => void;
        const reached = new Promise<void>((resolve) => (reach = resolve));
        let save!: () => void;
        const saving = new Promise<void>((resolve) => (save = resolve));
        // On D1 a sign-in can read the workspace as it was before Memberful sign-in is saved, and add a guest after.
        vi.spyOn(store, "changeAccount").mockImplementationOnce(async (...args) => {
          reach();
          await saving;
          return changeAccount(...args);
        });

        const turningOn = workspace.changeAccount(adas!, { settings: { memberfulSignIn: true } });
        await reached;
        const signingIn = workspace.signInGuest("Guest", guests!.tokenDigest, guests!.client);
        save();
        expect(await turningOn).toMatchObject({ memberfulSignIn: true });
        return signingIn;
      });
      expect(signedIn).toBe("memberful");
      expect(await count("users")).toBe(1);
    });

    it("signs only administrators in with a password, and tells a member so only once their password checks out", async () => {
      const administrator = await setUp();
      await joinAsGrace();
      await turnMemberful(administrator, true);

      expect((await signInWithPassword({ emailAddress: ada.emailAddress, password: ada.password })).status).toBe(201);
      const member = await signInWithPassword({ emailAddress: grace.emailAddress, password: grace.password });
      expect(member.status).toBe(403);
      expect(await member.json()).toEqual({ error: MEMBERFUL_SIGN_IN_NEEDED });
      expect(member.headers.get("Set-Cookie")).toBeNull();
      // A wrong password says nothing of whether there's an account.
      const wrong = await signInWithPassword({ emailAddress: grace.emailAddress, password: "wrong" });
      expect(wrong.status).toBe(401);
      expect(await wrong.json()).toEqual({ error: SIGN_IN_REFUSED });
    });

    it("doesn't sign in an administrator made a member while their sign-in was checked", async () => {
      const administrator = await setUp();
      const member = await joinAsGrace();
      const promoted = await api(`/api/account/users/${member.user.id}`, { method: "PATCH", headers: as(administrator), body: JSON.stringify({ role: "administrator" }) });
      expect(promoted.status).toBe(200);
      await turnMemberful(administrator, true);
      // As if she had a password, which the sign-in checked.
      await workspaceSql("UPDATE users SET password_digest = ? WHERE id = ?", "checked", member.user.id);
      const [adas, laptop] = await Promise.all(
        [administrator.cookie.split("=")[1]!, newSessionToken()].map((token) => credentialsFor(token, new Request(origin), env as unknown as Env)),
      );
      const [signedIn, signedInNow] = await runInDurableObject(workspaceStub(), async (workspace: Workspace) => {
        const store = (workspace as unknown as { store: WorkspaceStore }).store;
        const isAdministrator = store.isAdministrator.bind(store);
        let read!: () => void;
        const reading = new Promise<void>((resolve) => (read = resolve));
        let answer!: () => void;
        const answering = new Promise<void>((resolve) => (answer = resolve));
        // On D1 a sign-in can read Grace as an administrator, and start her session only once she's a member.
        vi.spyOn(store, "isAdministrator").mockImplementationOnce(async (userId) => {
          const was = await isAdministrator(userId);
          read();
          await answering;
          return was;
        });

        const signingIn = workspace.startSession(member.user.id, "checked", null, laptop!.tokenDigest, laptop!.client);
        await reading;
        expect(await workspace.changeRole(adas!, member.user.id, "member")).toMatchObject({ role: "member" });
        answer();
        return [await signingIn, await workspace.me(laptop!)];
      });
      expect(signedIn).toBeNull();
      expect(signedInNow).toBeNull();
    });

    it("leaves the sessions people have signed in", async () => {
      const administrator = await setUp();
      const member = await joinAsGrace();
      await turnMemberful(administrator, true);
      expect((await api("/api/me", { headers: as(member) })).status).toBe(200);
    });
  });

  describe("Sign in with Memberful", () => {
    it("sends the browser to sign in at Memberful with a new state, which a cookie keeps for 10 minutes", async () => {
      await setUpWithMemberful();
      const response = await start("/rooms/abc?tab=pins");
      expect(response.status).toBe(302);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const location = new URL(locationOf(response)!);
      expect(`${location.origin}${location.pathname}`).toBe(`${SITE}/oauth`);
      expect([...location.searchParams.keys()]).toEqual(["response_type", "client_id", "state"]);
      expect(location.searchParams.get("response_type")).toBe("code");
      expect(location.searchParams.get("client_id")).toBe(KEYS.MEMBERFUL_CLIENT_ID);
      const state = location.searchParams.get("state")!;
      expect(state).toMatch(/^[\w-]{43}$/);
      expect(response.headers.getSetCookie()).toEqual([
        expect.stringMatching(new RegExp(`^__Host-memberful_state=${state}\\.[\\w-]+; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure$`)),
      ]);
      expect(startedWith(await start()).state).not.toBe(state);
    });

    it("goes back to sign in while it's off, or the deployment lacks the keys, which sign in then says", async () => {
      const administrator = await setUp();
      expect(locationOf(await start())).toBe(backToSignIn("off"));
      await turnMemberful(administrator, true);
      const unavailable = await withoutKeys(memberfulSignInPath(null));
      expect(unavailable.status).toBe(302);
      expect(locationOf(unavailable)).toBe(backToSignIn("unavailable"));
      expect(unavailable.headers.get("Set-Cookie")).toBeNull();
    });

    it("goes home before Ember is set up", async () => {
      const response = await start();
      expect(response.status).toBe(302);
      expect(locationOf(response)).toBe(`${origin}/`);
    });

    it("starts at Ember's custom domain, where Memberful sends the browser back", async () => {
      const administrator = await setUpWithMemberful();
      const used = await apiWith({}, "https://chat.example.com/api/account", {
        method: "PATCH",
        headers: as(administrator),
        body: JSON.stringify({ customDomain: "chat.example.com" }),
      });
      expect(used.status).toBe(200);
      const moved = await start("/rooms/abc");
      expect(moved.status).toBe(302);
      expect(locationOf(moved)).toBe("https://chat.example.com/auth/memberful?return_to=%2Frooms%2Fabc");
      expect(moved.headers.get("Set-Cookie")).toBeNull();
      expect(new URL(locationOf(await start("/rooms/abc", "https://chat.example.com"))!).origin).toBe(SITE);
    });
  });

  describe("coming back from Memberful", () => {
    it("signs in someone new with an active membership as a member in every open room, linked to their Memberful account", async () => {
      await setUpWithMemberful();
      const site = fakeMemberful();
      const response = await signInWithMemberful({ returnTo: "/rooms/abc?tab=pins#latest" });
      expect(response.status).toBe(302);
      expect(locationOf(response)).toBe(`${origin}/rooms/abc?tab=pins#latest`);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.getSetCookie()).toEqual([
        expect.stringMatching(/^__Host-session_token=[\w-]{43}; Path=\/; Max-Age=34560000; HttpOnly; SameSite=Lax; Secure$/),
        "__Host-memberful_state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
      ]);

      const user = await signedInAs(response);
      expect(user).toEqual({ id: expect.any(String), name: "Katherine Johnson", administrator: false });
      const [stored] = (await workspaceSql("SELECT name, email_address, password_digest, role, status, guest FROM users WHERE id = ?", user.id)) as Array<
        Record<string, unknown>
      >;
      expect(stored).toEqual({ name: "Katherine Johnson", email_address: "katherine@example.com", password_digest: null, role: 0, status: 0, guest: 0 });
      expect(await identities()).toEqual([{ issuer: SITE, subject: "4242", user_id: user.id }]);
      expect(await workspaceSql("SELECT ip_address, user_agent FROM sessions WHERE user_id = ?", user.id)).toEqual([
        { ip_address: IP, user_agent: "Katherine's laptop" },
      ]);
      const { rooms } = (await (await api("/api/sidebar", { headers: { Cookie: cookieOf(response) } })).json()) as Sidebar;
      expect(rooms.map((room) => room.kind !== "direct" && room.name)).toEqual(["general", "random"]);

      // The code went to Memberful's token endpoint with the app's keys, and the token to its member API, neither following a redirect.
      expect(site.requests.map(({ method, url, redirect }) => [method, new URL(url).pathname, redirect])).toEqual([
        ["POST", "/oauth/token", "manual"],
        ["GET", "/api/graphql/member", "manual"],
      ]);
      expect(Object.fromEntries(new URLSearchParams(site.requests[0]!.body))).toEqual({
        grant_type: "authorization_code",
        code: CODE,
        client_id: KEYS.MEMBERFUL_CLIENT_ID,
        client_secret: KEYS.MEMBERFUL_CLIENT_SECRET,
      });
      expect(site.requests[1]!.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(new URL(site.requests[1]!.url).searchParams.get("query")).toContain("currentMember");
    });

    it("signs the same person in again by their Memberful account, whatever its name and email address are now", async () => {
      await setUpWithMemberful();
      const site = fakeMemberful();
      const first = await signedInAs(await signInWithMemberful());
      site.member = { ...katherine, fullName: "Katherine G. Johnson", email: "kgj@example.com" };
      expect(await signedInAs(await signInWithMemberful())).toEqual(first);
      expect(await count("users")).toBe(2);
      expect(await count("identities")).toBe(1);
      expect(await workspaceSql("SELECT count(*) AS n FROM sessions WHERE user_id = ?", first.id)).toEqual([{ n: 2 }]);
    });

    it("never matches an account by email address: someone new with one someone here has is told so, and nothing is created", async () => {
      await setUpWithMemberful();
      fakeMemberful({ email: ada.emailAddress });
      const response = await signInWithMemberful();
      expect(locationOf(response)).toBe(backToSignIn("taken"));
      expect(response.headers.getSetCookie()).toEqual(["__Host-memberful_state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"]);
      expect(await count("users")).toBe(1);
      expect(await count("identities")).toBe(0);
    });

    it("tells someone without an active membership so, and creates nothing", async () => {
      await setUpWithMemberful();
      fakeMemberful({ subscriptions: [{ active: false }] });
      expect(locationOf(await signInWithMemberful())).toBe(backToSignIn("membership"));
      fakeMemberful({ subscriptions: [] });
      expect(locationOf(await signInWithMemberful())).toBe(backToSignIn("membership"));
      expect(await count("users")).toBe(1);
    });

    it("takes the all access pass as a membership", async () => {
      await setUpWithMemberful();
      fakeMemberful({ unrestrictedAccess: true, subscriptions: [] });
      expect((await signedInAs(await signInWithMemberful())).name).toBe("Katherine Johnson");
    });

    it("tells a member whose membership has lapsed so, but signs an administrator in without one", async () => {
      const administrator = await setUpWithMemberful();
      const site = fakeMemberful();
      const { id } = await signedInAs(await signInWithMemberful());
      site.member = { ...katherine, subscriptions: [{ active: false }] };
      expect(locationOf(await signInWithMemberful())).toBe(backToSignIn("membership"));

      const promoted = await api(`/api/account/users/${id}`, { method: "PATCH", headers: as(administrator), body: JSON.stringify({ role: "administrator" }) });
      expect(promoted.status).toBe(200);
      expect(await signedInAs(await signInWithMemberful())).toEqual({ id, name: "Katherine Johnson", administrator: true });
    });

    it("refuses someone linked who has been removed", async () => {
      const administrator = await setUpWithMemberful();
      fakeMemberful();
      const { id } = await signedInAs(await signInWithMemberful());
      expect((await api(`/api/account/users/${id}`, { method: "DELETE", headers: as(administrator) })).status).toBe(200);
      const response = await signInWithMemberful();
      expect(locationOf(response)).toBe(backToSignIn("refused"));
      expect(await workspaceSql("SELECT count(*) AS n FROM sessions WHERE user_id = ?", id)).toEqual([{ n: 0 }]);
    });

    it("names someone new by their email address without a full name, and Member without either, cutting a long name", async () => {
      await setUpWithMemberful();
      const site = fakeMemberful({ fullName: " " });
      expect((await signedInAs(await signInWithMemberful())).name).toBe("katherine");
      site.member = { ...katherine, id: "4243", fullName: null, email: null };
      const unnamed = await signedInAs(await signInWithMemberful());
      expect(unnamed.name).toBe("Member");
      expect(await workspaceSql("SELECT email_address FROM users WHERE id = ?", unnamed.id)).toEqual([{ email_address: null }]);
      site.member = { ...katherine, id: "4244", fullName: `${"K".repeat(99)}😀`, email: "long@example.com" };
      expect((await signedInAs(await signInWithMemberful())).name).toBe("K".repeat(99));
    });

    it("signs nobody in with a state this browser didn't start with, or without a code, and asks Memberful nothing", async () => {
      await setUpWithMemberful();
      const site = fakeMemberful();
      const { state, cookie } = startedWith(await start());
      for (const [params, sent] of [
        [{ code: CODE, state: "someone-elses-state" }, cookie],
        [{ code: CODE, state }, undefined],
        [{ code: CODE }, cookie],
        [{ state }, cookie],
        [{ code: CODE, state }, `${cookie.split(".")[0]}`],
      ] as Array<[Record<string, string>, string | undefined]>) {
        const response = await callback(params, sent);
        expect(locationOf(response), JSON.stringify(params)).toBe(backToSignIn("failed"));
        expect(response.headers.getSetCookie()).toEqual(["__Host-memberful_state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"]);
      }
      expect(site.requests).toEqual([]);
      expect(await count("users")).toBe(1);
    });

    it("signs nobody in when Memberful refuses the code, or doesn't answer as it should", async () => {
      await setUpWithMemberful();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { state, cookie } = startedWith(await start());
      fakeMemberful();
      expect(locationOf(await callback({ code: "a-code-memberful-never-gave", state }, cookie))).toBe(backToSignIn("failed"));
      expect(error).toHaveBeenLastCalledWith("Memberful's token endpoint answered 400");

      fakeMemberful(null);
      expect(locationOf(await signInWithMemberful())).toBe(backToSignIn("failed"));
      expect(error).toHaveBeenLastCalledWith("Memberful's member endpoint answered 200 without what it should");
      fakeMemberful({ id: 4242 as unknown as string });
      expect(locationOf(await signInWithMemberful())).toBe(backToSignIn("failed"));

      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network connection lost"));
      expect(locationOf(await signInWithMemberful())).toBe(backToSignIn("failed"));
      expect(error).toHaveBeenLastCalledWith("Signing in with Memberful failed:", "TypeError");
      expect(await count("users")).toBe(1);
      // Nothing Memberful sent, nor the keys, reaches the log.
      expect(JSON.stringify(error.mock.calls)).not.toMatch(/ember-client-secret|an-access-token|katherine/);
    });

    it("counts each try against the address's sign-in limit, which password sign-ins share", async () => {
      await setUpWithMemberful();
      const site = fakeMemberful();
      for (let attempt = 0; attempt < 10; attempt++) expect((await signInWithPassword({ emailAddress: ada.emailAddress, password: "wrong" })).status).toBe(401);
      expect(locationOf(await signInWithMemberful())).toBe(backToSignIn("refused"));
      expect(site.requests).toEqual([]);
      expect((await signedInAs(await signInWithMemberful({ ip: "203.0.113.21" }))).name).toBe("Katherine Johnson");
    });

    it("answers 429 to an address that's banned", async () => {
      const administrator = await setUpWithMemberful();
      fakeMemberful();
      // Banning Katherine bans the address she signed in from.
      const banned: UserId = (await signedInAs(await signInWithMemberful({ ip: "203.0.113.66" }))).id;
      expect((await api(`/api/users/${banned}/ban`, { method: "POST", headers: as(administrator) })).status).toBe(200);
      const response = await signInWithMemberful({ ip: "203.0.113.66" });
      expect(response.status).toBe(429);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    });

    it("goes home, rather than to another site or a page that isn't the workspace's, after signing in", async () => {
      await setUpWithMemberful();
      fakeMemberful();
      // The last is short, but too long to keep once its address escapes it.
      for (const returnTo of [
        "https://example.com/rooms/abc",
        "//example.com/rooms/abc",
        "/api/me",
        `/rooms/${"a".repeat(1024)}`,
        `/rooms/abc?q=${"é".repeat(200)}`,
      ]) {
        expect(locationOf(await signInWithMemberful({ returnTo })), returnTo).toBe(`${origin}/`);
      }
      expect(locationOf(await signInWithMemberful())).toBe(`${origin}/`);
    });

    it("signs nobody in once an administrator has turned it off, or the deployment has lost the keys", async () => {
      const administrator = await setUpWithMemberful();
      fakeMemberful();
      const { state, cookie } = startedWith(await start());
      await turnMemberful(administrator, false);
      expect(locationOf(await callback({ code: CODE, state }, cookie))).toBe(backToSignIn("off"));

      await turnMemberful(administrator, true);
      const again = startedWith(await start());
      const unavailable = await withoutKeys(`${MEMBERFUL_CALLBACK_PATH}?${new URLSearchParams({ code: CODE, state: again.state })}`, {
        headers: { Cookie: again.cookie },
      });
      expect(locationOf(unavailable)).toBe(backToSignIn("unavailable"));
      expect(await count("users")).toBe(1);
    });
  });
});
