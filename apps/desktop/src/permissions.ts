// What a site's pages may use beyond what any page may: what Ember's huddles and notifications need,
// and copying, for the site's own pages and nothing else. Electron grants everything a page asks for
// unless the app says otherwise.

/** The permissions a site's own pages have, by the names Electron gives them. */
const SITES_USE = new Set([
  // Camera and microphone, for huddles.
  "media",
  "speaker-selection",
  "screen-wake-lock",
  "fullscreen",
  "notifications",
  "clipboard-sanitized-write",
]);

/** Whether a page from `origin`, in the window of the site at `site`, may use `permission`. */
export function mayUse(permission: string, origin: string | undefined, site: string): boolean {
  return origin !== undefined && URL.parse(origin)?.origin === site && SITES_USE.has(permission);
}
