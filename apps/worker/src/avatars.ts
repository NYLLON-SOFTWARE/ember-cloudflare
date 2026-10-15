import { avatarSvg } from "@ember/protocol";
import { credentialsOf } from "./auth";
import { avatarTokenUser } from "./avatar-tokens";
import { DEFAULT_BOT_AVATAR } from "./default-bot-avatar";
import type { Env } from "./env";
import { notFound } from "./error-pages";
import { etagOf, isFresh } from "./etag";
import { empty, signInFirst } from "./pages";
import { workspace } from "./workspace";

// People's avatars, ported from ember-rust's crates/ember/src/controllers/users/avatars.rs: an image
// at the address avatar-tokens.ts makes, for people signed in. Nobody can upload a picture yet, so
// it's their initials, or the bot picture for a bot.

/** `expires_in 30.minutes, public: true, stale_while_revalidate: 1.week` */
const CACHE_CONTROL = "max-age=1800, public, stale-while-revalidate=604800";

/** Rails' `/users/:user_id/avatar`, which takes the token as the id. */
const ROUTE = /^\/users\/([^/]+)\/avatar$/;

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
