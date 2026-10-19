import { isHttps } from "./auth";
import { escapeHtml } from "./encoding";
import type { Env } from "./env";
import { isSetupPath } from "./setup";
import { versionOf } from "./version";

// What ember-rust adds around everything its app answers, for every answer the Worker makes: Rails'
// default headers (crates/kit/src/app.rs `rails_default_headers`, which ctx.rs `finish` adds), the
// version (crates/ember/src/concerns.rs `set_version_headers`), and HTTPS, which its TLS front
// insists on (crates/kit/src/front/tls.rs) and its Rails middleware pins with HSTS
// (crates/kit/src/adapter.rs `rails_middleware`). Static files come straight from the assets with
// none of them, as ember-rust's public files come without the first two.

/** `config.action_dispatch.default_headers`, as Rails 7.1 sets them. */
const DEFAULT_HEADERS: Record<string, string> = {
  "X-Frame-Options": "SAMEORIGIN",
  "X-XSS-Protection": "0",
  "X-Content-Type-Options": "nosniff",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/** `ssl_options = { hsts: { subdomains: true } }`: two years, subdomains included. */
const HSTS = "max-age=63072000; includeSubDomains";

/** localhost, its subdomains and the loopback addresses, which browsers count as secure over plain HTTP. */
const LOOPBACK_HOST = /^(?:(?:.+\.)?localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

/**
 * Whether the request's host has to be reached over HTTPS, as ember-rust's `force_ssl` makes every
 * host unless DISABLE_SSL is set. A loopback host doesn't, wherever it's served: browsers already
 * treat plain HTTP there as secure, and HSTS on it would send every other server on the machine to
 * HTTPS for two years.
 */
export const requiresHttps = (request: Request, env: Env) => !env.DISABLE_SSL?.trim() && !LOOPBACK_HOST.test(new URL(request.url).hostname);

/**
 * Sends plain HTTP to the same address over HTTPS, without its port, as ember-rust's TLS front does
 * with Thruster's redirect: 301, with a link to follow when it's a GET. Setup's addresses are kept out
 * of caches and referrers, and refused with a query, which could hold the private link's token.
 */
export function redirectToHttps(request: Request): Response {
  const { hostname, pathname, search } = new URL(request.url);
  const headers = new Headers();
  if (isSetupPath(pathname)) {
    headers.set("Cache-Control", "no-store");
    headers.set("Referrer-Policy", "no-referrer");
    if (search) {
      headers.set("Content-Type", "text/plain; charset=utf-8");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response("Bad Request\n", { status: 400, headers });
    }
  }
  const location = `https://${hostname}${pathname}${search}`;
  headers.set("Location", location);
  if (request.method === "GET" || request.method === "HEAD") headers.set("Content-Type", "text/html; charset=utf-8");
  const body = request.method === "GET" ? `<a href="${escapeHtml(location)}">Moved Permanently</a>.\n\n` : null;
  return new Response(body, { status: 301, headers });
}

interface Additions {
  /** X-Version and X-Rev, which ember-rust's before-actions add to every answer but /up's. */
  version: boolean;
}

/**
 * `response` with the headers ember-rust's answers carry: Rails' defaults, where it hasn't set its
 * own; the version, if asked; and HSTS, wherever HTTPS is required. A socket's upgrade goes as it is,
 * as ember-rust's live connection carries none of them.
 */
export function withHeaders(response: Response, request: Request, env: Env, { version }: Additions): Response {
  if (response.webSocket) return response;
  // The assets' and Durable Objects' answers can't be changed, so this is a copy.
  const answer = new Response(response.body, response);
  for (const [name, value] of Object.entries(DEFAULT_HEADERS)) {
    if (!answer.headers.has(name)) answer.headers.set(name, value);
  }
  if (version) {
    answer.headers.set("X-Version", versionOf(env));
    // Rails leaves out a header that's nil, but sends one that's blank.
    if (env.GIT_REVISION !== undefined) answer.headers.set("X-Rev", env.GIT_REVISION);
  }
  if (isHttps(request) && requiresHttps(request, env)) answer.headers.set("Strict-Transport-Security", HSTS);
  return answer;
}
