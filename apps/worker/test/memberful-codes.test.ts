import {
  CANT_EMAIL_CODES,
  EMAIL_ADDRESS_NEEDED,
  EMAILS_PER_ADDRESS,
  MEMBERFUL_CODE_NO_MEMBER,
  MEMBERFUL_CODE_UNCHECKED,
  MEMBERFUL_CODES_OFF,
  MEMBERFUL_SIGN_IN_PROBLEMS,
  PASSWORD_RESET_CODE_MINUTES,
  PASSWORD_RESET_CODE_NEEDED,
  PASSWORD_RESET_CODE_TRIES,
  PASSWORD_RESET_CODE_WRONG,
  PASSWORD_RESETS_LIMITED,
  PASSWORD_RESETS_PER_NETWORK,
  SIGN_IN_LIMITED,
  TURNSTILE_FAILED,
  type AccountSettings,
  type Bootstrap,
  type Me,
  type MemberfulCodeSignedIn,
  type NewWorkspace,
} from "@ember/protocol";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import type { Workspace } from "../src/workspace";
import { api, apiWith, cookieOf, freshDeploy, shown, withWorkspaceEnv, workspaceSql, workspaceStub, type Session } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };

/** The Memberful site whose members sign in, and its custom app's keys, with the API key that finds a member by email address. */
const SITE = "https://example.memberful.com";
const API_KEY = "ember-api-key";
const SIGN_IN_KEYS = { MEMBERFUL_URL: `${SITE}/`, MEMBERFUL_CLIENT_ID: "ember-client-id", MEMBERFUL_CLIENT_SECRET: "ember-client-secret" };
const KEYS = { ...SIGN_IN_KEYS, MEMBERFUL_API_KEY: API_KEY };
/** Turnstile's test keys, which this suite's fake siteverify takes. */
const TURNSTILE_KEYS = { TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" };
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const FROM = "Ember <ember@example.com>";
/** Sign-in's limit: the passwords, and codes, an IP address may try in 3 minutes. */
const SIGN_IN_ATTEMPTS = 10;

/** A member of the Memberful site as its admin API describes them. */
interface MemberfulMember {
  id: string;
  email: string | null;
  fullName: string | null;
  unrestrictedAccess: boolean;
  subscriptions: Array<{ active: boolean }>;
}

/** Katherine, a member of the Memberful site with an active subscription, and no account here yet. */
const katherine: MemberfulMember = { id: "4242", email: "katherine@example.com", fullName: "Katherine Johnson", unrestrictedAccess: false, subscriptions: [{ active: true }] };
/** Dorothy, another member of the Memberful site with an active subscription. */
const dorothy: MemberfulMember = { ...katherine, id: "4243", email: "dorothy@example.com", fullName: "Dorothy Vaughan" };

/** A type as introspection describes one: named, or required. */
const named = (kind: string, name: string) => ({ kind, name, ofType: null });
const required = (type: ReturnType<typeof named>) => ({ kind: "NON_NULL", name: null, ofType: type });

/** The queries the admin API's schema has, as introspection describes them, which don't say which finds a member by email address. */
const SCHEMA = {
  __schema: {
    queryType: {
      fields: [
        { name: "member", type: named("OBJECT", "Member"), args: [{ name: "id", defaultValue: null, type: required(named("SCALAR", "ID")) }] },
        { name: "memberByEmail", type: named("OBJECT", "Member"), args: [{ name: "email", defaultValue: null, type: required(named("SCALAR", "String")) }] },
        { name: "members", type: required(named("OBJECT", "MemberConnection")), args: [{ name: "first", defaultValue: null, type: named("SCALAR", "Int") }] },
      ],
    },
  },
};

/** A request the fake Memberful site's admin API was sent. */
interface SentToMemberful {
  query: string;
  variables?: { email?: unknown };
  authorization: string | null;
}

/**
 * Stands in for the Memberful site's admin API, and Turnstile's siteverify: to the app's API key, it
 * describes its schema as `site.schema` says, and finds `site.members` by email address, whatever its
 * case, with the query that schema has, answering 502 while `site.down`. Siteverify passes every check.
 * What either is sent goes in `site.requests` and `site.checks`.
 */
function fakeMemberful(members: MemberfulMember[] = [katherine]) {
  const site = { members, schema: SCHEMA as unknown, down: false, requests: [] as SentToMemberful[], checks: [] as unknown[] };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      site.checks.push(await request.json());
      return Response.json({ success: true });
    }
    if (request.method !== "POST" || request.url !== `${SITE}/api/graphql`) return new Response("Not found", { status: 404 });
    const body = (await request.json()) as Omit<SentToMemberful, "authorization">;
    site.requests.push({ ...body, authorization: request.headers.get("Authorization") });
    // As Memberful answers a wrong key: 200, with errors and no data.
    if (request.headers.get("Authorization") !== `Bearer ${API_KEY}`) return Response.json({ errors: [{ message: "Invalid authentication token." }] });
    if (site.down) return new Response("Bad gateway", { status: 502 });
    if (body.query.includes("__schema")) return Response.json({ data: site.schema });
    if (!body.query.includes("member: memberByEmail(email: $email)")) return Response.json({ errors: [{ message: "Unknown query" }] });
    const email = String(body.variables?.email).toLowerCase();
    return Response.json({ data: { member: site.members.find((member) => member.email?.toLowerCase() === email) ?? null } });
  });
  return site;
}

