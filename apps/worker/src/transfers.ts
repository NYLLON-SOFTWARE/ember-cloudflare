import type { Me, UserId } from "@ember/protocol";
import { clientOf, guestSignIn, newSessionToken, sessionCookie, tokenDigest } from "./auth";
import { jsonBodyOf } from "./bodies";
import { toBase64url } from "./encoding";
import type { Env } from "./env";
import { notFound } from "./error-pages";
import { appPage, empty, formAnswer } from "./pages";
import { workspace } from "./workspace";

// Sign-in links, ported from ember-rust's session transfers (crates/ember/src/controllers/sessions/transfers.rs):
// opening one signs that browser in as the person its id was made for, until it expires. ember-rust's
// link is `/session/transfers/<id>`; this one keeps the id in its fragment (`transferLink`), and its
// page sends it in a request's body, so no address the Worker is asked for, nor Cloudflare's log of
// one, holds it. ember-rust's id is a Rails signed id of the person (presenters/accounts.rs); this one
// is their id and when it expires, signed with SESSION_SECRET as avatar tokens are, so changing the
// secret ends every link, as changing ember-rust's SECRET_KEY_BASE does.

/** `User::Transferable::TRANSFER_LINK_EXPIRY_DURATION`. */
export const TRANSFER_LINK_EXPIRY_MS = 4 * 60 * 60 * 1000;

const encoder = new TextEncoder();

/** What signs the link for `userId` that expires at `expiresAt`: its HMAC under `secret`, as base64url. */
async function signatureOf(userId: UserId, expiresAt: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify(["transfer", userId, expiresAt])));
  return toBase64url(new Uint8Array(signed));
}

/**
 * `user.transfer_id`: the id of a new sign-in link for `userId`, which works for 4 hours from `now`, as
 * often as it's opened: `<their id>.<when it expires, in base 36 milliseconds>.<signature>`.
 */
export async function newTransferId(userId: UserId, secret: string, now: number): Promise<string> {
  const expiresAt = (now + TRANSFER_LINK_EXPIRY_MS).toString(36);
  return `${userId}.${expiresAt}.${await signatureOf(userId, expiresAt, secret)}`;
}

/**
 * `User.find_by_transfer_id`: whom `transferId` signs in, or null unless `newTransferId` made it under
 * `secret` and it hasn't expired by `now`. The id comes last but two, so a dot in it can't move the rest.
 */
export async function transferredUser(transferId: string, secret: string, now: number): Promise<UserId | null> {
  const parts = transferId.split(".");
  const [expiresAt, signature] = parts.splice(-2);
  const userId = parts.join(".");
  if (!userId || !expiresAt || !signature) return null;
  const [given, expected] = [encoder.encode(signature), encoder.encode(await signatureOf(userId, expiresAt, secret))];
  if (given.length !== expected.length || !crypto.subtle.timingSafeEqual(given, expected)) return null;
  return now < Number.parseInt(expiresAt, 36) ? userId : null;
}

/**
 * `GET /session/transfers`, for anyone, signed in or not: the app's page, which signs in with the id in
 * its fragment straight away, as ember-rust's submits itself.
 */
export async function transferPage(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return notFound(request);
  return appPage(request, env, "/");
}

/**
 * `POST /api/session/transfers`, with the link's id (`LinkSignIn`), where ember-rust's form updates
 * `/session/transfers/<id>`: signs this browser in as the person the id names, with a session of its
 * own that replaces any it had without ending it, as ember-rust's `update` does, and answers who that
 * is. An id that's expired, tampered with or made up, or one for someone who's no longer active,
 * answers 400 with nothing else, as there, and so does a guest's while guests can't sign in, or a body
 * without an id.
 */
export async function transferSession(request: Request, env: Env): Promise<Response> {
  // Any JSON value parses, null and numbers included, so don't assume an object.
  const body: unknown = await jsonBodyOf(request);
  const transferId = typeof body === "object" && body !== null ? (body as Record<string, unknown>).transferId : undefined;
  const userId = typeof transferId === "string" ? await transferredUser(transferId, env.SESSION_SECRET, Date.now()) : null;
  if (!userId) return empty(400);
  const token = newSessionToken();
  const user = await workspace(env).transferSession(userId, await tokenDigest(token, env.SESSION_SECRET), clientOf(request), guestSignIn(env));
  return user ? formAnswer({ user } satisfies { user: Me }, 201, sessionCookie(request, token)) : empty(400);
}
