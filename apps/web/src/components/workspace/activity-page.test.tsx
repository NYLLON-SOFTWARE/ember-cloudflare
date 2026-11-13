import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityItem, Me, SidebarRoom } from "@ember/protocol";
import { Sheet } from "@/components/ui/sheet";
import { navigate } from "@/hooks/use-route";
import type { ActivityState } from "@/hooks/use-activity";
import { ActivityPage, type ActivityPlace } from "./activity-page";
import { ONE_PANE, type PaneStack } from "./split-panes";

const me: Me = { id: "u1", name: "Ada", administrator: false };
const random: SidebarRoom = { id: "random", name: "random", kind: "open", icon: null, unread: false, involvement: "mentions" };
const reply: ActivityItem = { id: 1, kind: "thread", roomId: "random", messageId: "m2", parentId: "m1", actorId: "u2", preview: "a reply", content: null, at: "2026-10-15T12:00:00.000Z", read: true };
const activity: ActivityState = {
  feed: { items: [reply], unread: 0, more: false, loaded: true },
  heard: vi.fn(),
  loadOlder: vi.fn(),
  mark: vi.fn(),
  markAllRead: vi.fn(),
};

afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

/** Activity on a phone with `place` open, answering the pane stack it says last. */
function onPhone(place: ActivityPlace | null) {
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === ONE_PANE, media, addEventListener() {}, removeEventListener() {} }));
  const stacks: PaneStack[] = [];
  // The page's phone header has the drawer's button, which the workspace's sheet holds.
  render(
    <Sheet>
      <ActivityPage me={me} place={place} rooms={[random]} activity={activity} renderRoom={() => <p>random</p>} onPaneStack={(stack) => stacks.push(stack)} />
    </Sheet>,
  );
  return () => stacks.at(-1)!;
}

describe("ActivityPage's pane stack", () => {
  it("says which panes are open, the deepest showing alone on a phone, and closes it to its parent's address", () => {
    history.replaceState(null, "", "/activity/rooms/random/threads/m1/@m2");
    const stack = onPhone({ roomId: "random", threadId: "m1", replyId: "m2" });
    expect(stack()).toMatchObject({ open: ["feed", "conversation", "thread"], shown: ["thread"] });
    act(() => stack().back!());
    expect(location.pathname).toBe("/activity/rooms/random");
  });

  it("goes back to the feed from a thread an item opened there, in one Back", async () => {
    navigate("/activity");
    navigate("/activity/rooms/random/threads/m1/@m2");
    const stack = onPhone({ roomId: "random", threadId: "m1", replyId: "m2" });
    act(() => stack().back!());
    await waitFor(() => expect(location.pathname).toBe("/activity"));
  });

  it("closes the conversation back to the feed, which nothing closes", () => {
    history.replaceState(null, "", "/activity/rooms/random/@m1");
    const stack = onPhone({ roomId: "random", messageId: "m1" });
    expect(stack()).toMatchObject({ open: ["feed", "conversation"], shown: ["conversation"] });
    act(() => stack().back!());
    expect(location.pathname).toBe("/activity");
  });

  it("has nothing to close with only the feed open", () => {
    history.replaceState(null, "", "/activity");
    expect(onPhone(null)()).toEqual({ open: ["feed"], shown: ["feed"], back: null });
  });
});

describe("ActivityPage's Filter on a phone", () => {
  it("opens as a sheet from the bottom of the screen", async () => {
    history.replaceState(null, "", "/activity");
    onPhone(null);
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    const sheet = screen.getByRole("dialog", { name: "Filter by" });
    expect(sheet).toHaveClass("bottom-0");
    expect(within(sheet).getByRole("group", { name: "Kinds of activity" })).toBeInTheDocument();
  });

  it("makes the feed the page's main content while it's alone", () => {
    history.replaceState(null, "", "/activity");
    onPhone(null);
    expect(screen.getByRole("main", { name: "Activity" })).toBeInTheDocument();
  });
});