/** Whom each request to the fake site's admin API asked after: the schema, or an email address. */
const askedAfter = (requests: SentToMemberful[]) => requests.map(({ query, variables }) => (query.includes("__schema") ? "schema" : variables?.email));

const as = (session?: Session | null): Record<string, string> => (session ? { Cookie: session.cookie } : {});

/** Changes the workspace as `administrator`, as its settings save it, on a deployment with the Memberful keys. */
async function change(administrator: Session, body: unknown): Promise<void> {
  const response = await apiWith(KEYS, "/api/account", { method: "PATCH", headers: as(administrator), body: JSON.stringify(body) });
  expect(response.status, await response.clone().text()).toBe(200);
}

/** Sets Ember up with Ada as its administrator, signed in, sending email from `FROM`, with Memberful on, and members only unless `membersOnly` is false. */
async function setUp({ memberful = true, membersOnly = true } = {}): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  const administrator = { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
  const settings: AccountSettings = { memberfulJoin: memberful, memberfulSignIn: memberful && membersOnly };
  await change(administrator, { emailFrom: FROM, settings });
  return administrator;
}

let addresses = 0;
/** An IP address of its own for each request, so that no limit is reached unless a test means it to be. */
const nextAddress = () => `198.51.100.${++addresses % 250}`;

/** Asks for a code to sign in with `emailAddress`, as the sign-in card's first form does, to a Worker with `keys`. */
const ask = (emailAddress: unknown, { ip = nextAddress(), keys = KEYS, turnstileToken }: { ip?: string; keys?: Partial<Env>; turnstileToken?: string } = {}) =>
  apiWith(keys, "/api/memberful_codes", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
    body: JSON.stringify({ emailAddress, ...(turnstileToken !== undefined && { turnstileToken }) }),
  });

/** Signs in with `code` for `emailAddress`, as the sign-in card's second form does, to a Worker with `keys`. */
const signInWith = (emailAddress: unknown, code: unknown, { ip = nextAddress(), keys = KEYS }: { ip?: string; keys?: Partial<Env> } = {}) =>
  apiWith(keys, "/api/memberful_codes", { method: "PUT", headers: { "CF-Connecting-IP": ip, "User-Agent": "Katherine's phone" }, body: JSON.stringify({ emailAddress, code }) });

/** The answer to a code that doesn't work. */
async function expectWrong(response: Response): Promise<void> {
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: PASSWORD_RESET_CODE_WRONG, field: "code" });
}

/** Stands in for Cloudflare Email Service's binding, keeping what it's asked to send, and throwing what `refusal` gives, if anything. */
function fakeBinding(refusal: () => unknown = () => undefined) {
  const sent: EmailMessageBuilder[] = [];
  const binding = {
    send: async (message: EmailMessageBuilder) => {
      sent.push(message);
      const refused = refusal();
      if (refused !== undefined) throw refused;
      return { messageId: `<${crypto.randomUUID()}@example.com>` };
    },
  } as unknown as SendEmail;
  return { binding, sent };
}

