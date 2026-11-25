import { passageOf, SIGN_IN_PATHS } from "./navigation.ts";
import { isSecure } from "./site-address.ts";

/** An Ember site, as checking its address finds it. */
export interface CheckedSite {
  /** Its origin, which its pages open at. */
  address: string;
  /** Its workspace's name, as its pages show it. */
  name: string;
}

/** What checking a site reads of an answer: where it came from, as redirects took the question, whether it's OK, and its JSON. */
export interface Answer {
  url: string;
  ok: boolean;
  json(): Promise<unknown>;
}

/**
 * What checking a site fetches with: in the app, `fetchFollowing`, which asks through Chromium's network,
 * as the site's window does.
 */
export type Fetch = (url: string, init: RequestInit) => Promise<Answer>;

/**
 * Where asking for an address redirects: the full address its answer's Location gives, or null for an
 * answer that doesn't redirect. In the app, it asks through Chromium's network, as the site's window would.
 */
export type RedirectOf = (url: string, signal: AbortSignal) => Promise<string | null>;

/** Why an address can't be added: nothing answered there, or something other than Ember did. */
export type SiteProblem = "unreachable" | "not-ember";

/** What an Ember site's `/api/bootstrap` says that the app reads. */
interface Bootstrap {
  address: string;
  name: string;
  /** The host the site moved to, which its pages move to wherever they're opened, or null. */
  customDomain: string | null;
}

/** How long a site has to answer. */
const PATIENCE_MS = 15_000;

/**
 * Checks that `address` is an Ember site by asking it what Ember's pages ask first, `/api/bootstrap`,
 * which every version answers, and finds where its pages open: at the custom domain it moved to, which
 * they'd move to anyway, if that answers too.
 */
export async function checkSite(address: string, fetch: Fetch): Promise<CheckedSite | SiteProblem> {
  const here = await bootstrapAt(address, fetch);
  if (typeof here === "string") return here;
  const moved = here.customDomain === null ? null : URL.parse(`${new URL(here.address).protocol}//${here.customDomain}`);
  const there = moved === null || moved.origin === here.address ? here : await bootstrapAt(moved.origin, fetch);
  const { address: opensAt, name } = typeof there === "string" ? here : there;
  return { address: opensAt, name };
}

/** What the site at `address` says of itself, at the origin it answered from, wherever a redirect took the question. */
async function bootstrapAt(address: string, fetch: Fetch): Promise<Bootstrap | SiteProblem> {
  let response: Answer;
  try {
    response = await fetch(new URL("/api/bootstrap", address).href, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(PATIENCE_MS) });
  } catch {
    return "unreachable";
  }
  const answeredAt = URL.parse(response.url);
  const body: unknown = response.ok ? await response.json().catch(() => null) : null;
  if (answeredAt === null || !isSecure(answeredAt) || !isBootstrap(body)) return "not-ember";
  return { address: answeredAt.origin, name: body.account.name, customDomain: body.account.customDomain ?? null };
}

/** Whether `body` is what an Ember site's `/api/bootstrap` answers, in any of its versions. */
function isBootstrap(body: unknown): body is { account: { name: string; customDomain?: string | null } } {
  if (typeof body !== "object" || body === null) return false;
  const { setup, version, account } = body as Record<string, unknown>;
  if ((setup !== "pending" && setup !== "complete") || typeof version !== "string" || typeof account !== "object" || account === null) return false;
  const { name, customDomain } = account as Record<string, unknown>;
  return typeof name === "string" && (customDomain === undefined || customDomain === null || typeof customDomain === "string");
}

/**
 * Whether the site at `address` sends Sign in with Memberful or SSO to `origin`, as its Memberful site or
 * single sign-on provider, which it says by redirecting there, as soon as either says so, rather than
 * waiting on the other, which can be slow to answer, as a site is while its provider is down. Neither says
 * so where the site sends them nowhere else, as without Memberful or single sign-on, or while it can't be
 * reached.
 */
export async function signsInAt(address: string, origin: string, redirectOf: RedirectOf): Promise<boolean> {
  const answered = new AbortController();
  const signal = AbortSignal.any([answered.signal, AbortSignal.timeout(PATIENCE_MS)]);
  const sentThere = SIGN_IN_PATHS.map(async (path) => {
    const signIn = new URL(path, address).href;
    const location = await redirectOf(signIn, signal);
    if (location === null || passageOf(signIn, location, address) !== origin) throw new Error(`${signIn} doesn't sign in at ${origin}`);
  });
  try {
    await Promise.any(sentThere);
    return true;
  } catch {
    return false;
  } finally {
    // The other's answer, should it still be coming, no longer matters.
    answered.abort();
  }
}
