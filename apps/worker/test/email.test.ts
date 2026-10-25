import { feature } from "@ember/parity";
import { CANT_SEND_EMAIL, EMAIL_FROM_REFUSED, type NewWorkspace, type WorkspaceSettings } from "@ember/protocol";
import { evictDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { api, cookieOf, freshDeploy, openWorkspaceSocket, shown, signIn, withWorkspaceEnv, workspaceSql, workspaceStub, type Session } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };

/** A Resend API key, as the deployment's secret holds one. */
const RESEND_KEY = "re_test_only_not_a_key";

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

const as = (session?: Session | null): Record<string, string> => (session ? { Cookie: session.cookie } : {});

const emailSettings = async (session: Session) => ((await (await api("/api/account", { headers: as(session) })).json()) as WorkspaceSettings).email;

/** Gives the workspace the From address `emailFrom` as `session`, as the Email card's Save does. */
const giveFrom = (session: Session | null, emailFrom: unknown) => api("/api/account", { method: "PATCH", headers: as(session), body: JSON.stringify({ emailFrom }) });

/** Gives the workspace the From address `emailFrom` as `administrator`, which has to work. */
async function saveFrom(administrator: Session, emailFrom: string): Promise<void> {
  const response = await giveFrom(administrator, emailFrom);
  expect(response.status, await response.clone().text()).toBe(200);
}

const storedFrom = async () => (JSON.parse(((await workspaceSql("SELECT settings FROM accounts")) as Array<{ settings: string }>)[0]!.settings) as { email_from?: unknown }).email_from;

const sendTest = (session?: Session | null) => api("/api/account/test_email", { method: "POST", headers: as(session) });

/** Stands in for Cloudflare Email Service's binding, keeping what it's asked to send, and throwing `refusal` if given. */
function fakeBinding(refusal?: unknown) {
  const sent: EmailMessageBuilder[] = [];
  const binding = {
    send: async (message: EmailMessageBuilder) => {
      sent.push(message);
      if (refusal !== undefined) throw refusal;
      return { messageId: `<${crypto.randomUUID()}@example.com>` };
    },
  } as unknown as SendEmail;
  return { binding, sent };
}

/** An error as Cloudflare Email Service's binding throws one, with `code`. */
const thrownWith = (code: string) => Object.assign(new Error(`Email Service refused it: ${code}`), { code });

/** A request the fake Resend was sent. */
interface SentToResend {
  url: string;
  method: string;
  headers: Headers;
  redirect: string;
  body: unknown;
}

/** Stands in for Resend's API, answering `answer` to each email, and keeping what it's sent. */
function fakeResend(answer: () => Response | Promise<Response> = () => Response.json({ id: crypto.randomUUID() })) {
  const requests: SentToResend[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, method: request.method, headers: request.headers, redirect: request.redirect, body: await request.json() });
    return answer();
  });
  return requests;
}

/** The answer to a test email that wasn't sent: `status` and the `error` that says why. */
async function expectRefused(response: Response, status: number, error: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
}

beforeEach(freshDeploy);
afterEach(() => vi.restoreAllMocks());