/** Waits for the emails the Workspace is sending, which it sends once it has answered. */
const emailed = () =>
  runInDurableObject(workspaceStub(), async (instance: Workspace) => {
    const { emailsOnTheirWay } = instance as unknown as { emailsOnTheirWay: Map<string, { last: Promise<unknown> }> };
    await Promise.all(Array.from(emailsOnTheirWay.values(), ({ last }) => last));
  });

/** Runs `run` with the Workspace sending email through a fake binding, answering what it was asked to send once it has sent it. */
async function emailing(run: () => Promise<void>, refusal?: () => unknown): Promise<EmailMessageBuilder[]> {
  const { binding, sent } = fakeBinding(refusal);
  await withWorkspaceEnv({ EMAIL: binding }, async () => {
    await run();
    await emailed();
  });
  return sent;
}

/** Asks for a code for `emailAddress`, which has to be answered as asked, answering the emails Ember sent. */
async function asked(emailAddress: string, options: Parameters<typeof ask>[1] = {}): Promise<EmailMessageBuilder[]> {
  return emailing(async () => {
    const response = await ask(emailAddress, options);
    expect(response.status, await response.clone().text()).toBe(202);
    expect(await response.json()).toEqual({});
  });
}

/** The code in an email. */
const codeIn = (email: EmailMessageBuilder) => /Your code: (\d+)/.exec(email.text ?? "")![1]!;

/** Asks for a code for `emailAddress`, which a member has, answering the code Ember emailed. */
async function codeFor(emailAddress: string): Promise<string> {
  const [email, ...more] = await asked(emailAddress);
  expect(more).toEqual([]);
  return codeIn(email!);
}

/** A code that isn't `code`. */
const otherThan = (code: string) => (code === "00000000" ? "11111111" : "00000000");

const count = async (table: string) => ((await workspaceSql(`SELECT count(*) AS n FROM ${table}`)) as Array<{ n: number }>)[0]!.n;

/** Who an answer's session signs in, as the app sees them. */
async function signedInAs(response: Response): Promise<Me> {
  const answer = await api("/api/me", { headers: { Cookie: cookieOf(response) } });
  expect(answer.status).toBe(200);
  return ((await answer.json()) as { user: Me }).user;
}

const bootstrap = async (keys: Partial<Env> = KEYS) => (await (await apiWith(keys, "/api/bootstrap")).json()) as Bootstrap;

/** Katherine's password, once she has an account here. */
const PASSWORD = "hidden figures";

/** The session an answer to joining starts. */
const sessionOf = async (joined: Response): Promise<Session> => ({ user: shown(((await joined.json()) as { user: Me }).user), cookie: cookieOf(joined) });

/** Joins as Katherine with the join link, with a password, as people do before Memberful is members only, which proves nothing of her address. */
async function joinWithLink(): Promise<Session> {
  const [{ join_code }] = (await workspaceSql("SELECT join_code FROM accounts")) as [{ join_code: string }];
  const joined = await api(`/api/join/${join_code}`, { method: "POST", body: JSON.stringify({ name: katherine.fullName, emailAddress: katherine.email, password: PASSWORD }) });
  expect(joined.status, await joined.clone().text()).toBe(201);
  return sessionOf(joined);
}

/** Invites Katherine by email as `administrator`, and joins with the link Ember emails her, which proves her address is hers. */
async function joinWithInvitation(administrator: Session): Promise<Session> {
  const [invitation, ...more] = await emailing(async () => {
    const invited = await api("/api/invitations", { method: "POST", headers: as(administrator), body: JSON.stringify({ emailAddresses: [katherine.email] }) });
    expect(invited.status, await invited.clone().text()).toBe(200);
  });
  expect(more).toEqual([]);
  const token = /#token=(\S+)/.exec(invitation!.text ?? "")![1]!;
  const joined = await api("/api/join/invitation", { method: "POST", body: JSON.stringify({ name: katherine.fullName, password: PASSWORD, token }) });
  expect(joined.status, await joined.clone().text()).toBe(201);
  return sessionOf(joined);
}

/** Whether Katherine's password signs her in. */
const passwordSignsIn = async () =>
  (await api("/api/session", { method: "POST", headers: { "CF-Connecting-IP": nextAddress() }, body: JSON.stringify({ emailAddress: katherine.email, password: PASSWORD }) })).status === 201;

