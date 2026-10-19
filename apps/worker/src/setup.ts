import { isPasswordTooLong, isPasswordTooShort, parseSignUp, PASSWORD_TOO_LONG, PASSWORD_TOO_SHORT, type NewWorkspace } from "@ember/protocol";
import { clientOf, cookieValues, isCrossSite, isHttps, newSessionToken, sessionCookie, tokenDigest } from "./auth";
import { userFormOf, userFormPhoto } from "./avatars";
import { fromBase64url, fromHex, toBase64url, toHex } from "./encoding";
import type { Env } from "./env";
import { notFound, refused } from "./error-pages";
import { appPage, empty, formAnswer, home, withCookies } from "./pages";
import { passwordHasher } from "./passwords";
import { lockedPage } from "./setup-locked";
import { workspace } from "./workspace";

// First run, which creates the workspace and its first administrator, and the lock that keeps it to
// whoever has the deployment's private setup link. Ported from ember-rust's
// crates/ember/src/controllers/first_runs.rs and first_runs/access.rs, path for path, except that
// the form posts to /api/first_run, the link unlocks setup for a day rather than 15 minutes, and
// the locked page says how to unlock it (setup-locked.ts).

/** EMBER_SETUP_TOKEN's shape, as ember-rust requires it (crates/ember/src/config.rs). */
const SETUP_TOKEN = /^[0-9a-f]{64}$/;
/** The cookie that unlocks setup once this browser has opened the private link. */
const SETUP_COOKIE = "__Host-ember_setup";
/**
 * A day, where ember-rust's lasts 15 minutes, which can run out while the form is still open: sending
 * it then lands on the locked page with what was typed gone. The token itself lasts until setup is
 * done, and rotating it still locks every browser it unlocked.
 */
const SETUP_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;
const SETUP_COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Strict";
/** AES-GCM's nonce, at the front of the cookie's value. */
const IV_BYTES = 12;

/** The access page's policy: its own script, posting to this origin, and nothing else (access.rs). */
const ACCESS_PAGE_POLICY = "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** How EMBER_SETUP_TOKEN protects setup. */
type Lock =
  /** It's unset, so the first visitor sets up the workspace, as in Campfire. */
  | { kind: "open" }
  /** Setup takes the private link. The fingerprint is the token's SHA-256, which the cookie carries. */
  | { kind: "locked"; fingerprint: Uint8Array }
  /** It's set to something that can't be a token, so setup fails closed. */
  | { kind: "misconfigured" };

/** A lock setup can go on with. */
type UsableLock = Exclude<Lock, { kind: "misconfigured" }>;

const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));

async function lockOf(env: Env): Promise<Lock> {
  const token = env.EMBER_SETUP_TOKEN;
  if (token === undefined) return { kind: "open" };
  return SETUP_TOKEN.test(token) ? { kind: "locked", fingerprint: await sha256(token) } : { kind: "misconfigured" };
}

/** Whether setup takes the private link, as `/api/bootstrap` tells the app. A malformed token counts. */
export const isSetupProtected = (env: Env) => env.EMBER_SETUP_TOKEN !== undefined;

/** What's wrong with EMBER_SETUP_TOKEN, for `/api/health`, if it's set to something that can't be a token. */
export const setupTokenProblem = (env: Env) =>
  env.EMBER_SETUP_TOKEN === undefined || SETUP_TOKEN.test(env.EMBER_SETUP_TOKEN) ? null : "EMBER_SETUP_TOKEN must be 64 lowercase hex characters";

/** Answers 500 rather than starting setup with a token that can't be right, the nearest a Worker comes to refusing to boot. */
function misconfigured(): Response {
  // Never the value, which may be most of a real token.
  console.error("EMBER_SETUP_TOKEN must be 64 lowercase hex characters (openssl rand -hex 32), so setup is refused");
  return new Response(null, { status: 500 });
}

/** The key that seals setup cookies, derived from SESSION_SECRET for this one purpose. */
async function cookieKey(env: Env): Promise<CryptoKey> {
  const secret = await crypto.subtle.importKey("raw", encoder.encode(env.SESSION_SECRET), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: encoder.encode("ember setup cookie") },
    secret,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * The `Set-Cookie` that unlocks setup for a day: the token's fingerprint, never the token, and
 * when it expires, encrypted so it can be neither read nor forged, as ember-rust's encrypted cookie is.
 */
async function unlockingCookie(fingerprint: Uint8Array, env: Env): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const payload = encoder.encode(JSON.stringify({ fingerprint: toHex(fingerprint), expires: Date.now() + SETUP_COOKIE_MAX_AGE_SECONDS * 1000 }));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cookieKey(env), payload));
  const value = new Uint8Array(IV_BYTES + sealed.length);
  value.set(iv);
  value.set(sealed, IV_BYTES);
  return `${SETUP_COOKIE}=${toBase64url(value)}; Max-Age=${SETUP_COOKIE_MAX_AGE_SECONDS}; ${SETUP_COOKIE_ATTRIBUTES}`;
}

