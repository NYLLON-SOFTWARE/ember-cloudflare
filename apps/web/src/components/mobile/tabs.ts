import { ACTIVITY_PATH, DMS_PATH, DRAFTS_PATH, FILES_PATH, PEOPLE_PATH, THREADS_PATH } from "@ember/protocol";

/** The phone layout's tabs, along the bottom of the screen, as Slack's phone app has them. */
export type Tab = "home" | "dms" | "activity" | "files";

export { DRAFTS_PATH, PEOPLE_PATH, THREADS_PATH };

/** Each tab's page. */
export const TAB_PATHS = { home: "/", dms: DMS_PATH, activity: ACTIVITY_PATH, files: FILES_PATH } as const satisfies Record<Tab, string>;

/**
 * The tab a page belongs to: its own, for a tab's page, or for a page that opens over the tabs, the
 * one it was opened from, `from`, as Slack keeps the tab marked that a conversation was opened from.
 * Opened from nowhere, as a link is, a DM belongs to DMs and anything else to Home.
 */
export function tabOf(own: Tab | null, from: Tab | null, inDirect: boolean): Tab {
  return own ?? from ?? (inDirect ? "dms" : "home");
}
