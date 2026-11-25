// What a person types to add an Ember site, and where the app opens it: the site's origin. Sites are
// https, but for this computer's own, where Ember runs while it's developed.

/** A URL's scheme, as typed at its start. */
const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

/** Whether `hostname`, as a URL gives it, names this computer. */
export const isLoopback = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

/** Whether `url` is an address the app opens sites at: https, or http on this computer. */
export const isSecure = (url: URL) => url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname));

/**
 * The origin of the site at `typed`, such as https://chat.example.com for chat.example.com/rooms/1, or null
 * for anything that isn't a web address. Typed without a scheme, it's https, or http on this computer,
 * and typed with http, it's https anywhere else.
 */
export function siteAddressOf(typed: string): string | null {
  const text = typed.trim();
  const schemed = SCHEME.test(text);
  const url = URL.parse(schemed ? text : `https://${text}`);
  if (url === null || (url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "") return null;
  if (!isLoopback(url.hostname)) url.protocol = "https:";
  else if (!schemed) url.protocol = "http:";
  return url.origin;
}
