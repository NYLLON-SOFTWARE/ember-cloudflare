import { isSecure } from "./site-address.ts";

// Where a site's window may go. It stays on the site, as a browser tab would for a site that's an app,
// and opens anything elsewhere outside the app: web pages in the person's browser, and email addresses
// in their email app. The one way off the site is where it signs people in, its Memberful site or single
// sign-on provider, which Sign in with Memberful or SSO, and connecting an account there, go through and
// come back from, at the custom domain one sends them on to if it has one.

/** Where the site's window goes for an address: to it, outside the app, or nowhere. */
export type Destination = "window" | "outside" | "nowhere";

/** Where Ember's sign-in page sends Sign in with Memberful and SSO, which the site redirects to its Memberful site or single sign-on provider. */
export const SIGN_IN_PATHS = ["/auth/memberful", "/auth/sso"];

/** The schemes the app opens outside itself. */
const OUTSIDE = new Set(["http:", "https:", "mailto:"]);

/**
 * Where a window of the site at `site`, an origin, goes for `url`: its window opens the site's own pages,
 * and those of the site it's `passingThrough` while someone signs in there.
 */
export function destinationOf(url: string, site: string, passingThrough: string | null = null): Destination {
  const to = URL.parse(url);
  if (to === null) return "nowhere";
  if (to.origin === site || (passingThrough !== null && to.origin === passingThrough)) return "window";
  return OUTSIDE.has(to.protocol) ? "outside" : "nowhere";
}

/**
 * The origin a window of the site at `site` passes through as someone signs in, as the site redirects
 * its Sign in with Memberful or SSO, `from`, to its Memberful site or single sign-on provider, `to`; or
 * null for any other redirect.
 */
export function passageOf(from: string, to: string, site: string): string | null {
  const [leaving, arriving] = [URL.parse(from), URL.parse(to)];
  if (leaving?.origin !== site || !SIGN_IN_PATHS.includes(leaving.pathname)) return null;
  return arriving !== null && isSecure(arriving) && arriving.origin !== site ? arriving.origin : null;
}

/**
 * The origin a window passing through the site at `passingThrough`, where someone signs in, passes through
 * instead as that site redirects its page at `from` to the same page at `to`, another secure address: its
 * custom domain, which a Memberful site with one sends its pages on to. Null for any other redirect.
 */
export function onwardPassageOf(from: string, to: string, passingThrough: string | null): string | null {
  const [leaving, arriving] = [URL.parse(from), URL.parse(to)];
  if (leaving?.origin !== passingThrough || arriving === null || arriving.search !== leaving.search) return null;
  return mayBeMoving(from, to) ? arriving.origin : null;
}

/**
 * Whether going from the page at `from` to `to` is the site moving to its custom domain, as its pages do
 * once an administrator gives it one: the same page, at another address. Asking the site says for sure.
 */
export function mayBeMoving(from: string, to: string): boolean {
  const [leaving, arriving] = [URL.parse(from), URL.parse(to)];
  return leaving !== null && arriving !== null && isSecure(arriving) && leaving.origin !== arriving.origin && leaving.pathname === arriving.pathname;
}

/**
 * Whether `url` may be the sign-in at the site's Memberful site or single sign-on provider, which its pages
 * go straight to as someone connects their account there: a sign-in for Ember, naming the app it's for and
 * the state the site keeps for the round trip, at a secure address. Asking the site where it sends Sign in
 * with Memberful and SSO says for sure.
 */
export function mayBeSigningIn(url: string): boolean {
  const to = URL.parse(url);
  return to !== null && isSecure(to) && to.searchParams.has("client_id") && to.searchParams.has("state");
}
