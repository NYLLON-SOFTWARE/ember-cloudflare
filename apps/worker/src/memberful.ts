import { MEMBERFUL_PROBLEM_PARAM, workspacePageOf, type AccountSettings, type MemberfulSignInProblem } from "@ember/protocol";
import { clientOf, cookieValues, hostCookie, hostCookieName, newSessionToken, sessionCookie, tokenDigest } from "./auth";
import { bytesUpTo, MAX_JSON_BODY_BYTES } from "./bodies";
import { originFor } from "./custom-domain";
import { fromHex, toBase64url, urlsafeDecode64 } from "./encoding";
import type { Env } from "./env";
import { notFound } from "./error-pages";
import { isSubject, memberfulApiOf, memberfulKeysOf, memberWhoSignedIn, type MemberfulApi } from "./memberful-api";
import { home, withCookies } from "./pages";
import { isToken } from "./secrets";
import { workspace } from "./workspace";

// Signing in with Memberful (`auth.memberful-sign-in`), this port's own, as ember-rust signs people in
// with passwords alone. Memberful speaks OAuth 2.0 but not OpenID Connect, so this follows its guide for
// a server-side custom app (memberful.com/docs/api-reference/sign-in-for-apps-via-oauth): Sign in with
// Memberful sends the browser to the site's `/oauth` with a random state, which a cookie keeps, and the
// site sends it back to the callback with that state and a code, which the Worker exchanges, with the
// app's client secret, for an access token to ask the member API who signed in. It works only while an
// administrator has turned Memberful sign-in on, and the deployment has the app's keys.

/** The cookie that keeps a sign-in's state, and the page to come back to, until Memberful sends the browser back. */
const STATE_COOKIE = "memberful_state";
/** How long that takes at most: long enough to sign in at Memberful, or sign up there. */
const STATE_MAX_AGE_SECONDS = 10 * 60;
/** The longest page to come back to that the cookie keeps. Any longer, and signing in goes home. */
const MAX_RETURN_PATH_LENGTH = 1024;
/** Where Memberful signs a webhook: the HMAC-SHA256 of its body, under the webhook's secret, in hex. */
const SIGNATURE_HEADER = "X-Memberful-Webhook-Signature";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

/** Why Memberful sign-in can't be turned on: the deployment lacks the keys of a Memberful site's custom app. */
export const MEMBERFUL_KEYS_NEEDED = "Memberful sign-in needs MEMBERFUL_URL, MEMBERFUL_CLIENT_ID and MEMBERFUL_CLIENT_SECRET set first";

/** Why `settings` can't be saved with the keys the deployment has: turning Memberful sign-in on takes them all. Null when they can. */
export const memberfulRefusal = (settings: AccountSettings | undefined, env: Env) =>
  settings?.memberfulSignIn && !memberfulKeysOf(env) ? MEMBERFUL_KEYS_NEEDED : null;

/** A redirect to `location`, which no cache keeps, since it signs someone in, or starts to. */
const redirect = (location: string, ...cookies: string[]) =>
  withCookies(new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } }), ...cookies);

/** Sends the browser back to sign in, which says why signing in with Memberful didn't work. */
const backToSignIn = (request: Request, problem: MemberfulSignInProblem) =>
  redirect(new URL(`/session/new?${MEMBERFUL_PROBLEM_PARAM}=${problem}`, request.url).href);

/**
 * The page of the workspace at `origin` that `returnTo` names, its query and fragment included, or "/"
 * for anything else, so that signing in only ever opens a page here, or for one too long to keep, as
 * its address writes it, with every character that isn't ASCII escaped.
 */
function returnPathOf(returnTo: string | null, origin: string): string {
  const url = returnTo === null ? null : URL.parse(returnTo, origin);
  const path = url?.origin === origin && workspacePageOf(url.pathname) ? `${url.pathname}${url.search}${url.hash}` : "/";
  return path.length <= MAX_RETURN_PATH_LENGTH ? path : "/";
}

/** The `Set-Cookie` that keeps a sign-in's `state` and the page to come back to, `returnPath`. */
const stateCookie = (request: Request, state: string, returnPath: string) =>
  hostCookie(request, STATE_COOKIE, `${state}.${toBase64url(encoder.encode(returnPath))}`, STATE_MAX_AGE_SECONDS);

/** The `Set-Cookie` that forgets it. */
const expiredStateCookie = (request: Request) => hostCookie(request, STATE_COOKIE, "", 0);

/** The state and the page to come back to that the request's cookie keeps, if it keeps any. */
function keptStateOf(request: Request): { state: string; returnPath: string } | null {
  const [kept] = cookieValues(request, hostCookieName(request, STATE_COOKIE));
  const [state, encoded] = kept?.split(".") ?? [];
  const bytes = encoded === undefined ? null : urlsafeDecode64(encoded);
  if (!state || !bytes) return null;
  try {
    return { state, returnPath: returnPathOf(decoder.decode(bytes), new URL(request.url).origin) };
  } catch {
    return null;
  }
}

/**
 * `GET /auth/memberful`, Sign in with Memberful: sends the browser to sign in at the Memberful site,
 * keeping a new state and the page `return_to` names in a cookie, to come back to Ember's address, its
 * custom domain if it has one, where Memberful sends the browser back. Before first run it goes home,
 * and while Memberful sign-in is off, or the deployment lacks its keys, back to sign in, which says so.
 */
