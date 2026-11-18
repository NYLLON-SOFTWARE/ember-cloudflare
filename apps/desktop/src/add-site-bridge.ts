import type { SiteProblem } from "./site-check.ts";

// What the Add Site page and the app say to each other: the page hands over what the person typed, and
// the app opens the site's window, or says why it can't.

/** The channel the Add Site page asks the app to add a site on. */
export const ADD_SITE = "add-site";

/** Why the app can't add what was typed: it isn't an address, or no Ember site is there. */
export type AddSiteProblem = "address" | SiteProblem;

/** What adding a site came to: the site's window opened, or a problem. */
export type AddSiteOutcome = { added: true } | { problem: AddSiteProblem };

/** What the Add Site page's preload gives the page, as `window.emberDesktop`. */
export interface AddSiteBridge {
  addSite(typed: string): Promise<AddSiteOutcome>;
}
