import { ASSISTANT_ID, type Me, type NewWorkspace } from "@ember/protocol";
import {
  APP_CHANGED,
  APP_SIGN_IN_ENDED,
  APP_SIGNED_IN,
  APPS_FORBIDDEN,
  type AgentTools,
  type App,
  type AppAnswer,
  type AppClient,
  type Apps,
  type AppSignedIn,
  type AppSignInBegun,
} from "@ember/protocol/apps";
import { ASSISTANT_OFF } from "@ember/protocol/assistant";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInEnded } from "../src/apps/tools";
import { toBase64url } from "../src/encoding";
import { api, cookieOf, freshDeploy, origin, shown, workspaceSql, workspaceStub, type Session } from "./support";

// Signing in to an app whose server asks for a sign-in, with OAuth as the Model Context Protocol has
// it. A fake MCP server and its authorization server stand behind `fetch`: the server takes only the
// access token its authorization server gave last, and says where that is in its 401.

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const API_TOKEN = "an-api-token-with-ai-gateway-run_0123456";
const SONNET = "anthropic/claude-sonnet-5.5";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };
const grace = { name: "Grace Hopper", emailAddress: "grace@example.com", password: "nanoseconds" };

/** Where the fake server is, and its authorization server, on the Internet. */
const TRACKER = "https://mcp.tracker.example/mcp";
const AUTH = "https://auth.tracker.example";
/** Where Ember has an authorization server send a browser back, and where it serves who it is. */
const BACK = `${origin}/account/apps/signed-in`;
const CLIENT_DOCUMENT = `${origin}/oauth/client.json`;

const CLOSE_ISSUE = { name: "close_issue", description: "Closes an issue.", inputSchema: { type: "object" } };
const SEARCH_ISSUES = { name: "search_issues", description: "Finds issues by their words.", inputSchema: { type: "object", properties: { query: { type: "string" } } } };

/** A request Ember sent the fake server or its authorization server: its address, method and token, how it's held, and the form it carried, if it carried one. */
interface Asked {
  url: string;
  method: string;
  authorization: string | null;
  redirect: string;
  timed: boolean;
  form?: Record<string, string>;
  json?: Record<string, unknown>;
}

let asked: Asked[];
/** The addresses each name resolves to. */
let addresses: Record<string, string[]>;

/**
 * What the fake authorization server is: whether it reads a client from a document, registers one that
 * asks, or gives tokens only to `client`, one an administrator registered there, which proves itself
 * with its secret, and says who it is when it sends a browser back, how long its access tokens last, whether it
 * gives a token to get another with, and what it answers in place of all that, if anything, once
 * whatever that does meanwhile is done. `codes` are the ones it has sent a browser back with, each
 * with what the browser was sent to it with, and `access` and `refresh` the tokens it gave last, the
 * `issued`th. `tools` are what the fake server lists, and `listing` what happens while it lists them,
 * if anything, once it has decided what to answer.
 */
interface AuthorizationServer {
  readsDocuments: boolean;
  registers: boolean;
  client: { id: string; secret: string } | null;
  saysIssuer: boolean;
  expiresIn: number | undefined;
  refreshes: boolean;
  metadata: (metadata: Record<string, unknown>) => Record<string, unknown> | null;
  resource: (resource: Record<string, unknown>) => Record<string, unknown> | null;
  token: (form: Record<string, string>) => Response | null | Promise<Response | null>;
  codes: Map<string, URLSearchParams>;
  issued: number;
  access: string | null;
  refresh: string | null;
  tools: unknown[];
  listing: (() => Promise<unknown>) | undefined;
}
let auth: AuthorizationServer;

const oauthError = (error: string, status = 400) => Response.json({ error }, { status });

/** The S256 challenge of a PKCE `verifier`. */
const challengeOf = async (verifier: string) => toBase64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))).replace(/=+$/, "");

/** The tokens the fake authorization server gives next, which end the ones it gave last. */
function nextTokens(scope: string | undefined): Response {
  auth.issued += 1;
  auth.access = `access-${auth.issued}`;
  auth.refresh = auth.refreshes ? `refresh-${auth.issued}` : null;
  return Response.json({
    access_token: auth.access,
    token_type: "Bearer",
    ...(auth.expiresIn !== undefined && { expires_in: auth.expiresIn }),
    ...(auth.refresh !== null && { refresh_token: auth.refresh }),
    ...(scope !== undefined && { scope }),
  });
}

/** Who a request to the token endpoint says it's from: the client ID and secret of its Basic authorization, or else of its form. */
function clientOf({ form = {}, authorization }: Asked): { id: string | undefined; secret: string | undefined } {
  if (!authorization?.startsWith("Basic ")) return { id: form.client_id, secret: form.client_secret };
  const [id, secret] = atob(authorization.slice("Basic ".length)).split(":").map(decodeURIComponent);
  return { id, secret };
}

/**
 * What the fake authorization server answers at its token endpoint: tokens for a code it sent a browser
 * back with, proven with its verifier, or for the token it gave last to get another with, to the client
 * an administrator registered there alone, if one did.
 */
