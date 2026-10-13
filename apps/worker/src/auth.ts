import type { User } from "@ember/protocol";
import type { Env } from "./env";
import { workspace } from "./workspace";
import type { Client } from "./workspace-store";

// Sessions ride an HttpOnly cookie holding a random token, and the Workspace keeps only its digest.
// This is ember-rust's session cookie (crates/ember/src/concerns.rs), with the secret that signs
// ember-rust's cookie keying the digest instead.

/** As long as browsers keep a cookie, 400 days, standing in for ember-rust's 20 years. */
const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
/** 32 random bytes in base64url. */
const SESSION_TOKEN = /^[\w-]{43}$/;

const encoder = new TextEncoder();

const isHttps = (request: Request) => new URL(request.url).protocol === "https:";

/**
 * Over HTTPS the `__Host-` prefix makes browsers refuse the cookie from any other origin, such as
 * another Worker on workers.dev. Plain HTTP, where `wrangler dev` and the browser tests run, can't
 * use it.
 */
const sessionCookieName = (request: Request) => (isHttps(request) ? "__Host-session_token" : "session_token");

function setCookie(request: Request, value: string, maxAge: number): string {
  const secure = isHttps(request) ? "; Secure" : "";
  return `${sessionCookieName(request)}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

/** The `Set-Cookie` that signs this browser in with `token`, or refreshes how long it stays signed in. */
export const sessionCookie = (request: Request, token: string) => setCookie(request, token, SESSION_MAX_AGE_SECONDS);

/** The `Set-Cookie` that makes this browser forget its session. */
export const expiredSessionCookie = (request: Request) => setCookie(request, "", 0);

/** The session token the request's cookie carries, if it looks like one. */
function sessionToken(request: Request): string | null {
  const name = sessionCookieName(request);
  for (const pair of request.headers.get("Cookie")?.split(";") ?? []) {
    const separator = pair.indexOf("=");
    const value = pair.slice(separator + 1).trim();
    if (separator > 0 && pair.slice(0, separator).trim() === name && SESSION_TOKEN.test(value)) return value;
  }
  return null;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const newSessionToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

/**
 * What the Workspace stores in place of a token: its HMAC under SESSION_SECRET. A leaked database
 * holds no sessions, and changing the secret signs everyone out, as changing ember-rust's does.
 */
export async function tokenDigest(token: string, secret: string): Promise<string> {
  if (!secret) throw new Error("SESSION_SECRET isn't set. Copy apps/worker/.dev.vars.example to .dev.vars.");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(token))));
}

/** Whether people may sign in with just a name, and guests who did may stay signed in. */
export const guestSignIn = (env: Env) => env.EMBER_GUEST_SIGN_IN === "true";

/** The browser and IP a session records, as ember-rust's does. */
export const clientOf = (request: Request): Client => ({
  ip: request.headers.get("CF-Connecting-IP"),
  userAgent: request.headers.get("User-Agent"),
});

/** The person whose session the request's cookie names, if it names one that's still valid, and its token. */
export async function authenticate(request: Request, env: Env): Promise<{ user: User; token: string } | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const user = await workspace(env).authenticate(await tokenDigest(token, env.SESSION_SECRET), clientOf(request), guestSignIn(env));
  return user && { user, token };
}

/** Ends the session the request's cookie names, if any. */
export async function signOut(request: Request, env: Env): Promise<void> {
  const token = sessionToken(request);
  if (token) await workspace(env).signOut(await tokenDigest(token, env.SESSION_SECRET));
}

/**
 * Whether a write comes from another site, ported from ember-rust's header-only forgery protection
 * (crates/kit/src/ctx.rs): no tokens, just `Origin` and `Sec-Fetch-Site`. Unlike ember-rust it refuses
 * `same-site` too, since on workers.dev every other Worker on the account is the same site.
 */
export function isCrossSite(request: Request): boolean {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== url.origin) return true;
  const site = request.headers.get("Sec-Fetch-Site");
  // Browsers only send the header to secure origins, so plain HTTP relies on SameSite=Lax instead.
  return !(site === "same-origin" || (site === null && url.protocol === "http:"));
}

/** Whether a WebSocket upgrade comes from the app's own pages, as Action Cable insists (crates/cable/src/server.rs). */
export const isSameOriginUpgrade = (request: Request) => request.headers.get("Origin") === new URL(request.url).origin;
