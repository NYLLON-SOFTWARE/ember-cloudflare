import type { ActivityItem } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { activityReducer, type ActivityChange, ALL_ACTIVITY, filterCount, NO_ACTIVITY, shows, type ActivityFeed, type ActivityNames } from "./activity-feed";

const item = (id: number, fields: Partial<ActivityItem> = {}): ActivityItem => ({
  id,
  kind: "mention",
  roomId: "general",
  messageId: `m${id}`,
  parentId: null,
  actorId: "ada",
  preview: `message ${id}`,
  content: null,
  at: "2026-11-11T12:00:00.000Z",
  read: false,
  ...fields,
});

const loaded = (items: ActivityItem[], unread = items.filter((i) => !i.read).length, more = false): ActivityFeed =>
  activityReducer(NO_ACTIVITY, { type: "loaded", page: { items, unread, more } });

describe("activityReducer", () => {
  it("loads the newest page, then older ones after it", () => {
    const feed = loaded([item(3), item(2)], 5, true);
    expect(feed).toMatchObject({ unread: 5, more: true, loaded: true });
    const older = activityReducer(feed, { type: "older", page: { items: [item(2), item(1)], unread: 5, more: false } });
    expect(older.items.map((i) => i.id)).toEqual([3, 2, 1]);
    expect(older.more).toBe(false);
  });

  it("adds new items in order, once each, counting the unread", () => {
    const feed = activityReducer(loaded([item(2)]), { type: "added", items: [item(4), item(3, { read: true }), item(2)] });
    expect(feed.items.map((i) => i.id)).toEqual([4, 3, 2]);
    expect(feed.unread).toBe(2);
  });

  it("marks items read and unread, and all of them read", () => {
    let feed = loaded([item(2), item(1)]);
    feed = activityReducer(feed, { type: "marked", ids: [1], read: true });
    expect(feed.items.map((i) => i.read)).toEqual([false, true]);
    expect(feed.unread).toBe(1);
    // A mark of an item not loaded counts too.
    feed = activityReducer(feed, { type: "marked", ids: [1, 99], read: false });
    expect(feed.unread).toBe(3);
    feed = activityReducer(feed, { type: "marked", ids: null, read: true });
    expect(feed).toMatchObject({ unread: 0 });
    expect(feed.items.every((i) => i.read)).toBe(true);
  });

  it("gives items what an edited message says now, keeping whether they're read", () => {
    const feed = activityReducer(loaded([item(2), item(1, { read: true })]), { type: "updated", items: [item(1, { preview: "(redacted)", read: false }), item(9, { preview: "not loaded" })] });
    expect(feed.items.map((i) => [i.preview, i.read])).toEqual([[item(2).preview, false], ["(redacted)", true]]);
    expect(feed.unread).toBe(1);
  });

  it("leaves the feed as it was for a change it doesn't know", () => {
    const feed = loaded([item(1)]);
    expect(activityReducer(feed, { type: "reminded" } as unknown as ActivityChange)).toBe(feed);
  });

  it("removes items, and their unread marks with them", () => {
    const feed = activityReducer(loaded([item(2), item(1, { read: true })]), { type: "removed", ids: [2, 1] });
    expect(feed).toMatchObject({ items: [], unread: 0 });
  });
});

describe("shows", () => {
  const names: ActivityNames = { nameOf: (id) => (id === "ada" ? "Ada Lovelace" : "Bot"), roomNameOf: (id) => id, isBot: (id) => id === "bot" };

  it("shows everything with no filter", () => {
    expect(shows(ALL_ACTIVITY, item(1), names)).toBe(true);
  });

  it("narrows by tab, unread, room and kind, bots counting as apps", () => {
    expect(shows({ ...ALL_ACTIVITY, tab: "thread" }, item(1), names)).toBe(false);
    expect(shows({ ...ALL_ACTIVITY, unreadOnly: true }, item(1, { read: true }), names)).toBe(false);
    expect(shows({ ...ALL_ACTIVITY, roomId: "random" }, item(1), names)).toBe(false);
    expect(shows({ ...ALL_ACTIVITY, kinds: new Set(["reaction"]) }, item(1), names)).toBe(false);
    expect(shows({ ...ALL_ACTIVITY, kinds: new Set(["apps"]) }, item(1, { actorId: "bot" }), names)).toBe(true);
  });

  it("searches an item's text, who it's from and where", () => {
    for (const query of ["MESSAGE 1", "lovelace", "general"]) expect(shows({ ...ALL_ACTIVITY, query }, item(1), names), query).toBe(true);
    expect(shows({ ...ALL_ACTIVITY, query: "nowhere" }, item(1), names)).toBe(false);
  });

  it("counts the popover's filters", () => {
    expect(filterCount({ ...ALL_ACTIVITY, kinds: new Set(["mention", "apps"]), roomId: "general" })).toBe(3);
  });
});