async function tokensFor(sent: Asked): Promise<Response> {
  const form = sent.form ?? {};
  const instead = await auth.token(form);
  if (instead) return instead;
  const client = clientOf(sent);
  if (auth.client && (client.id !== auth.client.id || client.secret !== auth.client.secret)) return oauthError("invalid_client", 401);
  if (form.grant_type === "refresh_token") return form.refresh_token === auth.refresh && auth.refresh !== null ? nextTokens(undefined) : oauthError("invalid_grant");
  const began = auth.codes.get(form.code ?? "");
  auth.codes.delete(form.code ?? "");
  if (!began || form.grant_type !== "authorization_code") return oauthError("invalid_grant");
  const proven = began.get("code_challenge") === (await challengeOf(form.code_verifier ?? ""));
  const same = form.redirect_uri === began.get("redirect_uri") && client.id === began.get("client_id") && form.resource === began.get("resource");
  return proven && same ? nextTokens(began.get("scope") ?? undefined) : oauthError("invalid_grant");
}

/** What the fake authorization server, or the fake server's own description of its sign-in, answers a request at `url`. */
async function signInAnswer(url: URL, request: Request, sent: Asked): Promise<Response> {
  if (url.origin === new URL(TRACKER).origin && url.pathname === "/.well-known/oauth-protected-resource/mcp") {
    const resource = auth.resource({ resource: TRACKER, authorization_servers: [AUTH], scopes_supported: ["issues"] });
    return resource ? Response.json(resource) : new Response(null, { status: 404 });
  }
  if (url.origin !== AUTH) return new Response(null, { status: 404 });
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    const metadata = auth.metadata({
      issuer: AUTH,
      authorization_endpoint: `${AUTH}/authorize`,
      token_endpoint: `${AUTH}/token`,
      ...(auth.registers && { registration_endpoint: `${AUTH}/register` }),
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: auth.client ? ["client_secret_basic", "none"] : ["none"],
      ...(auth.readsDocuments && { client_id_metadata_document_supported: true }),
      ...(auth.saysIssuer && { authorization_response_iss_parameter_supported: true }),
    });
    return metadata ? Response.json(metadata) : new Response(null, { status: 404 });
  }
  if (url.pathname === "/register" && request.method === "POST" && auth.registers) return Response.json({ ...sent.json, client_id: "ember-at-tracker" }, { status: 201 });
  if (url.pathname === "/token" && request.method === "POST") return tokensFor(sent);
  return new Response(null, { status: 404 });
}

/** The fake server's answer to a JSON-RPC `message`, as Streamable HTTP has it. */
function answerTo(message: { id?: number; method?: string; params?: { protocolVersion?: string } }): Response {
  const result = (result: unknown) => Response.json({ jsonrpc: "2.0", id: message.id, result });
  if (message.method === "initialize") return result({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "Tracker", version: "1.2.3" } });
  if (message.method === "tools/list") return result({ tools: auth.tools });
  if (message.id === undefined) return new Response(null, { status: 202 });
  return Response.json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
}

const CHALLENGE = `Bearer resource_metadata="https://mcp.tracker.example/.well-known/oauth-protected-resource/mcp", scope="issues"`;

beforeEach(async () => {
  await freshDeploy();
  asked = [];
  addresses = { "mcp.tracker.example": ["93.184.216.34"], "auth.tracker.example": ["93.184.216.35"], "auth.internal.example": ["10.0.0.5"] };
  auth = {
    readsDocuments: false,
    registers: true,
    client: null,
    saysIssuer: false,
    expiresIn: 3600,
    refreshes: true,
    metadata: (metadata) => metadata,
    resource: (resource) => resource,
    token: () => null,
    codes: new Map(),
    issued: 0,
    access: null,
    refresh: null,
    tools: [SEARCH_ISSUES],
    listing: undefined,
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "cloudflare-dns.com") {
      const found = url.searchParams.get("type") === "A" ? (addresses[url.searchParams.get("name")!] ?? []) : [];
      return Response.json({ Status: 0, Answer: found.map((data) => ({ type: 1, data })) });
    }
    // Turning Ember AI on asks its model a test question.
    if (!url.hostname.endsWith(".example")) {
      return Response.json({ type: "message", role: "assistant", content: [{ type: "text", text: "Hello!" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } });
    }
    const type = request.headers.get("Content-Type") ?? "";
    const sent: Asked = {
      url: request.url,
      method: request.method,
      authorization: request.headers.get("Authorization"),
      redirect: init?.redirect ?? "follow",
      timed: init?.signal instanceof AbortSignal,
      ...(type.includes("form") && { form: Object.fromEntries([...(await request.formData())].map(([name, value]) => [name, String(value)])) }),
      ...(type.includes("json") && { json: (await request.json()) as Record<string, unknown> }),
    };
    asked.push(sent);
    if (request.url !== TRACKER) return signInAnswer(url, request, sent);
    if (auth.access === null || sent.authorization !== `Bearer ${auth.access}`) return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": CHALLENGE } });
    if (!sent.json) return new Response(null, { status: 405 });
    const answer = answerTo(sent.json);
    if (sent.json.method !== "tools/list") return answer;
    const meanwhile = auth.listing;
    auth.listing = undefined;
    await meanwhile?.();
    return answer;
  });
});
afterEach(() => vi.restoreAllMocks());

const as = (session?: Session | null): Record<string, string> => (session ? { Cookie: session.cookie } : {});

