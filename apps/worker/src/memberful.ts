import {
  MAX_EMAIL_ADDRESS_LENGTH,
  MAX_USER_NAME_LENGTH,
  MEMBERFUL_PROBLEM_PARAM,
  workspacePageOf,
  type AccountSettings,
  type MemberfulSignInProblem,
} from "@ember/protocol";
import { clientOf, cookieValues, hostCookie, hostCookieName, newSessionToken, sessionCookie, tokenDigest } from "./auth";
import { originFor } from "./custom-domain";
import { toBase64url, urlsafeDecode64 } from "./encoding";
import type { Env } from "./env";
import { notFound } from "./error-pages";
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

/** The deployment's Memberful site, and the keys of its custom app. */
export interface MemberfulKeys {
  /** The site's origin, such as https://example.memberful.com, by which accounts on it are linked. */
  site: string;
  clientId: string;
  clientSecret: string;
}

/** Someone who signed in to the Memberful site, as its member API describes them. */
export interface MemberfulMember {
  /** Their member id, by which accounts here are linked to theirs. */
  id: string;
  /** What someone new is called here: their full name, else their email address's local part, else "Member". */
  name: string;
  /** Their email address, or null when they have none Ember can keep. */
  emailAddress: string | null;
  /** Whether they have an active subscription, or the all access pass (`unrestrictedAccess`). */
  subscribed: boolean;
}

/** The cookie that keeps a sign-in's state, and the page to come back to, until Memberful sends the browser back. */
const STATE_COOKIE = "memberful_state";
/** How long that takes at most: long enough to sign in at Memberful, or sign up there. */
const STATE_MAX_AGE_SECONDS = 10 * 60;
/** The longest page to come back to that the cookie keeps. Any longer, and signing in goes home. */
const MAX_RETURN_PATH_LENGTH = 1024;
/** How long Memberful has to answer each request. */
const MEMBERFUL_TIMEOUT_MS = 10_000;
/** What the member API is asked of who signed in. */
const MEMBER_QUERY = "{ currentMember { id email fullName unrestrictedAccess subscriptions { active } } }";
/** The longest member id kept: far longer than Memberful's, which are numbers. */
const MAX_SUBJECT_LENGTH = 255;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

/**
 * The deployment's Memberful keys, or null without all three, or with a site that isn't an https
 * address. The site is the address's origin, so a path or trailing slash after it changes nothing.
 */
export function memberfulKeysOf(env: Env): MemberfulKeys | null {
  const [url, clientId, clientSecret] = [env.MEMBERFUL_URL?.trim(), env.MEMBERFUL_CLIENT_ID?.trim(), env.MEMBERFUL_CLIENT_SECRET?.trim()];
  if (!url || !clientId || !clientSecret) return null;
  const site = URL.parse(url);
  if (site?.protocol === "https:") return { site: site.origin, clientId, clientSecret };
  console.error("MEMBERFUL_URL must be a Memberful site's https address, such as https://example.memberful.com, so Memberful sign-in is off");
  return null;
}

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
  if ((await workspace(env).beginSignIn(ip, null)) === "limited") return backToSignIn(request, "refused");
  const member = await memberWhoSignedIn(keys, code);
  if (!member) return backToSignIn(request, "failed");
  const token = newSessionToken();
  const user = await workspace(env).signInWithMemberful(keys.site, member, await tokenDigest(token, env.SESSION_SECRET), clientOf(request));
  if (typeof user === "string") return backToSignIn(request, user);
  return redirect(new URL(kept.returnPath, request.url).href, sessionCookie(request, token));
}

/**
 * Who signed in at the Memberful site to be given `code`, as its member API says, having exchanged the
 * code for an access token. Null when Memberful refuses the code, or doesn't answer, or not as it should,
 * which is logged without anything it sent.
 */
async function memberWhoSignedIn({ site, clientId, clientSecret }: MemberfulKeys, code: string): Promise<MemberfulMember | null> {
  try {
    // Never following a redirect, which would take the client secret, or the access token, elsewhere.
    const exchanged = await fetch(new URL("/oauth/token", site), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret }),
      redirect: "manual",
      signal: AbortSignal.timeout(MEMBERFUL_TIMEOUT_MS),
    });
    const accessToken = exchanged.ok ? accessTokenOf(await exchanged.json()) : null;
    if (!accessToken) return refused("token", exchanged);
    const asked = await fetch(new URL(`/api/graphql/member?${new URLSearchParams({ query: MEMBER_QUERY })}`, site), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(MEMBERFUL_TIMEOUT_MS),
    });
    const member = asked.ok ? memberOf(await asked.json()) : null;
    return member ?? refused("member", asked);
  } catch (error) {
    console.error("Signing in with Memberful failed:", error instanceof Error ? error.name : "unknown error");
    return null;
  }
}

/** Logs that Memberful's `endpoint` didn't answer as it should, with its status only, and answers null. */
async function refused(endpoint: "token" | "member", response: Response): Promise<null> {
  if (!response.bodyUsed) await response.body?.cancel();
  console.error(`Memberful's ${endpoint} endpoint answered ${response.status}${response.ok ? " without what it should" : ""}`);
  return null;
}

/** The access token in the token endpoint's answer, if it has one. */
function accessTokenOf(answer: unknown): string | null {
  const token = (answer as { access_token?: unknown } | null)?.access_token;
  return typeof token === "string" && token !== "" ? token : null;
}

/** The member the member API's answer describes, or null when it describes none. */
function memberOf(answer: unknown): MemberfulMember | null {
  const member = (answer as { data?: { currentMember?: unknown } } | null)?.data?.currentMember;
  if (typeof member !== "object" || member === null) return null;
  const { id, email, fullName, unrestrictedAccess, subscriptions } = member as Record<string, unknown>;
  if (typeof id !== "string" || id === "" || id.length > MAX_SUBJECT_LENGTH) return null;
  const given = typeof email === "string" ? email.trim() : "";
  const emailAddress = given !== "" && given.length <= MAX_EMAIL_ADDRESS_LENGTH ? given : null;
  const active = Array.isArray(subscriptions) && subscriptions.some((subscription) => (subscription as { active?: unknown } | null)?.active === true);
  return { id, name: nameOf(fullName, emailAddress), emailAddress, subscribed: unrestrictedAccess === true || active };
}

/** What someone new is called here: `fullName`, else their email address's local part, else "Member", cut to the longest name. */
function nameOf(fullName: unknown, emailAddress: string | null): string {
  const name = (typeof fullName === "string" ? fullName.trim() : "") || emailAddress?.split("@")[0]?.trim() || "Member";
  // Without half of a character cut in two.
  const cut = name
    .slice(0, MAX_USER_NAME_LENGTH)
    .replace(/[\uD800-\uDBFF]$/, "")
    .trimEnd();
  return cut || "Member";
}
