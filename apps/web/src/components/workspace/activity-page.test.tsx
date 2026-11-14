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

describe("ActivityPage's rows", () => {
  /** The feed beside whatever `place` opens, as on a desktop, with `items` in it. */
  function onDesktop(place: ActivityPlace | null, items: ActivityItem[]) {
    vi.stubGlobal("matchMedia", (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }));
    render(
      <Sheet>
        <ActivityPage me={me} place={place} rooms={[random]} activity={{ ...activity, feed: { ...activity.feed, items } }} renderRoom={() => <p>random</p>} onPaneStack={() => {}} />
      </Sheet>,
    );
  }
  const timeOf = (row: HTMLElement | undefined) => row!.querySelector("time")!;

  it("darkens the time and place where grey would fall under 4.5:1: on the unread tint, on hover and on the selected row", () => {
    history.replaceState(null, "", "/activity/rooms/random/threads/m1/@m2");
    const unread: ActivityItem = { ...reply, id: 2, messageId: "m3", parentId: "m4", preview: "news", read: false };
    onDesktop({ roomId: "random", threadId: "m1", replyId: "m2" }, [reply, unread]);
    // The day's heading is a list item too.
    const [selected, tinted] = screen.getAllByRole("listitem").filter((item) => item.querySelector("time"));
    expect(selected).toHaveAttribute("aria-current", "true");
    expect(timeOf(selected)).toHaveClass("text-muted-foreground", "group-hover:text-foreground/65", "group-aria-[current=true]:text-foreground/65");
    expect(timeOf(tinted)).toHaveClass("text-foreground/65");
    expect(timeOf(tinted)).not.toHaveClass("text-muted-foreground");
  });
});