/** Sets Ember up with Ada as its administrator, signed in, and Ember AI on. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  const administrator = { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
  const on = await api("/api/account/assistant", { method: "PUT", headers: as(administrator), body: JSON.stringify({ accountId: ACCOUNT_ID, apiToken: API_TOKEN, model: SONNET }) });
  expect(on.status, await on.clone().text()).toBe(200);
  return administrator;
}

/** Grace joins with the join link, as a member, signed in. */
async function joinAsGrace(): Promise<Session> {
  const [{ join_code: joinCode }] = (await workspaceSql("SELECT join_code FROM accounts")) as [{ join_code: string }];
  const response = await api(`/api/join/${joinCode}`, { method: "POST", body: JSON.stringify(grace) });
  expect(response.status, await response.clone().text()).toBe(201);
  return { user: shown(((await response.json()) as { user: Me }).user), cookie: cookieOf(response) };
}

const TRACKER_APP = { name: "Tracker", url: TRACKER };

const connect = (session: Session | null, body: unknown) => api("/api/account/apps", { method: "POST", headers: as(session), body: JSON.stringify(body) });
const begin = (session: Session | null, body: unknown = TRACKER_APP) => api("/api/account/app-sign-ins", { method: "POST", headers: as(session), body: JSON.stringify(body) });
const beginAgain = (session: Session | null, id: string, client?: AppClient) =>
  api(`/api/account/apps/${id}/sign-in`, { method: "POST", headers: as(session), ...(client && { body: JSON.stringify(client) }) });
const finish = (session: Session | null, body: unknown) => api("/api/account/app-sign-ins/finish", { method: "POST", headers: as(session), body: JSON.stringify(body) });
const show = (session: Session | null, id: string) => api(`/api/account/apps/${id}`, { headers: as(session) });
const change = (session: Session | null, id: string, body: unknown) => api(`/api/account/apps/${id}`, { method: "PATCH", headers: as(session), body: JSON.stringify(body) });
const readAgain = (session: Session | null, id: string) => api(`/api/account/apps/${id}/tools`, { method: "POST", headers: as(session) });
const disconnect = (session: Session | null, id: string) => api(`/api/account/apps/${id}`, { method: "DELETE", headers: as(session) });

/** What `response` refuses with, which it answers with `status`. */
async function refusalOf(response: Response, status = 422): Promise<{ error: string; field?: string; signIn?: boolean; client?: boolean }> {
  expect(response.status, await response.clone().text()).toBe(status);
  return response.json();
}

/** Where `response`, the answer to beginning a sign-in, sends the browser. */
async function sentTo(response: Response): Promise<URL> {
  expect(response.status, await response.clone().text()).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return new URL(((await response.json()) as AppSignInBegun).authorizationUrl);
}

/** Signs in at the fake authorization server, where the browser was sent to it at `authorizationUrl`: what it comes back to Ember with. */
function comeBack(authorizationUrl: URL): { state: string; code: string; iss?: string } {
  const code = `code-${auth.codes.size + 1}-${crypto.randomUUID()}`;
  auth.codes.set(code, authorizationUrl.searchParams);
  return { state: authorizationUrl.searchParams.get("state")!, code, ...(auth.saysIssuer && { iss: AUTH }) };
}

/** The app `response`, the answer to finishing a sign-in, answers, which it answers with `status`. */
async function signedInBy(response: Response, status = 201): Promise<App> {
  expect(response.status, await response.clone().text()).toBe(status);
  const { app, again } = (await response.json()) as AppSignedIn;
  expect(again).toBe(status === 200);
  return app;
}

/** Signs in again to the connected app `id` as `administrator`. */
const signInAgain = async (administrator: Session, id: string) => signedInBy(await finish(administrator, comeBack(await sentTo(await beginAgain(administrator, id)))), 200);

/** What @ember's page offers of the connected apps' tools now. */
const offered = async (administrator: Session) => ((await (await api(`/api/account/agents/${ASSISTANT_ID}/tools`, { headers: as(administrator) })).json()) as AgentTools).apps;

/** Has every tool @ember's page offers now be picked for it, or none. */
async function pick(administrator: Session, every: boolean): Promise<void> {
  const tools = every ? (await offered(administrator)).flatMap(({ id, tools }) => tools.map(({ name, fingerprint }) => ({ appId: id, name, fingerprint }))) : [];
  const saved = await api(`/api/account/agents/${ASSISTANT_ID}/tools`, { method: "PUT", headers: as(administrator), body: JSON.stringify({ tools }) });
  expect(saved.status, await saved.clone().text()).toBe(200);
}

/** Connects the fake server by signing in to it as `administrator`. */
const signIn = async (administrator: Session) => signedInBy(await finish(administrator, comeBack(await sentTo(await begin(administrator)))));

const appOf = async (response: Response) => {
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as AppAnswer).app;
};

/** The requests Ember sent the fake authorization server's token endpoint. */
/** What a service that doesn't come to know Ember by itself is refused with, which has the form ask for a client ID. */
const UNREGISTERED = {
  error: "mcp.tracker.example has a sign-in, but doesn't let Ember register itself for it. Register Ember there yourself and give its client ID, or give a token, if it has one.",
  field: "token",
  client: true,
};

const tokenRequests = () => asked.filter(({ url }) => url === `${AUTH}/token`).map(({ form }) => form!);