describe(feature("platform.email"), () => {
  it("says what Ember sends email with: Resend while there's an API key, else Cloudflare Email Service's binding", async () => {
    const administrator = await setUp();
    expect(await emailSettings(administrator)).toEqual({ provider: "cloudflare", from: null });
    await withWorkspaceEnv({ RESEND_API_KEY: RESEND_KEY }, async () => expect((await emailSettings(administrator)).provider).toBe("resend"));
    await withWorkspaceEnv({ EMAIL: undefined }, async () => expect((await emailSettings(administrator)).provider).toBeNull());
    await withWorkspaceEnv({ EMAIL: undefined, RESEND_API_KEY: "  " }, async () => expect((await emailSettings(administrator)).provider).toBeNull());
  });

  it("keeps the From address an administrator gives, as an address is written, and takes it away", async () => {
    const administrator = await setUp();
    await saveFrom(administrator, "  Ember   <ember@example.com> ");
    expect(await storedFrom()).toBe("Ember <ember@example.com>");
    expect(await emailSettings(administrator)).toEqual({ provider: "cloudflare", from: "Ember <ember@example.com>" });
    const member = await signIn("Grace");
    expect((await emailSettings(member)).from).toBe("Ember <ember@example.com>");

    await saveFrom(administrator, "Acme, Inc. <chat@acme.example>");
    expect((await emailSettings(administrator)).from).toBe('"Acme, Inc." <chat@acme.example>');

    const cleared = await giveFrom(administrator, null);
    expect(cleared.status).toBe(200);
    expect(await storedFrom()).toBeNull();
    expect((await emailSettings(administrator)).from).toBeNull();
  });

  it("tells nobody's pages of a new From address, which they don't show", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace");
    const sockets = [await openWorkspaceSocket(administrator), await openWorkspaceSocket(grace)];
    await saveFrom(administrator, "chat@example.com");
    expect(await (await api("/api/account", { method: "PATCH", headers: as(administrator), body: JSON.stringify({ emailFrom: null, tagline: "Chat" }) })).json()).toMatchObject({ account: { tagline: "Chat" } });
    for (const socket of sockets) expect(await socket.next()).toMatchObject({ type: "account.updated", account: { tagline: "Chat" } });
    expect(await storedFrom()).toBeNull();
  });

  it("refuses a From address that isn't one, and anyone but an administrator", async () => {
    const administrator = await setUp();
    await saveFrom(administrator, "ember@example.com");
    for (const emailFrom of ["Ember", "ember@", "Ember <ember@example.com", 42]) await expectRefused(await giveFrom(administrator, emailFrom), 422, EMAIL_FROM_REFUSED);
    expect((await giveFrom(await signIn("Grace"), "grace@example.com")).status).toBe(403);
    expect((await giveFrom(null, "anyone@example.com")).status).toBe(401);
    expect(await storedFrom()).toBe("ember@example.com");
  });

  it("sends an administrator a test email from the From address with Cloudflare Email Service", async () => {
    const administrator = await setUp();
    await saveFrom(administrator, "Ember Team <chat@example.com>");
    const { binding, sent } = fakeBinding();
    await withWorkspaceEnv({ EMAIL: binding }, async () => {
      const response = await sendTest(administrator);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ to: "ada@example.com" });

      await saveFrom(administrator, "chat@example.com");
      expect((await sendTest(administrator)).status).toBe(200);
    });
    expect(sent).toEqual([
      {
        from: { name: "Ember Team", email: "chat@example.com" },
        to: "ada@example.com",
        subject: "Test email from Ember",
        text: "This is a test email from Ember, at https://ember.test.\n\nIt reached you, so Ember can send email.\n",
        html: expect.stringContaining('<a href="https://ember.test">https://ember.test</a>') as unknown,
      },
      expect.objectContaining({ from: "chat@example.com", to: "ada@example.com" }),
    ]);
  });

  it("names the workspace, as the email's text has it, and Ember's custom domain", async () => {
    const administrator = await setUp();
    await saveFrom(administrator, "chat@example.com");
    await workspaceSql("UPDATE accounts SET name = ?, settings = json_set(settings, '$.custom_domain', ?)", "Grace's <b>lab</b>", "chat.example.com");
    await evictDurableObject(workspaceStub());
    const { binding, sent } = fakeBinding();
    await withWorkspaceEnv({ EMAIL: binding }, async () => expect((await sendTest(administrator)).status).toBe(200));
    expect(sent[0]!.subject).toBe("Test email from Grace's <b>lab</b>");
    expect(sent[0]!.text).toContain("from Grace's <b>lab</b>, at https://chat.example.com.");
    expect(sent[0]!.html).toContain('from Grace&#39;s &lt;b&gt;lab&lt;/b&gt;, at <a href="https://chat.example.com">https://chat.example.com</a>.');
  });

  it("sends with the binding as wrangler dev has it, which takes the email as Ember gives it", async () => {
    const administrator = await setUp();
    await saveFrom(administrator, "Ember <ember@example.com>");
    const response = await sendTest(administrator);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ to: "ada@example.com" });
  });

  it("says why there's no test email: no session, no administrator, no way to send, no From address, or no address of one's own", async () => {
    const administrator = await setUp();
    expect((await sendTest(null)).status).toBe(401);
    const grace = await signIn("Grace");
    expect((await sendTest(grace)).status).toBe(403);
    await withWorkspaceEnv({ EMAIL: undefined }, async () => expectRefused(await sendTest(administrator), 503, CANT_SEND_EMAIL));
    await expectRefused(await sendTest(administrator), 422, "Give Ember a From address first.");

    await saveFrom(administrator, "chat@example.com");
    await workspaceSql("UPDATE users SET role = 1 WHERE id = ?", grace.user.id);
    const { binding, sent } = fakeBinding();
    await withWorkspaceEnv({ EMAIL: binding }, async () => expectRefused(await sendTest(grace), 422, "Your profile has no email address to send it to."));
    expect(sent).toEqual([]);
  });

  it("says in plain words why Cloudflare Email Service didn't send it, and logs its code, never the address", async () => {
    const administrator = await setUp();
    await saveFrom(administrator, "chat@example.com");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const refusals: Array<[unknown, string]> = [
      [thrownWith("E_SENDER_DOMAIN_NOT_AVAILABLE"), "The From address's domain isn't onboarded to Cloudflare Email Service. In the Cloudflare dashboard, open Email Service, Email Sending, and choose Onboard Domain."],
      [thrownWith("E_RECIPIENT_NOT_ALLOWED"), "Cloudflare won't send to that address from this account. On the Workers Free plan it sends only to the account's own verified addresses."],
      [thrownWith("E_DAILY_LIMIT_EXCEEDED"), "This account has used up its sending quota with Cloudflare for today. The quota grows with good sending."],
      [thrownWith("E_SOMETHING_NEW"), "Cloudflare Email Service didn't send it (E_SOMETHING_NEW)."],
      [thrownWith("<b>not a code</b>"), "Cloudflare Email Service didn't send it."],
      [new TypeError("Network connection lost"), "Cloudflare Email Service didn't send it."],
    ];
    for (const [thrown, refusal] of refusals) {
      const { binding } = fakeBinding(thrown);
      await withWorkspaceEnv({ EMAIL: binding }, async () => expectRefused(await sendTest(administrator), 502, refusal));
    }
    expect(logged).toHaveBeenCalledWith("Cloudflare Email Service didn't send an email:", "E_SENDER_DOMAIN_NOT_AVAILABLE");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("ada@example.com");
  });

  it("sends with Resend while the deployment has its API key, without following a redirect", async () => {
    const administrator = await setUp();
    await saveFrom(administrator, "Acme, Inc. <chat@acme.example>");
    const requests = fakeResend();
    const { binding, sent } = fakeBinding();
    await withWorkspaceEnv({ EMAIL: binding, RESEND_API_KEY: ` ${RESEND_KEY} ` }, async () => {
      const response = await sendTest(administrator);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ to: "ada@example.com" });
    });
    expect(sent).toEqual([]);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request).toMatchObject({ url: "https://api.resend.com/emails", method: "POST", redirect: "manual" });
    expect(request!.headers.get("Authorization")).toBe(`Bearer ${RESEND_KEY}`);
    expect(request!.headers.get("Content-Type")).toBe("application/json");
    expect(request!.body).toEqual({
      from: '"Acme, Inc." <chat@acme.example>',
      to: ["ada@example.com"],
      subject: "Test email from Ember",
      text: "This is a test email from Ember, at https://ember.test.\n\nIt reached you, so Ember can send email.\n",
      html: expect.stringContaining("It reached you, so Ember can send email.") as unknown,
    });
  });

  it("says in plain words why Resend didn't send it, and logs its error's name, never the address", async () => {
    const administrator = await setUp();
    await saveFrom(administrator, "chat@example.com");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const KEY_REFUSED = "Resend doesn't take the API key in RESEND_API_KEY. Check it under API Keys in Resend, or make one that can send.";
    const unverified = "The example.com domain is not verified. Please, add and verify your domain on https://resend.com/domains";
    const refusals: Array<[() => Response | Promise<Response>, string]> = [
      [() => Response.json({ name: "validation_error", message: unverified }, { status: 403 }), `Resend refused it: ${unverified}`],
      [() => Response.json({ name: "validation_error", message: "x".repeat(400) }, { status: 422 }), `Resend refused it: ${"x".repeat(300)}`],
      [() => Response.json({ name: "missing_api_key", message: "Missing API key in the authorization header" }, { status: 401 }), KEY_REFUSED],
      [() => Response.json({ name: "restricted_api_key", message: "This API key is restricted to only send emails" }, { status: 401 }), KEY_REFUSED],
      [() => Response.json({ name: "daily_quota_exceeded", message: "You have reached your daily email sending quota." }, { status: 429 }), "Resend's daily sending quota is used up. It starts again at midnight UTC."],
      [() => Response.json({ name: "monthly_quota_exceeded", message: "You have reached your monthly email sending quota." }, { status: 429 }), "Resend's monthly sending quota is used up."],
      [() => Response.json({ name: "rate_limit_exceeded", message: "Too many requests." }, { status: 429 }), "Resend is taking too many emails at once. Try again in a moment."],
      [() => new Response("Bad gateway", { status: 502 }), "Resend isn't answering as it should. Try again later."],
      [() => new Response("Not JSON", { status: 400 }), "Resend refused it (400)."],
      [() => new Response(null, { status: 307, headers: { Location: "https://elsewhere.example/emails" } }), "Resend refused it (307)."],
      [() => Promise.reject(new TypeError("Network connection lost")), "Resend didn't answer. Try again later."],
    ];
    for (const [answer, refusal] of refusals) {
      const requests = fakeResend(answer);
      await withWorkspaceEnv({ RESEND_API_KEY: RESEND_KEY }, async () => expectRefused(await sendTest(administrator), 502, refusal));
      expect(requests).toHaveLength(1);
      vi.mocked(fetch).mockRestore();
    }
    expect(logged).toHaveBeenCalledWith("Resend didn't send an email:", 403, "validation_error");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("ada@example.com");
    expect(JSON.stringify(logged.mock.calls)).not.toContain(RESEND_KEY);
  });

  it("takes a stand-in for Resend's API only at a loopback address", async () => {
    const administrator = await setUp();
    await saveFrom(administrator, "chat@example.com");
    const requests = fakeResend();
    for (const RESEND_API_URL of ["http://127.0.0.1:8796/", "https://resend.example/", "http://10.0.0.1:8796", "not a url"]) {
      await withWorkspaceEnv({ RESEND_API_KEY: RESEND_KEY, RESEND_API_URL }, async () => expect((await sendTest(administrator)).status).toBe(200));
    }
    expect(requests.map(({ url }) => url)).toEqual(["http://127.0.0.1:8796/emails", "https://api.resend.com/emails", "https://api.resend.com/emails", "https://api.resend.com/emails"]);
  });
});
