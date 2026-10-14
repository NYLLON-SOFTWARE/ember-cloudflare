import { avatarSvg, type DirectoryUser, type UserId } from "@ember/protocol";
import { credentialsOf } from "./auth";
import { DEFAULT_BOT_AVATAR } from "./default-bot-avatar";
import { toBase64url } from "./encoding";
import type { Env } from "./env";
import { notFound } from "./error-pages";
import { etagOf, isFresh } from "./etag";
import { empty, signInFirst } from "./pages";
import { workspace } from "./workspace";
import type { DirectoryEntry } from "./workspace-store";

// People's avatars, ported from ember-rust's crates/ember/src/controllers/users/avatars.rs: an image
// at /users/<token>/avatar?v=<version> for people signed in, where the token names someone and is
// signed so nobody can make one up, and the version changes whenever they do. Nobody can upload a
// picture yet, so it's their initials, or the bot picture for a bot.

const encoder = new TextEncoder();

/** How much of its HMAC a token keeps. */
const SIGNATURE_BYTES = 16;

/** `expires_in 30.minutes, public: true, stale_while_revalidate: 1.week` */
const CACHE_CONTROL = "max-age=1800, public, stale-while-revalidate=604800";

/** Rails' `/users/:user_id/avatar`, which takes the token as the id. */
const ROUTE = /^\/users\/([^/]+)\/avatar$/;

/**
 * Makes `User#avatar_token`s: someone's id and the first 16 bytes of its HMAC under SESSION_SECRET,
 * as base64url. They never expire, and changing the secret changes them all, as changing ember-rust's
 * `SECRET_KEY_BASE` does.
 */
async function avatarTokens(secret: string): Promise<(userId: UserId) => Promise<string>> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return async (userId) => {
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`avatar:${userId}`));
    return `${userId}.${toBase64url(new Uint8Array(signature, 0, SIGNATURE_BYTES))}`;
  };
}

/** Whose avatar `token` is, or null unless it's one `avatarTokens` made under `secret`. */
export async function avatarTokenUser(token: string, secret: string): Promise<UserId | null> {
  const userId = token.slice(0, Math.max(token.lastIndexOf("."), 0));
  if (!userId) return null;
  const [given, expected] = [encoder.encode(token), encoder.encode(await (await avatarTokens(secret))(userId))];
  return given.length === expected.length && crypto.subtle.timingSafeEqual(given, expected) ? userId : null;
}

/** `updated_at.to_fs(:number)`: when someone last changed, to the second, as 14 digits. */
const versionOf = (updatedAt: string) => updatedAt.slice(0, 19).replace(/\D/g, "");

/**
 * The tokens the directory has listed, under the secret that made them, since signing is most of what
 * listing everyone costs. Only people the directory lists go in, so nobody can fill it with made-up ids.
 */
let listed = { secret: "", tokens: new Map<UserId, string>() };

/** The people directory's entries, each with its avatar's address: `user_avatar_path(user.avatar_token, v: ...)`. */
export async function directoryOf(entries: DirectoryEntry[], secret: string): Promise<DirectoryUser[]> {
  if (listed.secret !== secret) listed = { secret, tokens: new Map() };
  const { tokens } = listed;
  const tokenOf = await avatarTokens(secret);
  return Promise.all(
    entries.map(async ({ updatedAt, ...user }) => {
      let token = tokens.get(user.id);
      if (token === undefined) tokens.set(user.id, (token = await tokenOf(user.id)));
      return { ...user, avatarUrl: `/users/${encodeURIComponent(token)}/avatar?v=${versionOf(updatedAt)}` };
    }),
  );
}

/** The token in an avatar's path, or null if `pathname` isn't one. */
export function avatarTokenOf(pathname: string): string | null {
  const segment = pathname.match(ROUTE)?.[1];
  if (segment === undefined) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    // Malformed percent-encoding can't be a token.
    return "";
  }
}

/**
 * `GET /users/<token>/avatar`: someone's avatar, for people signed in, whatever the person's status.
 * Signed out, the browser is sent to sign in, before the token is looked at; a token this Worker
 * didn't sign, or one for nobody, is an empty 404.
 */
export async function showAvatar(request: Request, env: Env, token: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return notFound(request);
  const credentials = await credentialsOf(request, env);
  if (!credentials) return signInFirst(request);
  const userId = await avatarTokenUser(token, env.SESSION_SECRET);
  if (userId === null) return (await workspace(env).authenticate(credentials)) ? empty(404) : signInFirst(request);
  const owner = await workspace(env).avatarOwner(credentials, userId);
  if (owner === null) return signInFirst(request);
  if (owner === "not found") return empty(404);
  return owner.bot ? image(request, DEFAULT_BOT_AVATAR, true) : image(request, avatarSvg(userId, owner.name), false);
}

/**
 * An avatar's answer, as ember-rust sends it: `send_file` for the bot picture, `render` for initials.
 * A 304 says how long to keep the copy too, where ember-rust's says nothing of it, and a browser that
 * takes a 304's Cache-Control for its copy would then check it every time.
 */
async function image(request: Request, svg: string, bot: boolean): Promise<Response> {
  const etag = await etagOf(svg);
  const headers = new Headers({ ETag: etag, "Cache-Control": CACHE_CONTROL });
  if (isFresh(request, etag)) return new Response(null, { status: 304, headers });
  headers.set("Content-Type", bot ? "image/svg+xml" : "image/svg+xml; charset=utf-8");
  if (bot) headers.set("Content-Disposition", `inline; filename="default-bot-avatar.svg"; filename*=UTF-8''default-bot-avatar.svg`);
  return new Response(request.method === "HEAD" ? null : svg, { headers });
}
