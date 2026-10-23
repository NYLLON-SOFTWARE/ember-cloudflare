import { canBeCustomDomain, NOT_A_CUSTOM_DOMAIN, type CustomDomainReach } from "@ember/protocol";
import { toBase64url } from "./encoding";
import type { Env } from "./env";
import { workspace } from "./workspace";

// Ember's custom domain, which an administrator gives it in Workspace settings (`Account.customDomain`):
// the address the app moves to from any other Ember answers at, and the one the bot API's links name.

/** Why a custom domain is refused when it isn't the address the request came to. */
export const NOT_THIS_ADDRESS = "Open Ember at that address to make it Ember's";

/** Where a domain answers a check's probe, `/api/custom_domain_probes/<probe>`, if it reaches this Ember. */
const PROBE_PREFIX = "/api/custom_domain_probes/";
const PROBE_PATH = /^\/api\/custom_domain_probes\/([\w-]{32})$/;
/** The header a probe's answer comes in. */
export const PROBE_ANSWER_HEADER = "X-Ember-Probe";
/** How long a check waits for the domain to answer. */
const CHECK_DEADLINE_MS = 10_000;

/**
 * Why `request` can't give Ember the custom domain `customDomain`, or null when it can: only the address
 * the request came to, the one the page asking is open at, so that it's never a host that doesn't reach
 * this Worker, and never where a deploy or `wrangler dev` puts Ember. Null, for none, always can.
 */
export function customDomainRefusal(customDomain: string | null | undefined, request: Request): string | null {
  if (customDomain === undefined || customDomain === null) return null;
  const { host, hostname } = new URL(request.url);
  if (customDomain !== host) return NOT_THIS_ADDRESS;
  return canBeCustomDomain(hostname) ? null : NOT_A_CUSTOM_DOMAIN;
}

/** The origin of Ember's address: its custom domain, by the scheme `request` came by, or the request's own origin while it has none. */
export function originFor(request: Request, customDomain: string | null): string {
  const url = new URL(request.url);
  return customDomain === null ? url.origin : `${url.protocol}//${customDomain}`;
}

/** A probe, or its answer: 24 random bytes, as 32 base64url characters. */
const probeToken = () => toBase64url(crypto.getRandomValues(new Uint8Array(24)));

/**
 * Whether `status` is Cloudflare's own answer for an origin it can't reach (520 to 527), or for a host
 * it can't resolve (530, as its error 1016), rather than the domain's.
 */
const isUnreached = (status: number) => (status >= 520 && status <= 527) || status === 530;

/**
 * What `domain` reaches, asked by the scheme `request` came by, as Check DNS in Workspace settings asks
 * before an administrator opens Ember there. The Workspace waits for a probe only this check knows, so
 * an answer to it comes from this Ember: "ember". No answer in time, or only Cloudflare's for an origin
 * it can't reach, is "nothing", and any other, a redirect included, "elsewhere". Nothing is sent but the
 * probe, and nothing of the answer is read but its header.
 */
export async function reachOf(request: Request, env: Env, domain: string): Promise<CustomDomainReach> {
  const [probe, answer] = [probeToken(), probeToken()];
  await workspace(env).expectProbe(probe, answer);
  const { protocol } = new URL(request.url);
  let response: Response;
  try {
    response = await fetch(`${protocol}//${domain}${PROBE_PREFIX}${probe}`, { redirect: "manual", signal: AbortSignal.timeout(CHECK_DEADLINE_MS) });
  } catch {
    return "nothing";
  }
  void response.body?.cancel().catch(() => {});
  if (response.headers.get(PROBE_ANSWER_HEADER) === answer) return "ember";
  return isUnreached(response.status) ? "nothing" : "elsewhere";
}

/** The probe `pathname` asks for, if it's a probe's address. */
export const probeOf = (pathname: string) => PROBE_PATH.exec(pathname)?.[1] ?? null;

/** Answers a check's `probe`, once, if the Workspace waits for it, which only this Ember's does. */
export async function answerProbe(env: Env, probe: string): Promise<Response> {
  const answer = await workspace(env).takeProbe(probe);
  if (answer === null) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204, headers: { [PROBE_ANSWER_HEADER]: answer, "Cache-Control": "no-store" } });
}