describe("Signing in to an app", () => {
  it("says that a server which asks for a sign-in can be signed in to", async () => {
    const administrator = await setUp();
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await refusalOf(await connect(administrator, TRACKER_APP))).toEqual({
      error: "mcp.tracker.example asks for a sign-in. Sign in to it, or give a token for it, if it has one.",
      field: "token",
      signIn: true,
    });
  });

  it("begins by finding the server's authorization server and registering there, and answers where to send the browser, which proves itself with PKCE", async () => {
    const administrator = await setUp();
    const to = await sentTo(await begin(administrator, { name: " Tracker ", url: ` ${TRACKER} ` }));

    expect(`${to.origin}${to.pathname}`).toBe(`${AUTH}/authorize`);
    expect(Object.fromEntries(to.searchParams)).toEqual({
      response_type: "code",
      client_id: "ember-at-tracker",
      code_challenge: expect.stringMatching(/^[\w-]{43}$/) as string,
      code_challenge_method: "S256",
      redirect_uri: BACK,
      state: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
      scope: "issues",
      resource: TRACKER,
    });
    // It asked the server, which said where its sign-in is described, then that, the authorization server, and to be registered there.
    expect(asked.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `POST ${TRACKER}`,
      "GET https://mcp.tracker.example/.well-known/oauth-protected-resource/mcp",
      `GET ${AUTH}/.well-known/oauth-authorization-server`,
      `POST ${AUTH}/register`,
    ]);
    expect(asked[3]!.json).toMatchObject({ client_name: "Ember", client_uri: origin, redirect_uris: [BACK], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" });
    // No request follows a redirect, and each can be stopped at the deadline.
    expect(asked.every(({ redirect, timed }) => redirect === "manual" && timed)).toBe(true);
    // Nothing is connected yet, and what's kept of the sign-in is sealed.
    expect(await workspaceSql("SELECT count(*) AS n FROM apps")).toEqual([{ n: 0 }]);
    const [pending] = (await workspaceSql("SELECT user_id, app_id, name, url, sign_in FROM app_sign_ins")) as [{ sign_in: string }];
    expect(pending).toMatchObject({ user_id: administrator.user.id, app_id: null, name: "Tracker", url: TRACKER });
    expect(pending.sign_in).toMatch(/^v1\./);
    expect(pending.sign_in).not.toContain("ember-at-tracker");
  });

  it("finishes by exchanging the code with its verifier, reads the server's tools signed in, and connects the app, which its page shows", async () => {
    const administrator = await setUp();
    const back = comeBack(await sentTo(await begin(administrator)));
    asked = [];
    const app = await signedInBy(await finish(administrator, back));

    expect(app).toMatchObject({ name: "Tracker", url: TRACKER, hasToken: false, tools: [{ name: "search_issues" }], connectedBy: administrator.user });
    expect(app.signIn).toEqual({ by: administrator.user, at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) as string, ended: false, clientId: null });
    expect(await appOf(await show(administrator, app.id))).toEqual(app);
    expect(tokenRequests()).toEqual([
      { grant_type: "authorization_code", code: back.code, code_verifier: expect.stringMatching(/^[\w.~-]{43,128}$/) as string, redirect_uri: BACK, client_id: "ember-at-tracker", resource: TRACKER },
    ]);
    expect(asked.filter(({ url }) => url === TRACKER).every(({ authorization }) => authorization === "Bearer access-1")).toBe(true);
    expect(asked.every(({ redirect, timed }) => redirect === "manual" && timed)).toBe(true);
    // The tokens are kept sealed, for this app, and the sign-in under way is gone.
    const [{ token, sign_in: kept }] = (await workspaceSql("SELECT token, sign_in FROM apps")) as [{ token: string | null; sign_in: string }];
    expect(token).toBeNull();
    expect(kept).toMatch(/^v1\./);
    expect(kept).not.toContain("access-1");
    expect(await workspaceSql("SELECT count(*) AS n FROM app_sign_ins")).toEqual([{ n: 0 }]);
    // It's finished once.
    expect(await refusalOf(await finish(administrator, back))).toEqual({ error: APP_SIGN_IN_ENDED });
  });

  it("is finished only by the administrator who began it, and within ten minutes", async () => {
    const administrator = await setUp();
    const other = await joinAsGrace();
    await workspaceSql("UPDATE users SET role = 1 WHERE id = ?", other.user.id);
    const back = comeBack(await sentTo(await begin(administrator)));

    expect(await refusalOf(await finish(other, back))).toEqual({ error: APP_SIGN_IN_ENDED });
    expect(await refusalOf(await finish(administrator, { ...back, state: "0".repeat(64) }))).toEqual({ error: APP_SIGN_IN_ENDED });
    expect(await refusalOf(await finish(administrator, { state: back.state }))).toEqual({ error: APP_SIGN_IN_ENDED });
    expect(await refusalOf(await finish(administrator, { ...back, code: "c".repeat(4097) }))).toEqual({ error: APP_SIGN_IN_ENDED });
    const [{ expires_at: expiresAt }] = (await workspaceSql("SELECT expires_at FROM app_sign_ins")) as [{ expires_at: string }];
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000);

    await workspaceSql("UPDATE app_sign_ins SET expires_at = ?", new Date(Date.now() - 1000).toISOString());
    expect(await refusalOf(await finish(administrator, back))).toEqual({ error: APP_SIGN_IN_ENDED });
    expect(tokenRequests()).toEqual([]);
    expect(await workspaceSql("SELECT count(*) AS n FROM apps")).toEqual([{ n: 0 }]);
  });

  it("is only an administrator's to begin or finish, while Ember AI is on", async () => {
    const administrator = await setUp();
    const member = await joinAsGrace();
    const back = comeBack(await sentTo(await begin(administrator)));
    asked = [];

    expect(await refusalOf(await begin(null), 401)).toEqual({ error: "Not signed in" });
    expect(await refusalOf(await begin(member), 403)).toEqual({ error: APPS_FORBIDDEN });
    expect(await refusalOf(await finish(null, back), 401)).toEqual({ error: "Not signed in" });
    expect(await refusalOf(await finish(member, back), 403)).toEqual({ error: APPS_FORBIDDEN });
    expect(await refusalOf(await beginAgain(member, "0mgk3x2a9b4c5e"), 403)).toEqual({ error: APPS_FORBIDDEN });
    expect(await refusalOf(await beginAgain(administrator, "0mgk3x2a9b4c5e"), 404)).toEqual({ error: "Not found" });

    expect((await api("/api/account/assistant", { method: "DELETE", headers: as(administrator) })).status).toBe(200);
    expect(await refusalOf(await begin(administrator), 409)).toEqual({ error: ASSISTANT_OFF });
    expect(await refusalOf(await finish(administrator, back), 409)).toEqual({ error: ASSISTANT_OFF });
    expect(asked).toEqual([]);
  });

  it("names itself by its client document to an authorization server that reads one, and serves the document", async () => {
    const administrator = await setUp();
    auth.readsDocuments = true;
    const to = await sentTo(await begin(administrator));

    expect(to.searchParams.get("client_id")).toBe(CLIENT_DOCUMENT);
    expect(asked.some(({ url }) => url === `${AUTH}/register`)).toBe(false);
    const app = await signedInBy(await finish(administrator, comeBack(to)));
    expect(app.signIn?.ended).toBe(false);
    expect(tokenRequests()[0]).toMatchObject({ client_id: CLIENT_DOCUMENT });

    // Anyone may read it, signed in or not, whatever their browser.
    const document = await api("/oauth/client.json", { headers: { "User-Agent": "an-authorization-server/1.0" } });
    expect(document.status).toBe(200);
    expect(await document.json()).toEqual({
      client_id: CLIENT_DOCUMENT,
      client_name: "Ember",
      client_uri: origin,
      redirect_uris: [BACK],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  it("checks who an authorization server says it is when it sends the browser back, where it says", async () => {
    const administrator = await setUp();
    auth.saysIssuer = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const another = "The sign-in mcp.tracker.example names says it's another service's, so Ember won't use it.";

    const unsaid = comeBack(await sentTo(await begin(administrator)));
    expect(await refusalOf(await finish(administrator, { state: unsaid.state, code: unsaid.code }))).toEqual({ error: another });
    const wrong = comeBack(await sentTo(await begin(administrator)));
    expect(await refusalOf(await finish(administrator, { ...wrong, iss: "https://auth.elsewhere.example" }))).toEqual({ error: another });
    expect(tokenRequests()).toEqual([]);

    expect((await signIn(administrator)).signIn?.ended).toBe(false);
  });

  it("gets another access token as the last one ends, with the token it keeps for that, which it sends once", async () => {
    const administrator = await setUp();
    auth.expiresIn = 30;
    const app = await signIn(administrator);
    asked = [];
    // The next token lasts, so whatever asks after it finds it good.
    auth.token = () => ((auth.expiresIn = 3600), null);

    const read = await Promise.all([readAgain(administrator, app.id), readAgain(administrator, app.id), readAgain(administrator, app.id)]);
    expect(read.map(({ status }) => status)).toEqual([200, 200, 200]);
    expect(tokenRequests()).toEqual([{ grant_type: "refresh_token", refresh_token: "refresh-1", client_id: "ember-at-tracker", resource: TRACKER }]);
    expect(asked.filter(({ url }) => url === TRACKER).every(({ authorization }) => authorization === "Bearer access-2")).toBe(true);
    expect(asked.every(({ redirect, timed }) => redirect === "manual" && timed)).toBe(true);

    // That token is good for an hour, so nothing asks for another.
    auth.token = () => null;
    asked = [];
    expect((await readAgain(administrator, app.id)).status).toBe(200);
    expect(tokenRequests()).toEqual([]);
    expect((await appOf(await show(administrator, app.id))).signIn?.ended).toBe(false);
  });

  it("sends the token it was given last to get the next one", async () => {
    const administrator = await setUp();
    auth.expiresIn = 30;
    const app = await signIn(administrator);
    asked = [];

    expect((await readAgain(administrator, app.id)).status).toBe(200);
    expect((await readAgain(administrator, app.id)).status).toBe(200);
    expect(tokenRequests().map(({ refresh_token }) => refresh_token)).toEqual(["refresh-1", "refresh-2"]);
    expect(auth.access).toBe("access-3");
    expect((await appOf(await show(administrator, app.id))).signIn?.ended).toBe(false);
  });

  it("ends once the authorization server won't give another token: the app's page says so, and its server isn't asked until an administrator signs in again", async () => {
    const administrator = await setUp();
    auth.expiresIn = 30;
    const app = await signIn(administrator);
    await pick(administrator, true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    auth.token = () => oauthError("invalid_grant");
    asked = [];

    expect(await refusalOf(await readAgain(administrator, app.id))).toEqual({ error: signInEnded("Tracker") });
    expect(tokenRequests()).toHaveLength(1);
    expect(asked.some(({ url }) => url === TRACKER)).toBe(false);
    expect((await appOf(await show(administrator, app.id))).signIn).toEqual({ ...app.signIn, ended: true });
    expect(((await (await api("/api/account/apps", { headers: as(administrator) })).json()) as Apps).apps).toMatchObject([{ id: app.id, signInEnded: true }]);
    expect(await workspaceSql("SELECT sign_in FROM apps")).toEqual([{ sign_in: null }]);
    // Nothing is asked for it any more.
    asked = [];
    expect(await refusalOf(await readAgain(administrator, app.id))).toEqual({ error: signInEnded("Tracker") });
    expect(asked).toEqual([]);

    // Signing in again keeps the app, and the tools picked from it.
    auth.token = () => null;
    auth.expiresIn = 3600;
    const to = await sentTo(await beginAgain(administrator, app.id));
    expect(await workspaceSql("SELECT app_id, name, url FROM app_sign_ins")).toEqual([{ app_id: app.id, name: "Tracker", url: TRACKER }]);
    const again = await signedInBy(await finish(administrator, comeBack(to)), 200);
    expect(again).toMatchObject({ id: app.id, name: "Tracker", hasToken: false, tools: [{ name: "search_issues" }], setAside: [] });
    expect(again.signIn).toMatchObject({ by: administrator.user, ended: false });
    expect(((await (await api("/api/account/apps", { headers: as(administrator) })).json()) as Apps).apps).toMatchObject([{ id: app.id, signInEnded: false }]);
    expect((await readAgain(administrator, app.id)).status).toBe(200);
    expect((await offered(administrator))[0]!.tools.map(({ picked }) => picked)).toEqual([true]);
  });

  it("ends with its access token when the authorization server gave none to get another with", async () => {
    const administrator = await setUp();
    auth.expiresIn = 30;
    auth.refreshes = false;
    const app = await signIn(administrator);
    asked = [];

    expect(await refusalOf(await readAgain(administrator, app.id))).toEqual({ error: signInEnded("Tracker") });
    expect(asked).toEqual([]);
    expect((await appOf(await show(administrator, app.id))).signIn?.ended).toBe(true);
  });

  it("keeps the token it has when the authorization server can't be asked for another now", async () => {
    const administrator = await setUp();
    auth.expiresIn = 30;
    const app = await signIn(administrator);
    vi.spyOn(console, "error").mockImplementation(() => {});
    auth.token = () => oauthError("server_error", 503);
    asked = [];

    expect((await readAgain(administrator, app.id)).status).toBe(200);
    expect(tokenRequests()).toHaveLength(1);
    expect(asked.filter(({ url }) => url === TRACKER).every(({ authorization }) => authorization === "Bearer access-1")).toBe(true);
    expect((await appOf(await show(administrator, app.id))).signIn?.ended).toBe(false);
  });

  it("asks an app as it's signed in to by then, when an administrator signs in again while Ember gets the last sign-in's next token", async () => {
    const administrator = await setUp();
    auth.expiresIn = 30;
    const app = await signIn(administrator);
    // The administrator is at the authorization server, and comes back just as Ember asks it for the last sign-in's next token,
    // which it refuses: it has given the next sign-in's tokens since.
    const back = comeBack(await sentTo(await beginAgain(administrator, app.id)));
    vi.spyOn(console, "error").mockImplementation(() => {});
    let again: App | undefined;
    auth.token = async ({ grant_type: grant }) => {
      if (grant !== "refresh_token" || again) return null;
      auth.expiresIn = 3600;
      again = await signedInBy(await finish(administrator, back), 200);
      return null;
    };
    asked = [];

    expect((await readAgain(administrator, app.id)).status).toBe(200);
    expect(tokenRequests().map(({ grant_type: grant }) => grant)).toEqual(["refresh_token", "authorization_code"]);
    // The refusal ends nothing, as the sign-in it was for is no longer the app's: the server is asked with the next one's token.
    const tools = asked.filter(({ url, json }) => url === TRACKER && json?.method === "tools/list");
    expect(tools.map(({ authorization }) => authorization)).toEqual([`Bearer ${auth.access}`, `Bearer ${auth.access}`]);
    expect((await appOf(await show(administrator, app.id))).signIn).toEqual({ ...again!.signIn, ended: false });
    expect((await readAgain(administrator, app.id)).status).toBe(200);
    expect(tokenRequests()).toHaveLength(2);
  });

  it("doesn't keep what a server answered one account, once an administrator has signed in to it again as it answered", async () => {
    const administrator = await setUp();
    const app = await signIn(administrator);
    // The read that's under way was answered with one tool, and the sign-in made meanwhile reads two.
    auth.listing = async () => {
      auth.tools = [SEARCH_ISSUES, CLOSE_ISSUE];
      await signInAgain(administrator, app.id);
    };

    expect(await refusalOf(await readAgain(administrator, app.id), 409)).toEqual({ error: APP_CHANGED });
    expect((await appOf(await show(administrator, app.id))).tools.map(({ name }) => name)).toEqual(["search_issues", "close_issue"]);
  });

  it("doesn't send a call of a tool that's taken from its agent, or whose app is removed, while Ember gets the sign-in's next token", async () => {
    const administrator = await setUp();
    auth.expiresIn = 30;
    const app = await signIn(administrator);
    await pick(administrator, true);
    const { name, fingerprint } = (await offered(administrator))[0]!.tools[0]!;
    const tool = { appId: app.id, name, fingerprint };
    const called = () => workspaceStub().appToolCall(ASSISTANT_ID, tool, false);
    expect(await called()).toMatchObject({ url: TRACKER, key: { token: "access-2", signedIn: true }, signedIn: true });

    auth.token = async () => (await pick(administrator, false), null);
    expect(await called()).toBeNull();
    auth.token = () => null;
    await pick(administrator, true);
    expect(await called()).toMatchObject({ key: { token: "access-4" } });

    auth.token = async () => (expect((await disconnect(administrator, app.id)).status).toBe(204), null);
    expect(await called()).toBeNull();
  });

  it("keeps a signed-in app's address, and takes no token for it, as its sign-in is to the server there", async () => {
    const administrator = await setUp();
    const app = await signIn(administrator);
    asked = [];

    expect(await refusalOf(await change(administrator, app.id, { url: "https://mcp.elsewhere.example/mcp" }))).toEqual({ error: APP_SIGNED_IN, field: "url" });
    expect(await refusalOf(await change(administrator, app.id, { token: "a-token-in-its-place" }))).toEqual({ error: APP_SIGNED_IN, field: "token" });
    expect(await refusalOf(await change(administrator, app.id, { token: "" }))).toEqual({ error: APP_SIGNED_IN, field: "token" });
    expect(asked).toEqual([]);
    expect(await appOf(await change(administrator, app.id, { name: "Issues", url: TRACKER }))).toMatchObject({ name: "Issues", url: TRACKER, signIn: { ended: false } });
  });

  it("offers a sign-in for an app whose server takes its token no longer, which signing in then takes the place of", async () => {
    const administrator = await setUp();
    vi.spyOn(console, "error").mockImplementation(() => {});
    auth.access = "a-token-the-server-takes";
    const connected = await connect(administrator, { ...TRACKER_APP, token: "a-token-the-server-takes" });
    expect(connected.status, await connected.clone().text()).toBe(201);
    const { app } = (await connected.json()) as AppAnswer;
    expect(app).toMatchObject({ hasToken: true, signIn: null });

    auth.access = null;
    expect(await refusalOf(await readAgain(administrator, app.id))).toEqual({ error: "mcp.tracker.example didn't take that token.", signIn: true });
    expect(await refusalOf(await change(administrator, app.id, { token: "another-token" }))).toEqual({ error: "mcp.tracker.example didn't take that token.", field: "token", signIn: true });

    const signedIn = await signInAgain(administrator, app.id);
    expect(signedIn).toMatchObject({ id: app.id, hasToken: false, signIn: { by: administrator.user, ended: false, clientId: null } });
    expect(await workspaceSql("SELECT token FROM apps")).toEqual([{ token: null }]);
    expect((await readAgain(administrator, app.id)).status).toBe(200);
  });

  it("forgets a sign-in under way to an app that's removed", async () => {
    const administrator = await setUp();
    const app = await signIn(administrator);
    const back = comeBack(await sentTo(await beginAgain(administrator, app.id)));

    expect((await disconnect(administrator, app.id)).status).toBe(204);
    expect(await workspaceSql("SELECT count(*) AS n FROM app_sign_ins")).toEqual([{ n: 0 }]);
    expect(await refusalOf(await finish(administrator, back))).toEqual({ error: APP_SIGN_IN_ENDED });
  });

  it("signs in as the client an administrator gives, where the service doesn't let Ember register itself, and keeps it for signing in again", async () => {
    const administrator = await setUp();
    vi.spyOn(console, "error").mockImplementation(() => {});
    auth.registers = false;
    auth.client = { id: "ember-oauth-app", secret: "s3cret-of-the-client" };
    auth.expiresIn = 30;
    const proven = `Basic ${btoa("ember-oauth-app:s3cret-of-the-client")}`;
    const provenAt = () => asked.filter(({ url }) => url === `${AUTH}/token`).map(({ authorization, form }) => [form!.grant_type, authorization]);

    expect(await refusalOf(await begin(administrator))).toEqual(UNREGISTERED);
    expect(await refusalOf(await begin(administrator, { ...TRACKER_APP, clientSecret: "s3cret-of-the-client" }))).toEqual({ error: "A client secret goes with a client ID", field: "clientId" });
    expect(await refusalOf(await begin(administrator, { ...TRACKER_APP, clientId: "ember\noauth" }))).toMatchObject({ field: "clientId" });

    // The browser goes there as that client, which nothing is asked to register, and the code it comes back with is exchanged with the secret.
    asked = [];
    const authorizationUrl = await sentTo(await begin(administrator, { ...TRACKER_APP, clientId: " ember-oauth-app ", clientSecret: "s3cret-of-the-client" }));
    expect(authorizationUrl.searchParams.get("client_id")).toBe("ember-oauth-app");
    expect(asked.some(({ url }) => url === `${AUTH}/register`)).toBe(false);
    const app = await signedInBy(await finish(administrator, comeBack(authorizationUrl)));
    expect(app.signIn).toMatchObject({ ended: false, clientId: "ember-oauth-app" });
    expect(provenAt()).toEqual([["authorization_code", proven]]);
    // The client's ID is kept to show, and its secret sealed, beside the sign-in.
    const [kept] = (await workspaceSql("SELECT sign_in, sign_in_client_id, sign_in_client FROM apps")) as [{ sign_in: string; sign_in_client_id: string; sign_in_client: string }];
    expect(kept.sign_in_client_id).toBe("ember-oauth-app");
    expect(JSON.stringify(kept)).not.toContain("s3cret");

    // Another token is asked for as that client too.
    asked = [];
    expect((await readAgain(administrator, app.id)).status).toBe(200);
    expect(provenAt()).toEqual([["refresh_token", proven]]);

    // Once the sign-in has ended, signing in again asks for neither again.
    auth.token = ({ grant_type: grant }) => (grant === "refresh_token" ? oauthError("invalid_grant") : null);
    expect(await refusalOf(await readAgain(administrator, app.id))).toEqual({ error: signInEnded("Tracker") });
    expect((await appOf(await show(administrator, app.id))).signIn).toMatchObject({ ended: true, clientId: "ember-oauth-app" });
    asked = [];
    const again = await sentTo(await beginAgain(administrator, app.id));
    expect(again.searchParams.get("client_id")).toBe("ember-oauth-app");
    expect((await signedInBy(await finish(administrator, comeBack(again)), 200)).signIn).toMatchObject({ ended: false, clientId: "ember-oauth-app" });
    expect(provenAt()).toEqual([["authorization_code", proven]]);
    // Nor does the app's page, which sends the client ID as it shows it, with no secret.
    asked = [];
    const untouched = await sentTo(await beginAgain(administrator, app.id, { clientId: "ember-oauth-app" }));
    await signedInBy(await finish(administrator, comeBack(untouched)), 200);
    expect(provenAt()).toEqual([["authorization_code", proven]]);

    // Another client ID goes without the last one's secret, which the service refuses here, leaving the app signed in as it was.
    asked = [];
    const other = await sentTo(await beginAgain(administrator, app.id, { clientId: "another-app" }));
    expect(other.searchParams.get("client_id")).toBe("another-app");
    expect(await refusalOf(await finish(administrator, comeBack(other)))).toEqual({
      error: "mcp.tracker.example didn't take the client ID or secret Ember signed in with. Check both, and start the sign-in again.",
    });
    expect(JSON.stringify(asked)).not.toContain("s3cret");
    expect((await appOf(await show(administrator, app.id))).signIn).toMatchObject({ ended: false, clientId: "ember-oauth-app" });

    // With none, Ember has the service come to know it by itself, where it can, and keeps no client.
    expect(await refusalOf(await beginAgain(administrator, app.id, { clientId: "" }))).toEqual(UNREGISTERED);
    auth.registers = true;
    auth.client = null;
    const itself = await sentTo(await beginAgain(administrator, app.id, { clientId: "" }));
    expect(itself.searchParams.get("client_id")).toBe("ember-at-tracker");
    expect((await signedInBy(await finish(administrator, comeBack(itself)), 200)).signIn).toMatchObject({ clientId: null });
    expect(await workspaceSql("SELECT sign_in_client_id, sign_in_client FROM apps")).toEqual([{ sign_in_client_id: null, sign_in_client: null }]);
  });

  it("says why when a server's sign-in is one Ember can't use, and keeps nothing", async () => {
    const administrator = await setUp();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const elsewhere = { error: "mcp.tracker.example sends its sign-in somewhere Ember doesn't ask: an address that isn't public, or isn't https.", field: "url" };

    // An authorization server on a private network, or one that signs people in over plain http.
    auth.resource = (resource) => ({ ...resource, authorization_servers: ["https://auth.internal.example"] });
    expect(await refusalOf(await begin(administrator))).toEqual(elsewhere);
    expect(asked.some(({ url }) => url.startsWith("https://auth.internal.example"))).toBe(false);
    auth.resource = (resource) => resource;
    auth.metadata = (metadata) => ({ ...metadata, authorization_endpoint: "http://auth.tracker.example/authorize" });
    expect(await refusalOf(await begin(administrator))).toEqual(elsewhere);
    // One that would send the administrator's browser to a private network, which Ember looks up as it does what it asks itself.
    auth.metadata = (metadata) => ({ ...metadata, authorization_endpoint: "https://auth.internal.example/authorize" });
    expect(await refusalOf(await begin(administrator))).toEqual(elsewhere);
    expect(asked.some(({ url }) => url.startsWith("https://auth.internal.example"))).toBe(false);

    // One that says it's another service's, or is for another server.
    auth.metadata = (metadata) => ({ ...metadata, issuer: "https://auth.elsewhere.example" });
    expect(await refusalOf(await begin(administrator))).toEqual({ error: "The sign-in mcp.tracker.example names says it's another service's, so Ember won't use it.", field: "url" });
    auth.metadata = (metadata) => metadata;
    auth.resource = (resource) => ({ ...resource, resource: "https://mcp.elsewhere.example/mcp" });
    expect(await refusalOf(await begin(administrator))).toEqual({ error: "The sign-in mcp.tracker.example describes is for another address than its own, so Ember won't use it.", field: "url" });
    auth.resource = (resource) => resource;

    // One that neither reads Ember's document nor registers it, and a server that describes none.
    auth.registers = false;
    expect(await refusalOf(await begin(administrator))).toEqual(UNREGISTERED);
    auth.resource = () => null;
    auth.metadata = () => null;
    expect(await refusalOf(await begin(administrator))).toEqual({ error: "mcp.tracker.example doesn't say how to sign in to it. Give a token for it, if it has one.", field: "token" });

    expect(await workspaceSql("SELECT count(*) AS n FROM app_sign_ins")).toEqual([{ n: 0 }]);
  });
});
