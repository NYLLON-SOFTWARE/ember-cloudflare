import { canBeCustomDomain, NOT_A_CUSTOM_DOMAIN } from "@ember/protocol";

// Ember's custom domain, which an administrator gives it in Workspace settings (`Account.customDomain`):
// the address the app moves to from any other Ember answers at, and the one the bot API's links name.

/** Why a custom domain is refused when it isn't the address the request came to. */
export const NOT_THIS_ADDRESS = "Open Ember at that address to make it Ember's";

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
