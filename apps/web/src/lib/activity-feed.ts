import type { ActivityItem, ActivityKind, ActivityPage, RoomId, UserId } from "@ember/protocol";

// Your Activity as the app keeps it: the items loaded so far, newest first, kept current by the
// workspace socket, with how many are unread in all of it, and what the Activity page filters them by.

export interface ActivityFeed {
  items: ActivityItem[];
  /** How many items are unread, loaded or not. */
  unread: number;
  /** Whether there are older items than those loaded. */
  more: boolean;
  /** Whether the first page has come. */
  loaded: boolean;
}

export const NO_ACTIVITY: ActivityFeed = { items: [], unread: 0, more: false, loaded: false };

export type ActivityChange =
  /** The newest page, loaded afresh, which takes the place of what was loaded. */
  | { type: "loaded"; page: ActivityPage }
  /** An older page, after the items loaded. */
  | { type: "older"; page: ActivityPage }
  | { type: "added"; items: ActivityItem[] }
  /** Items marked read or unread, or with `ids` null, every item read. */
  | { type: "marked"; ids: number[] | null; read: boolean }
  | { type: "removed"; ids: number[] }
  /** Items that say what an edited message says now. */
  | { type: "updated"; items: ActivityItem[] };

const newestFirst = (a: ActivityItem, b: ActivityItem) => b.id - a.id;

export function activityReducer(feed: ActivityFeed, change: ActivityChange): ActivityFeed {
  switch (change.type) {
    case "loaded":
      return { items: change.page.items, unread: change.page.unread, more: change.page.more, loaded: true };
    case "older": {
      const known = new Set(feed.items.map((item) => item.id));
      return { ...feed, items: [...feed.items, ...change.page.items.filter((item) => !known.has(item.id))], more: change.page.more };
    }
    case "added": {
      const known = new Set(feed.items.map((item) => item.id));
      const added = change.items.filter((item) => !known.has(item.id));
      if (added.length === 0) return feed;
      return { ...feed, items: [...added, ...feed.items].sort(newestFirst), unread: feed.unread + added.filter((item) => !item.read).length };
    }
    case "marked": {
      if (change.ids === null) return { ...feed, items: feed.items.map((item) => (item.read ? item : { ...item, read: true })), unread: 0 };
      const ids = new Set(change.ids);
      let unread = feed.unread;
      const items = feed.items.map((item) => {
        if (!ids.has(item.id) || item.read === change.read) return item;
        unread += change.read ? -1 : 1;
        return { ...item, read: change.read };
      });
      // The socket names only items whose mark changed, so those not loaded change the count too.
      const unloaded = change.ids.filter((id) => !feed.items.some((item) => item.id === id)).length;
      return { ...feed, items, unread: Math.max(0, unread + (change.read ? -unloaded : unloaded)) };
    }
    case "removed": {
      const ids = new Set(change.ids);
      const gone = feed.items.filter((item) => ids.has(item.id));
      if (gone.length === 0) return feed;
      return { ...feed, items: feed.items.filter((item) => !ids.has(item.id)), unread: Math.max(0, feed.unread - gone.filter((item) => !item.read).length) };
    }
    case "updated": {
      // Only what they say changes: whether they're read is the marks' to say.
      const previews = new Map(change.items.map((item) => [item.id, item.preview]));
      if (!feed.items.some((item) => previews.has(item.id))) return feed;
      return { ...feed, items: feed.items.map((item) => (previews.has(item.id) ? { ...item, preview: previews.get(item.id)! } : item)) };
    }
  }
}

/** The Activity page's tabs, as Slack's: everything, or DMs, mentions or threads alone. */
export type ActivityTab = "all" | "direct" | "mention" | "thread";

/** What the Filter by popover can narrow Activity to: kinds of items, and items by bots. */
export type ActivityFilterKind = ActivityKind | "apps";

/** What the Activity page shows of the feed. */
export interface ActivityFilter {
  tab: ActivityTab;
  unreadOnly: boolean;
  /** The kinds the Filter by popover has checked, or none for every kind. */
  kinds: ReadonlySet<ActivityFilterKind>;
  /** The room the popover narrows to, or null for every room. */
  roomId: RoomId | null;
  /** What's searched for, in an item's text, who it's from or where. */
  query: string;
}

export const ALL_ACTIVITY: ActivityFilter = { tab: "all", unreadOnly: false, kinds: new Set(), roomId: null, query: "" };

/** What an item is searched by beside its text: who it's from, and where it happened. */
export interface ActivityNames {
  nameOf: (userId: UserId) => string;
  roomNameOf: (roomId: RoomId) => string;
  isBot: (userId: UserId) => boolean;
}

/** Whether `filter` shows `item`. */
export function shows(filter: ActivityFilter, item: ActivityItem, names: ActivityNames): boolean {
  if (filter.tab !== "all" && item.kind !== filter.tab) return false;
  if (filter.unreadOnly && item.read) return false;
  if (filter.roomId !== null && item.roomId !== filter.roomId) return false;
  if (filter.kinds.size > 0 && !filter.kinds.has(item.kind) && !(filter.kinds.has("apps") && names.isBot(item.actorId))) return false;
  const query = filter.query.trim().toLowerCase();
  if (!query) return true;
  return [item.preview, item.content ?? "", names.nameOf(item.actorId), names.roomNameOf(item.roomId)].some((text) => text.toLowerCase().includes(query));
}

/** How many filters the Filter by popover has on, for its button to show. */
export const filterCount = (filter: ActivityFilter) => filter.kinds.size + (filter.roomId === null ? 0 : 1);