/** Whether the request's setup cookie unlocks setup: issued for this token, under this secret, and not expired. */
async function isUnlocked(request: Request, env: Env, fingerprint: Uint8Array): Promise<boolean> {
  const key = await cookieKey(env);
  for (const value of cookieValues(request, SETUP_COOKIE)) {
    const bytes = fromBase64url(value);
    if (!bytes || bytes.length <= IV_BYTES) continue;
    try {
      const payload = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, IV_BYTES) }, key, bytes.subarray(IV_BYTES));
      const cookie = JSON.parse(decoder.decode(payload)) as { fingerprint?: unknown; expires?: unknown };
      const issuedFor = typeof cookie.fingerprint === "string" ? fromHex(cookie.fingerprint) : null;
      if (typeof cookie.expires === "number" && cookie.expires > Date.now() && issuedFor && equal(issuedFor, fingerprint)) return true;
    } catch {
      // Tampered with, or sealed under another SESSION_SECRET.
    }
  }
  return false;
}

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && crypto.subtle.timingSafeEqual(a, b);

/** Whether `token` is the setup token, compared by fingerprint so the comparison takes the same time whatever it is. */
const isSetupToken = async (token: string, fingerprint: Uint8Array) => SETUP_TOKEN.test(token) && equal(await sha256(token), fingerprint);

/** The `Set-Cookie` that forgets the setup cookie, if the request sent one. `__Host-` cookies need `Secure` even then. */
const forgetUnlocking = (request: Request) => (cookieValues(request, SETUP_COOKIE).length > 0 ? `${SETUP_COOKIE}=; Max-Age=0; ${SETUP_COOKIE_ATTRIBUTES}` : null);

/** ember-rust's `prevent_repeats`: once the workspace exists, setup sends everyone home and forgets its cookie. */
const setUpAlready = (request: Request) => withCookies(home(request), forgetUnlocking(request));

const isSetUp = async (env: Env) => (await workspace(env).account()) !== null;

/**
 * ember-rust's `authorize`, for pages: with a token set, setup takes HTTPS, no query string, and the
 * cookie the private link gives. Answers why not, or null to go on.
 */
async function refusal(request: Request, env: Env, fingerprint: Uint8Array): Promise<Response | null> {
  const { origin, search } = new URL(request.url);
  if (search) return empty(400);
  if (!isHttps(request)) return empty(403);
  if (await isUnlocked(request, env, fingerprint)) return null;
  const locked = new Response(lockedPage(origin), { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } });
  return withCookies(locked, forgetUnlocking(request));
}

/** `/first_run`: the Set up Ember page, which is the app's own, until the workspace exists. */
async function setupForm(request: Request, env: Env, lock: UsableLock, format: string | undefined): Promise<Response> {
  if (await isSetUp(env)) return setUpAlready(request);
  if (lock.kind === "locked") {
    const refused = await refusal(request, env, lock.fingerprint);
    if (refused) return refused;
  }
  // The form is a page, like ember-rust's, which answers 406 for `/first_run.json`.
  if (format !== undefined) return empty(406);
  const page = await appPage(request, env, "/");
  page.headers.set("Cache-Control", "no-store");
  // As ember-rust's does, whose form posts natively, which under no-referrer says it comes from `Origin: null`.
  if (lock.kind === "locked") page.headers.set("Referrer-Policy", "same-origin");
  return page;
}

/** `GET /first_run/access`: the page that trades the private link's token for the setup cookie. */
async function accessPage(request: Request, env: Env, lock: UsableLock): Promise<Response> {
  if (new URL(request.url).search) return empty(400);
  if (await isSetUp(env)) return setUpAlready(request);
  if (lock.kind === "open") return notFound(request);
  if (!isHttps(request)) return empty(403);
  const page = await appPage(request, env, "/first_run/access");
  page.headers.set("Content-Security-Policy", ACCESS_PAGE_POLICY);
  page.headers.set("X-Frame-Options", "DENY");
  return page;
}