export async function startMemberfulSignIn(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return notFound(request);
  const account = await workspace(env).account();
  if (!account) return home(request);
  if (!account.memberfulSignIn) return backToSignIn(request, "off");
  const keys = memberfulKeysOf(env);
  if (!keys) return backToSignIn(request, "unavailable");
  const url = new URL(request.url);
  // The cookie is only sent back to the address that set it.
  const origin = originFor(request, account.customDomain);
  if (origin !== url.origin) return redirect(new URL(`${url.pathname}${url.search}`, origin).href);
  const state = newSessionToken();
  const authorize = new URL("/oauth", keys.site);
  authorize.search = new URLSearchParams({ response_type: "code", client_id: keys.clientId, state }).toString();
  return redirect(authorize.href, stateCookie(request, state, returnPathOf(url.searchParams.get("return_to"), origin)));
}

/**
 * `GET /auth/memberful/callback`, where Memberful sends the browser back: signs it in as whoever signed
 * in there (`Workspace.signInWithMemberful`), and opens the page the sign-in was started from, or else
 * goes back to sign in, which says why not. Each state is good for one try, whatever comes of it.
 */
export async function finishMemberfulSignIn(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return notFound(request);
  const answer = await signedInWithMemberful(request, env);
  answer.headers.append("Set-Cookie", expiredStateCookie(request));
  return answer;
}

async function signedInWithMemberful(request: Request, env: Env): Promise<Response> {
  const keys = memberfulKeysOf(env);
  if (!keys) return backToSignIn(request, "unavailable");
  const params = new URL(request.url).searchParams;
  const [kept, state, code] = [keptStateOf(request), params.get("state"), params.get("code")];
  // A state this browser didn't start with, as another site's link to the callback would bring, signs
  // nobody in, nor does a callback without a code.
  if (!kept || state === null || !(await isToken(state, kept.state)) || !code) return backToSignIn(request, "failed");
  // Each try counts against the address's sign-in limit, before Memberful is asked anything.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const begunAt = await workspace(env).beginMemberfulSignIn(ip);
  if (begunAt === "limited") return backToSignIn(request, "refused");
  const member = await memberWhoSignedIn(keys, code);
  if (!member) return backToSignIn(request, "failed");
  const token = newSessionToken();
  const user = await workspace(env).signInWithMemberful(keys.site, member, begunAt, await tokenDigest(token, env.SESSION_SECRET), clientOf(request));
  if (typeof user === "string") return backToSignIn(request, user);
  return redirect(new URL(kept.returnPath, request.url).href, sessionCookie(request, token));
}

/**
 * `POST /webhooks/memberful`, where the Memberful site says a member's account, subscription or order
 * changed (`auth.memberful-memberships`): once its signature checks out, the Workspace queues checking
 * that member's membership with the admin API, if they're linked to someone here, rather than trusting
 * what it says, as Memberful advises, since its webhooks can come in any order
 * (memberful.com/docs/api-reference/webhooks). Answers 404 without the webhook's secret and the API key
 * to check with, 401 to a signature that doesn't check out, 413 to a body over the limit, and 204 to
 * anything else, which Memberful takes as delivered.
 */
export async function memberfulWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return notFound(request);
  const webhooks = memberfulWebhooksOf(env);
  if (!webhooks) {
    console.error("A Memberful webhook came, but the deployment lacks MEMBERFUL_WEBHOOK_SECRET or MEMBERFUL_API_KEY, so it's refused");
    return new Response(null, { status: 404 });
  }
  const body = await bytesUpTo(request, MAX_JSON_BODY_BYTES);
  if (body === null) return new Response(null, { status: 413 });
  if (!(await isSignedWith(webhooks.secret, body, request.headers.get(SIGNATURE_HEADER)))) return new Response(null, { status: 401 });
  const subject = subjectOf(parsed(body));
  if (subject !== null) await workspace(env).queueMembershipCheck(webhooks.api.site, subject);
  return new Response(null, { status: 204 });
}

/**
 * What hearing Memberful's webhooks takes, or null without it all: the deployment's Memberful site and
 * its custom app's API key, to check what one says with, and the secret Memberful signs them with.
 */
export function memberfulWebhooksOf(env: Env): { api: MemberfulApi; secret: string } | null {
  const api = memberfulApiOf(env);
  const secret = env.MEMBERFUL_WEBHOOK_SECRET?.trim();
  return api && secret ? { api, secret } : null;
}

/** Whether `signature` is the hex HMAC-SHA256 of `body` under `secret`, compared in constant time. */
async function isSignedWith(secret: string, body: ArrayBuffer, signature: string | null): Promise<boolean> {
  const signed = signature === null ? null : fromHex(signature.trim().toLowerCase());
  if (signed?.byteLength !== 32) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signed, body);
}

/** The JSON value `body` holds, or null for none. */
function parsed(body: ArrayBuffer): unknown {
  try {
    return JSON.parse(decoder.decode(body));
  } catch {
    return null;
  }
}

/**
 * The member a webhook's payload is about, by their member id, where Memberful's WordPress plugin finds
 * it: `member.id` for a member's event, and the `member` of the subscription or order an event of theirs
 * is about. Null for anything else, such as a plan's event, which says nothing about anyone's membership.
 */
function subjectOf(payload: unknown): string | null {
  const { member, subscription, order } = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const about = [member, (subscription as { member?: unknown } | null)?.member, (order as { member?: unknown } | null)?.member];
  const id = about.map((someone) => (someone as { id?: unknown } | null)?.id).find((id) => id !== undefined && id !== null);
  // Memberful's ids are numbers in a webhook's JSON, and strings in its GraphQL API, as accounts are linked by them.
  const subject = typeof id === "number" && Number.isSafeInteger(id) ? String(id) : id;
  return isSubject(subject) ? subject : null;
}
