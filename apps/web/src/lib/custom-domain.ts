import { WORKSPACE_SETTINGS_PATH } from "@ember/protocol";

// Ember's custom domain (`Account.customDomain`), which an administrator gives it in workspace settings:
// every page opened at any other address moves there, but workspace settings, which stays wherever it's
// opened, so an administrator can always stop using a domain that has stopped reaching Ember.

/** This page at Ember's custom domain, `customDomain`, or null when it's there already or Ember has none. */
export function thisPageAt(customDomain: string | null): string | null {
  if (customDomain === null || customDomain === location.host) return null;
  return `${location.protocol}//${customDomain}${location.pathname}${location.search}${location.hash}`;
}

/** Whether the page at `pathname` stays at whatever address it's opened at, as workspace settings does. */
export const staysAtAnyAddress = (pathname: string) => pathname === WORKSPACE_SETTINGS_PATH;

/** Where this page moves to as it opens, at Ember's custom domain, or null when it stays where it is. */
export const pageMovingTo = (customDomain: string | null) => (staysAtAnyAddress(location.pathname) ? null : thisPageAt(customDomain));
