import { isSecure } from "./site-address.ts";

// Where a site's window may go. It stays on the site, as a browser tab would for a site that's an app,
// and opens anything elsewhere outside the app: web pages in the person's browser, and email addresses
// in their email app. The one way off the site is Sign in with Memberful, which the site sends on to
// its Memberful site and which comes back.

/** Where the site's window goes for an address: to it, outside the app, or nowhere. */
export type Destination = "window" | "outside" | "nowhere";

/** Where Ember's sign-in page sends Sign in with Memberful, which the site redirects to its Memberful site. */
export const MEMBERFUL_SIGN_IN_PATH = "/auth/memberful";

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
 * its Sign in with Memberful, `from`, to its Memberful site, `to`; or null for any other redirect.
 */
export function passageOf(from: string, to: string, site: string): string | null {
  const [leaving, arriving] = [URL.parse(from), URL.parse(to)];
  if (leaving?.origin !== site || leaving.pathname !== MEMBERFUL_SIGN_IN_PATH) return null;
  return arriving !== null && isSecure(arriving) && arriving.origin !== site ? arriving.origin : null;
}

/**
 * Whether going from the page at `from` to `to` is the site moving to its custom domain, as its pages do
 * once an administrator gives it one: the same page, at another address. Asking the site says for sure.
 */
export function mayBeMoving(from: string, to: string): boolean {
  const [leaving, arriving] = [URL.parse(from), URL.parse(to)];
  return leaving !== null && arriving !== null && isSecure(arriving) && leaving.origin !== arriving.origin && leaving.pathname === arriving.pathname;
}
