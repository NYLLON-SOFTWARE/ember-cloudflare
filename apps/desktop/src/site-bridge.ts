// What a site's own pages and the app say to each other, through the preload of the site's windows
// (preload/site.cts), as Ember's web app has it (apps/web/src/lib/desktop-app.ts): a page hands the app
// each notification Ember's workspace socket sends it, what a push would show, since no push service
// reaches the app, and how many conversations are unread, for the app's icon; the app tells it the page of
// each notification the person clicks.

/** The channel a site's page hands the app a notification on. */
export const NOTIFY = "site:notify";
/** The channel a site's page tells the app how many conversations are unread on. */
export const SET_BADGE = "site:set-badge";
/** The channel the app tells a site's page which page a clicked notification opens on. */
export const OPEN = "site:open";

/** A notification from a site's page: what a push from the site would show, and the page it opens. */
export interface SiteNotification {
  /** Names what it's of, the same in each of the site's windows, so the app shows it once. */
  id: string;
  title: string;
  body: string;
  /** The page of the site it opens, such as /rooms/1. */
  path: string;
}

/** What the preload gives a site's pages, as `window.emberDesktop`. */
export interface SiteBridge {
  notify(notification: SiteNotification): void;
  setBadge(count: number): void;
  /** Calls `open` with the page of each notification the person clicks, until the function it answers is called. */
  onOpen(open: (path: string) => void): () => void;
}

/** The longest id a notification may have, and the most of its title and body the app shows. */
const LONGEST = { id: 200, title: 200, body: 1000 };

/** `value` as a notification a site's page may ask the app to show, or null: one with an id, words, and a page of the site's own. */
export function notificationOf(value: unknown): SiteNotification | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, title, body, path } = value as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0 || id.length > LONGEST.id) return null;
  if (typeof title !== "string" || typeof body !== "string" || typeof path !== "string" || !isPagePath(path)) return null;
  return { id, title: shortened(title, LONGEST.title), body: shortened(body, LONGEST.body), path };
}

/** `value` as how many conversations a site's page says are unread, or null if it isn't a count. */
export const countOf = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);

/** Whether `path` is a page of whichever site a page is on, as /rooms/1 is, and //example.com isn't. */
const isPagePath = (path: string) => path.startsWith("/") && URL.parse(path, "https://site.invalid")?.origin === "https://site.invalid";

/** `text`, cut to `longest` characters, an ellipsis among them, where it's longer, without splitting one. */
function shortened(text: string, longest: number): string {
  const characters = [...text];
  return characters.length > longest ? `${characters.slice(0, longest - 1).join("")}…` : text;
}
