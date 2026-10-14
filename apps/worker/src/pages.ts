import { isAppPage } from "@ember/protocol";
import type { Env } from "./env";
import { notFound } from "./error-pages";

// What the Worker answers for pages: the app's, those it serves itself, such as setup's and the join
// link's, and their forms, which post to the API.

/**
 * One of the built app's pages, from its static assets, with headers this response can change. The
 * request's own headers go along, so a browser that has the page already hears it's unchanged.
 */
export async function appPage(request: Request, env: Env, path: string): Promise<Response> {
  const page = await env.ASSETS.fetch(new Request(new URL(path, request.url), { method: request.method, headers: request.headers }));
  return new Response(page.body, page);
}

/** `pathname` as ember-rust's router reads it: with runs of slashes squeezed and no trailing slash. */
const normalized = (pathname: string) => pathname.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");

/**
 * Any other path, as ember-rust's router answers it: the app's page where the app shows one, one of
 * the built app's files, or Campfire's 404 page, which the assets answer for a path they don't have
 * (`not_found_handling`). Where ember-rust ignores extra slashes, this sends the browser to the page's
 * own address, which the app reads.
 */
export async function anyOtherPage(request: Request, env: Env, pathname: string): Promise<Response> {
  // The assets answer 405 to anything else.
  if (request.method !== "GET" && request.method !== "HEAD") return notFound(request);
  if (isAppPage(pathname)) return appPage(request, env, "/");
  const path = normalized(pathname);
  if (path !== pathname && isAppPage(path)) {
    const { origin, search } = new URL(request.url);
    return new Response(null, { status: 307, headers: { Location: `${origin}${path}${search}` } });
  }
  return env.ASSETS.fetch(request);
}

export const empty = (status: number) => new Response(null, { status });

export function withCookies(response: Response, ...cookies: Array<string | null>): Response {
  for (const cookie of cookies) if (cookie) response.headers.append("Set-Cookie", cookie);
  return response;
}

/** Sends the browser to the app's home page. */
export const home = (request: Request) => new Response(null, { status: 302, headers: { Location: new URL("/", request.url).href } });

/** Sends the browser to sign in, as ember-rust's `request_authentication` does (crates/ember/src/concerns.rs). */
export const signInFirst = (request: Request) => new Response(null, { status: 302, headers: { Location: new URL("/session/new", request.url).href } });

/** A form's answer, which no cache keeps, since it can sign someone in. */
export const formAnswer = (data: unknown, status: number, ...cookies: Array<string | null>) =>
  withCookies(Response.json(data, { status, headers: { "Cache-Control": "no-store" } }), ...cookies);
