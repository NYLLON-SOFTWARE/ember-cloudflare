import { workspacePageOf } from "@ember/protocol";

/** The phone layout's tabs, along the bottom of the screen, as Slack's phone app has them. */
export type Tab = "home" | "dms" | "activity" | "files";

export const DMS_PATH = "/dms";
export const ACTIVITY_PATH = "/activity";
export const FILES_PATH = "/files";

/** The pages Home's cards open, which sit above the rooms in the desktop's Home sidebar. */
export const THREADS_PATH = "/threads";
export const DRAFTS_PATH = "/drafts";
export const PEOPLE_PATH = "/people";
export const SAVED_PATH = "/saved";
export const TODOS_PATH = "/todos";

/** What each of Home's cards is called, by the page it opens. */
export const SHORTCUTS: Readonly<Record<string, string>> = {
  [THREADS_PATH]: "Threads",
  [DRAFTS_PATH]: "Drafts & sent",
  [PEOPLE_PATH]: "People",
  [SAVED_PATH]: "Saved",
  [TODOS_PATH]: "To-dos",
};

/** Each tab's page. */
export const TAB_PATHS = { home: "/", dms: DMS_PATH, activity: ACTIVITY_PATH, files: FILES_PATH } as const satisfies Record<Tab, string>;

/** The tab whose own page `pathname` is, or null for a page that opens over the tabs, such as a room's. */
export function tabAt(pathname: string): Tab | null {
  if (pathname === "/") return "home";
  if (pathname === DMS_PATH) return "dms";
  if (pathname === ACTIVITY_PATH) return "activity";
  if (pathname === FILES_PATH || pathname.startsWith(`${FILES_PATH}/`)) return "files";
  return null;
}

/**
 * The tab a page belongs to: its own, for a tab's page, or for a page that opens over the tabs, the
 * one it was opened from, `from`, as Slack keeps the tab marked that a conversation was opened from.
 * Opened from nowhere, as a link is, a DM's address belongs to DMs and anything else to Home.
 */
export function tabOf(pathname: string, from: Tab | null, isDirect: (roomId: string) => boolean): Tab {
  const own = tabAt(pathname);
  if (own) return own;
  if (from) return from;
  const page = workspacePageOf(pathname);
  return page?.page === "room" && isDirect(page.roomId) ? "dms" : "home";
}