/** The answer to a code that works for someone here with the address already, who connects their Memberful account with their password. */
async function expectTaken(response: Response): Promise<void> {
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: MEMBERFUL_SIGN_IN_PROBLEMS.taken, field: "password" });
  expect(response.headers.get("Set-Cookie")).toBeNull();
  expect(await count("identities")).toBe(0);
}

beforeEach(freshDeploy);
afterEach(() => vi.restoreAllMocks());

describe("Sign in with a code Ember emails a Memberful member", () => {
  it("is offered while the sign-in page offers Sign in with Memberful, Ember can send email, and it has the custom app's API key", async () => {
    expect((await bootstrap()).memberfulCodes).toBe(false);
    const administrator = await setUp({ memberful: false });
    expect((await bootstrap()).memberfulCodes).toBe(false);
    await change(administrator, { settings: { memberfulJoin: true } });
    expect(await bootstrap()).toMatchObject({ signInWithMemberful: true, memberfulCodes: true });
    // The deployment's keys may lack the API key, which finds a member by email address.
    expect(await bootstrap(SIGN_IN_KEYS)).toMatchObject({ signInWithMemberful: true, memberfulCodes: false });
    await withWorkspaceEnv({ EMAIL: undefined }, async () => expect(await bootstrap()).toMatchObject({ signInWithMemberful: true, memberfulCodes: false }));
    await change(administrator, { emailFrom: null });
    expect((await bootstrap()).memberfulCodes).toBe(false);
  });

  describe("asking for a code", () => {
    it(`emails a member of the Memberful site a code that works for ${PASSWORD_RESET_CODE_MINUTES} minutes, once its admin API finds them, keeping only its digest`, async () => {
      await setUp();
      const site = fakeMemberful();
      const [email, ...more] = await asked("Katherine@Example.com ");
      expect(more).toEqual([]);
      const code = codeIn(email!);
      expect(code).toMatch(/^[0-9]{8}$/);
      expect(email).toEqual({
        from: { name: "Ember", email: "ember@example.com" },
        to: "Katherine@Example.com",
        subject: "Sign in to Ember",
        text: `Someone asked to sign in to Ember with the Memberful account that has this email address.\n\nYour code: ${code}\n\nEnter it within ${PASSWORD_RESET_CODE_MINUTES} minutes, where you asked for it. Don't give it to anyone.\n\nIf you didn't ask, you can ignore this email: nobody signs in without the code.\n`,
        html: expect.stringContaining(`>${code}</strong>`) as unknown,
      });

      // The query that finds a member by email address is the one the schema has, asked with the API key.
      expect(site.requests.map(({ authorization }) => authorization)).toEqual([`Bearer ${API_KEY}`, `Bearer ${API_KEY}`]);
      expect(askedAfter(site.requests)).toEqual(["schema", "Katherine@Example.com"]);
      expect(site.requests[1]!.query).toBe(
        "query ($email: String!) { member: memberByEmail(email: $email) { id email fullName unrestrictedAccess subscriptions { active } } }",
      );

      const [row] = (await workspaceSql("SELECT email_address, code_digest, site, created_at, expires_at, attempts FROM memberful_codes")) as Array<Record<string, string | number>>;
      expect(row).toMatchObject({ email_address: "katherine@example.com", site: SITE, attempts: 0 });
      expect(row!.code_digest).not.toContain(code);
      expect(Date.parse(row!.expires_at as string) - Date.parse(row!.created_at as string)).toBe(PASSWORD_RESET_CODE_MINUTES * 60 * 1000);
      expect(await workspaceSql("SELECT email_address, count FROM email_link_requests")).toEqual([{ email_address: "katherine@example.com", count: 1 }]);
    });

    it("answers the same for an address nobody at Memberful has, emailing it nothing", async () => {
      await setUp();
      const site = fakeMemberful();
      expect(await asked("nobody@example.com")).toEqual([]);
      expect(askedAfter(site.requests)).toEqual(["schema", "nobody@example.com"]);
      expect(await count("memberful_codes")).toBe(0);
      expect(await count("email_link_requests")).toBe(0);
    });

    it("reads the schema once, while the site and API key stay the same", async () => {
      await setUp();
      const site = fakeMemberful();
      await codeFor("katherine@example.com");
      await codeFor("katherine@example.com");
      expect(askedAfter(site.requests)).toEqual(["schema", "katherine@example.com", "katherine@example.com"]);
    });

    it("emails nothing while Memberful can't be asked, or has no one query that finds a member by email address, and reads the schema again", async () => {
      await setUp();
      const site = fakeMemberful();
      site.down = true;
      expect(await asked("katherine@example.com")).toEqual([]);
      site.down = false;
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const fields = SCHEMA.__schema.queryType.fields;
      for (const schema of [
        { __schema: { queryType: { fields: fields.filter(({ name }) => name !== "memberByEmail") } } },
        // Two that would, which only a person could choose between.
        { __schema: { queryType: { fields: [...fields, { ...fields[1]!, name: "memberWithEmail" }] } } },
        // One that answers a list, or needs more than the address.
        { __schema: { queryType: { fields: [{ ...fields[1]!, type: required({ kind: "LIST", name: null, ofType: named("OBJECT", "Member") } as never) }] } } },
        { __schema: { queryType: { fields: [{ ...fields[1]!, args: [...fields[1]!.args, { name: "site", defaultValue: null, type: required(named("SCALAR", "ID")) }] }] } } },
      ]) {
        site.schema = schema;
        expect(await asked("katherine@example.com")).toEqual([]);
      }
      expect(error).toHaveBeenCalledWith("Memberful's admin API has no one query that finds a member by email address, so Ember emails no member a code to sign in with");
      expect(askedAfter(site.requests)).toEqual(["schema", "schema", "schema", "schema", "schema"]);
      expect(await count("memberful_codes")).toBe(0);

      // A query that takes more, but needs none of it, does.
      site.schema = { __schema: { queryType: { fields: [{ ...fields[1]!, args: [...fields[1]!.args, { name: "site", defaultValue: null, type: named("SCALAR", "ID") }] }] } } };
      await codeFor("katherine@example.com");
    });

    it(`emails an address ${EMAILS_PER_ADDRESS} times an hour, whoever asks, counting with the links to join and codes to reset a password Ember emails it`, async () => {
      await setUp();
      const site = fakeMemberful();
      const sent = await emailing(async () => {
        for (let n = 0; n <= EMAILS_PER_ADDRESS; n++) expect((await ask("katherine@example.com")).status).toBe(202);
      });
      expect(sent).toHaveLength(EMAILS_PER_ADDRESS);
      expect(await workspaceSql("SELECT count FROM email_link_requests")).toEqual([{ count: EMAILS_PER_ADDRESS }]);
      // Memberful isn't asked about an address Ember wouldn't email.
      expect(askedAfter(site.requests)).toEqual(["schema", ...Array<string>(EMAILS_PER_ADDRESS).fill("katherine@example.com")]);
      // Only the code emailed last works.
      await expectWrong(await signInWith("katherine@example.com", codeIn(sent[0]!)));
      expect((await signInWith("katherine@example.com", codeIn(sent.at(-1)!))).status).toBe(201);
    });

    it("counts no email the provider refuses, which changes no code", async () => {
      await setUp();
      fakeMemberful();
      const code = await codeFor("katherine@example.com");
      const sent = await emailing(
        async () => void expect((await ask("katherine@example.com")).status).toBe(202),
        () => new Error("The provider refused it"),
      );
      expect(sent).toHaveLength(1);
      expect(await workspaceSql("SELECT count FROM email_link_requests")).toEqual([{ count: 1 }]);
      expect((await signInWith("katherine@example.com", code)).status).toBe(201);
    });

    it(`lets a network ask ${PASSWORD_RESETS_PER_NETWORK} times an hour until the deployment has Turnstile's keys, then asks Turnstile instead`, async () => {
      await setUp();
      const site = fakeMemberful();
      await emailing(async () => {
        for (let n = 1; n <= PASSWORD_RESETS_PER_NETWORK; n++) expect((await ask(`person${n}@example.com`, { ip: "203.0.113.50" })).status).toBe(202);
        const limited = await ask("katherine@example.com", { ip: "203.0.113.50" });
        expect(limited.status).toBe(429);
        expect(await limited.json()).toEqual({ error: PASSWORD_RESETS_LIMITED });
        expect((await ask("katherine@example.com", { ip: "203.0.113.51" })).status).toBe(202);

        const unchecked = await ask("katherine@example.com", { ip: "203.0.113.50", keys: { ...KEYS, ...TURNSTILE_KEYS } });
        expect(unchecked.status).toBe(422);
        expect(await unchecked.json()).toEqual({ error: TURNSTILE_FAILED, field: "turnstile" });
        expect((await ask("katherine@example.com", { ip: "203.0.113.50", keys: { ...KEYS, ...TURNSTILE_KEYS }, turnstileToken: TOKEN })).status).toBe(202);
      });
      expect(site.checks).toEqual([{ secret: TURNSTILE_KEYS.TURNSTILE_SECRET_KEY, response: TOKEN, remoteip: "203.0.113.50" }]);
    });

    it("says so while Ember can't send email, or doesn't offer Sign in with Memberful, or lacks the API key", async () => {
      const administrator = await setUp();
      const site = fakeMemberful();
      await withWorkspaceEnv({ EMAIL: undefined }, async () => {
        const unsendable = await ask("katherine@example.com");
        expect(unsendable.status).toBe(503);
        expect(await unsendable.json()).toEqual({ error: CANT_EMAIL_CODES });
      });
      for (const keys of [SIGN_IN_KEYS, {}]) {
        const off = await ask("katherine@example.com", { keys });
        expect(off.status).toBe(403);
        expect(await off.json()).toEqual({ error: MEMBERFUL_CODES_OFF });
      }
      await change(administrator, { settings: { memberfulJoin: false } });
      expect((await ask("katherine@example.com")).status).toBe(403);
      expect(site.requests).toEqual([]);
    });

    it.each([
      ["no address", "", EMAIL_ADDRESS_NEEDED],
      ["what isn't text", 42, EMAIL_ADDRESS_NEEDED],
    ])("refuses %s on its field", async (_, emailAddress, error) => {
      await setUp();
      const response = await ask(emailAddress);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error, field: "emailAddress" });
    });
  });

  describe("signing in with the code", () => {
    it("joins someone new as the member, linked by the site and member id, spending the code", async () => {
      await setUp();
      fakeMemberful();
      const code = await codeFor("katherine@example.com");
      const response = await signInWith("KATHERINE@example.com", ` ${code.slice(0, 4)} ${code.slice(4)} `);
      expect(response.status, await response.clone().text()).toBe(201);
      expect(await response.json()).toEqual({ joined: true } satisfies MemberfulCodeSignedIn);
      const katherineHere = await signedInAs(response);
      expect(katherineHere.name).toBe("Katherine Johnson");
      expect(await workspaceSql("SELECT issuer, subject, user_id FROM identities")).toEqual([{ issuer: SITE, subject: "4242", user_id: katherineHere.id }]);
      expect(await workspaceSql("SELECT email_address FROM users WHERE id = ?", katherineHere.id)).toEqual([{ email_address: "katherine@example.com" }]);
      expect(await count("memberful_codes")).toBe(0);
      await expectWrong(await signInWith("katherine@example.com", code));
    });

    it("signs in someone linked to the member, by their member id, even once their address there has changed", async () => {
      await setUp();
      const site = fakeMemberful();
      const joined = await signInWith("katherine@example.com", await codeFor("katherine@example.com"));
      const { id } = await signedInAs(joined);

      site.members = [{ ...katherine, email: "kj@example.com" }];
      const response = await signInWith("kj@example.com", await codeFor("kj@example.com"));
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ user: { id, name: "Katherine Johnson", administrator: false } } satisfies MemberfulCodeSignedIn);
      expect((await signedInAs(response)).id).toBe(id);
      expect(await count("identities")).toBe(1);
    });

    it("says the same of a code that doesn't work whoever has the address, asking Memberful nothing", async () => {
      await setUp();
      const site = fakeMemberful([katherine, dorothy]);
      const code = await codeFor("katherine@example.com");
      const before = site.requests.length;
      for (const [emailAddress, tried] of [
        ["nobody@example.com", code],
        ["dorothy@example.com", code],
        ["katherine@example.com", otherThan(code)],
      ]) {
        await expectWrong(await signInWith(emailAddress, tried));
      }
      expect(site.requests).toHaveLength(before);
      expect((await signInWith("katherine@example.com", code)).status).toBe(201);
    });

    it(`takes ${PASSWORD_RESET_CODE_TRIES} tries, the last of which can be right, then stops working`, async () => {
      await setUp();
      fakeMemberful();
      const code = await codeFor("katherine@example.com");
      for (let n = 1; n < PASSWORD_RESET_CODE_TRIES; n++) await expectWrong(await signInWith("katherine@example.com", otherThan(code)));
      expect((await signInWith("katherine@example.com", code)).status).toBe(201);

      const next = await codeFor("katherine@example.com");
      for (let n = 1; n <= PASSWORD_RESET_CODE_TRIES; n++) await expectWrong(await signInWith("katherine@example.com", otherThan(next)));
      await expectWrong(await signInWith("katherine@example.com", next));
    });

    it(`stops working ${PASSWORD_RESET_CODE_MINUTES} minutes after it was emailed, and goes once another is emailed`, async () => {
      await setUp();
      fakeMemberful([katherine, dorothy]);
      const code = await codeFor("katherine@example.com");
      await workspaceSql("UPDATE memberful_codes SET expires_at = ?", new Date(Date.now() - 1).toISOString());
      await expectWrong(await signInWith("katherine@example.com", code));
      await codeFor("dorothy@example.com");
      expect(await workspaceSql("SELECT email_address FROM memberful_codes")).toEqual([{ email_address: "dorothy@example.com" }]);
    });

    it("refuses a member without an active membership, as Memberful's page does, spending the code", async () => {
      await setUp();
      const site = fakeMemberful([{ ...katherine, subscriptions: [{ active: false }] }]);
      const code = await codeFor("katherine@example.com");
      const response = await signInWith("katherine@example.com", code);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: MEMBERFUL_SIGN_IN_PROBLEMS.membership });
      expect(await count("users")).toBe(1);
      site.members = [katherine];
      await expectWrong(await signInWith("katherine@example.com", code));
    });

    it.each([
      ["while Memberful is members only", true],
      ["beside the password", false],
    ])("connects the account of someone here who proved the address theirs, by joining with a link emailed to it, %s", async (_, membersOnly) => {
      const administrator = await setUp({ membersOnly });
      fakeMemberful();
      const member = await joinWithInvitation(administrator);
      const response = await signInWith("katherine@example.com", await codeFor("katherine@example.com"));
      expect(response.status, await response.clone().text()).toBe(201);
      expect(await response.json()).toEqual({ user: { ...member.user, administrator: false } } satisfies MemberfulCodeSignedIn);
      expect((await signedInAs(response)).id).toBe(member.user.id);
      expect(await workspaceSql("SELECT issuer, subject, user_id, via FROM identities")).toEqual([{ issuer: SITE, subject: "4242", user_id: member.user.id, via: "memberful" }]);
      expect(await count("users")).toBe(2);
      // Their password still signs them in, as it does someone an administrator invited.
      expect(await passwordSignsIn()).toBe(true);
    });

    it("asks someone here who joined with the join link, which proves nothing of their address, for their password, which connects their account", async () => {
      const administrator = await setUp({ memberful: false });
      // Anyone with the join link can type a colleague's address before the colleague joins.
      await joinWithLink();
      await change(administrator, { settings: { memberfulJoin: true, memberfulSignIn: true } });
      fakeMemberful();
      await expectTaken(await signInWith("katherine@example.com", await codeFor("katherine@example.com")));
    });

    it("forgets that someone proved their address once they change it, even back", async () => {
      const administrator = await setUp();
      fakeMemberful();
      const member = await joinWithInvitation(administrator);
      for (const emailAddress of ["kj@example.com", katherine.email]) {
        const body = { name: katherine.fullName, emailAddress, bio: "", currentPassword: PASSWORD };
        const changed = await api("/api/users/me/profile", { method: "PATCH", headers: as(member), body: JSON.stringify(body) });
        expect(changed.status, await changed.clone().text()).toBe(200);
      }
      await expectTaken(await signInWith("katherine@example.com", await codeFor("katherine@example.com")));
    });

    it("never connects an administrator's account by their address, asking for their password, as they connect Memberful from their profile", async () => {
      const administrator = await setUp();
      fakeMemberful([katherine, { ...dorothy, email: ada.emailAddress }]);
      await expectTaken(await signInWith(ada.emailAddress, await codeFor(ada.emailAddress)));
      const member = await joinWithInvitation(administrator);
      const promoted = await api(`/api/account/users/${member.user.id}`, { method: "PATCH", headers: as(administrator), body: JSON.stringify({ role: "administrator" }) });
      expect(promoted.status, await promoted.clone().text()).toBe(200);
      await expectTaken(await signInWith("katherine@example.com", await codeFor("katherine@example.com")));
    });

    it("connects nobody's account by their address without an active membership, leaving them be", async () => {
      const administrator = await setUp();
      fakeMemberful([{ ...katherine, subscriptions: [{ active: false }] }]);
      await joinWithInvitation(administrator);
      const response = await signInWith("katherine@example.com", await codeFor("katherine@example.com"));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: MEMBERFUL_SIGN_IN_PROBLEMS.membership });
      expect(await count("identities")).toBe(0);
      expect(await passwordSignsIn()).toBe(true);
    });

    it("keeps the code working while Memberful can't say who has the address", async () => {
      await setUp();
      const site = fakeMemberful();
      const code = await codeFor("katherine@example.com");
      site.down = true;
      const unchecked = await signInWith("katherine@example.com", code);
      expect(unchecked.status).toBe(503);
      expect(await unchecked.json()).toEqual({ error: MEMBERFUL_CODE_UNCHECKED });
      site.down = false;
      expect((await signInWith("katherine@example.com", code)).status).toBe(201);
    });

    it("signs nobody in once Memberful has no member with the address, spending the code", async () => {
      await setUp();
      const site = fakeMemberful();
      const code = await codeFor("katherine@example.com");
      site.members = [];
      const nobody = await signInWith("katherine@example.com", code);
      expect(nobody.status).toBe(422);
      expect(await nobody.json()).toEqual({ error: MEMBERFUL_CODE_NO_MEMBER, field: "emailAddress" });
      site.members = [katherine];
      await expectWrong(await signInWith("katherine@example.com", code));
    });

    it("refuses a code emailed for another Memberful site than Ember has the keys of now", async () => {
      await setUp();
      fakeMemberful();
      const code = await codeFor("katherine@example.com");
      const elsewhere = await signInWith("katherine@example.com", code, { keys: { ...KEYS, MEMBERFUL_URL: "https://another.memberful.com/" } });
      expect(elsewhere.status).toBe(403);
      expect(await elsewhere.json()).toEqual({ error: MEMBERFUL_SIGN_IN_PROBLEMS.failed });
    });

    it("counts each try against sign-in's limit, whether or not the code works", async () => {
      await setUp();
      fakeMemberful();
      const code = await codeFor("katherine@example.com");
      for (let n = 0; n < SIGN_IN_ATTEMPTS; n++) await expectWrong(await signInWith("nobody@example.com", code, { ip: "203.0.113.60" }));
      const limited = await signInWith("katherine@example.com", code, { ip: "203.0.113.60" });
      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({ error: SIGN_IN_LIMITED });
      expect((await signInWith("katherine@example.com", code, { ip: "203.0.113.61" })).status).toBe(201);
    });

    it("is refused while Ember lacks the API key, and without a code of the right shape", async () => {
      await setUp();
      fakeMemberful();
      const code = await codeFor("katherine@example.com");
      const off = await signInWith("katherine@example.com", code, { keys: SIGN_IN_KEYS });
      expect(off.status).toBe(403);
      expect(await off.json()).toEqual({ error: MEMBERFUL_CODES_OFF });
      const shapeless = await signInWith("katherine@example.com", "1234");
      expect(shapeless.status).toBe(422);
      expect(await shapeless.json()).toEqual({ error: PASSWORD_RESET_CODE_NEEDED, field: "code" });
      expect((await signInWith("katherine@example.com", code)).status).toBe(201);
    });
  });
});