/** `POST /first_run/access`: the token, posted from the access page, for the cookie that unlocks setup. */
async function unlock(request: Request, env: Env, lock: UsableLock): Promise<Response> {
  const url = new URL(request.url);
  if (isCrossSite(request)) return refused(request);
  if (url.search) return empty(400);
  if (await isSetUp(env)) return setUpAlready(request);
  if (lock.kind === "open") return notFound(request);
  if (!isHttps(request)) return empty(403);
  // Stricter than the check every write gets: only the access page's own fetch may unlock setup.
  if (request.headers.get("Sec-Fetch-Site") !== "same-origin" || request.headers.get("Origin") !== url.origin) return refused(request);
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/x-www-form-urlencoded") return empty(415);
  // Only from the body, never the address, which servers and browsers keep.
  const body = await request.formData().catch(() => null);
  if (!body) return empty(400);
  const [token, ...more] = body.getAll("token");
  if (typeof token !== "string" || more.length > 0 || !(await isSetupToken(token, lock.fingerprint))) return empty(403);
  return withCookies(empty(204), await unlockingCookie(lock.fingerprint, env));
}

/** Whether `pathname` is one of setup's pages: /first_run, anything under /first_run/, or /first_run.<format>. */
export const isSetupPath = (pathname: string) => /^\/first_run(?:$|[/.])/.test(pathname);

/**
 * Keeps an answer for one of setup's pages out of caches and referrers, as ember-rust's app.rs does
 * whatever answers it there, the page for old browsers included: every one of them while a token is
 * set, and the access page always. The unlocked form sends a referrer to its own origin, which its
 * post needs, so a policy the answer sets itself stays.
 */
export function keepSetupPrivate(response: Response, env: Env, pathname: string): Response {
  if (!isSetupPath(pathname) || (!isSetupProtected(env) && pathname !== "/first_run/access")) return response;
  response.headers.set("Cache-Control", "no-store");
  if (!response.headers.has("Referrer-Policy")) response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/** Answers a request for one of setup's pages. */
export async function setupPage(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const lock = await lockOf(env);
  const response = lock.kind === "misconfigured" ? misconfigured() : await route(request, env, lock, pathname);
  return keepSetupPrivate(response, env, pathname);
}

async function route(request: Request, env: Env, lock: UsableLock, pathname: string): Promise<Response> {
  const read = request.method === "GET" || request.method === "HEAD";
  const form = pathname.match(/^\/first_run(?:\.(.+))?$/);
  if (form && read) return setupForm(request, env, lock, form[1]);
  if (pathname === "/first_run/access" && read) return accessPage(request, env, lock);
  if (pathname === "/first_run/access" && request.method === "POST") return unlock(request, env, lock);
  return notFound(request);
}

/**
 * `POST /api/first_run`: creates the workspace with the person the Set up Ember form describes as its
 * first administrator, with the photo it brings, and signs this browser in as them.
 */
export async function firstRun(request: Request, env: Env): Promise<Response> {
  const lock = await lockOf(env);
  if (lock.kind === "misconfigured") return misconfigured();
  const forget = forgetUnlocking(request);
  const setUp = { error: "Ember is already set up", redirect: "/" };
  if (await isSetUp(env)) return formAnswer(setUp, 409, forget);
  if (lock.kind === "locked" && !(isHttps(request) && (await isUnlocked(request, env, lock.fingerprint)))) {
    return formAnswer({ error: "Setup is locked" }, 403, forget);
  }

  const sent = await userFormOf(request);
  if ("error" in sent) return formAnswer({ error: sent.error, field: "avatar" }, sent.status);
  const form = parseSignUp(sent.fields);
  if (typeof form === "string") return formAnswer({ error: form }, 400);
  // Before anything is hashed or saved, as in ember-rust. Unlike bcrypt, which ignores all but a
  // password's first 72 bytes, PBKDF2 hashes every character, so the server takes no more than the
  // form can send.
  if (isPasswordTooLong(form.password)) return formAnswer({ error: PASSWORD_TOO_LONG, field: "password" }, 422);
  if (isPasswordTooShort(form.password)) return formAnswer({ error: PASSWORD_TOO_SHORT, field: "password" }, 422);
  const avatar = await userFormPhoto(env, sent.photo);
  if (avatar && "error" in avatar) return formAnswer({ error: avatar.error, field: "avatar" }, avatar.status);

  const passwordDigest = await passwordHasher(env).hash(form.password);
  const token = newSessionToken();
  const administrator = { name: form.name, emailAddress: form.emailAddress, passwordDigest, avatar };
  const created = await workspace(env).createWorkspace(administrator, await tokenDigest(token, env.SESSION_SECRET), clientOf(request));
  // Another first run finished first. Like ember-rust, send this one home without signing it in.
  if (!created) return formAnswer(setUp, 409, forget);
  return formAnswer(created satisfies NewWorkspace, 201, sessionCookie(request, token), forget);
}
