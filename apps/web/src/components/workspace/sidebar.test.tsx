import { feature } from "@ember/parity";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";

const rooms = [
  { id: "general", name: "general", kind: "open" as const, icon: null, unread: false },
  { id: "random", name: "random", kind: "open" as const, icon: null, unread: false },
];
const unstarred = new Set<string>();

describe(feature("sidebar.rooms"), () => {
  it("lists the rooms under the workspace name and marks the one you're in", () => {
    render(<Sidebar workspaceName="Analytical Engines" rooms={rooms} starred={unstarred} currentRoomId="random" unreadOnly={false} onSelect={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 2, name: "Analytical Engines" })).toBeInTheDocument();
    const links = within(screen.getByRole("region", { name: "Rooms" })).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
      ["#general", "/rooms/general", null],
      ["#random", "/rooms/random", "page"],
    ]);
  });

  it("switches rooms in place, but leaves modified clicks to the browser", async () => {
    const onSelect = vi.fn();
    render(<Sidebar workspaceName="Ember" rooms={rooms} starred={unstarred} currentRoomId="general" unreadOnly={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("link", { name: /random/ }));
    expect(onSelect).toHaveBeenCalledWith("random");

    onSelect.mockClear();
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
      const click = fireEvent.click(screen.getByRole("link", { name: /random/ }), modifier);
      expect(click).toBe(true); // not prevented, so the browser opens a tab or window
    }
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe(feature("rooms.icons"), () => {
  it("shows each room's icon before its name, or `#`", () => {
    render(<Sidebar workspaceName="Ember" rooms={[{ ...rooms[0]!, icon: "coffee" }, rooms[1]!]} starred={unstarred} currentRoomId="general" unreadOnly={false} onSelect={vi.fn()} />);
    const [coffee, random] = within(screen.getByRole("region", { name: "Rooms" })).getAllByRole("link");
    expect(coffee).toHaveAccessibleName("general");
    expect(coffee!.querySelector('[data-icon="coffee"]')).toHaveStyle({ width: "19px", height: "19px" });
    expect(random).toHaveTextContent("#random");
  });
});

describe(feature("sidebar.unread"), () => {
  it("makes an unread room's row bold, with a dot, and says so to screen readers", () => {
    render(<Sidebar workspaceName="Ember" rooms={[{ ...rooms[0]!, unread: true }, rooms[1]!]} starred={unstarred} currentRoomId={null} unreadOnly={false} onSelect={vi.fn()} />);
    const [general, random] = within(screen.getByRole("region", { name: "Rooms" })).getAllByRole("link");
    expect(general).toHaveClass("font-[650]");
    expect(general).toHaveAccessibleName("general");
    expect(general).toHaveAccessibleDescription("Unread");
    expect(general!.lastElementChild).toHaveAttribute("aria-hidden", "true");
    expect(general!.lastElementChild).toHaveClass("ml-auto", "size-[7px]", "rounded-full", "bg-foreground");

    expect(random).not.toHaveClass("font-[650]");
    expect(random).not.toHaveAttribute("aria-description");
    expect(random!.querySelector(".rounded-full")).toBeNull();
  });

  it("never marks the room the tab shows", () => {
    render(<Sidebar workspaceName="Ember" rooms={[{ ...rooms[0]!, unread: true }, rooms[1]!]} starred={unstarred} currentRoomId="general" unreadOnly={false} onSelect={vi.fn()} />);
    const general = screen.getByRole("link", { current: "page" });
    expect(general).not.toHaveClass("font-[650]");
    expect(general).not.toHaveAttribute("aria-description");
    expect(general.querySelector(".rounded-full")).toBeNull();
  });
});

describe(feature("sidebar.activity-filter"), () => {
  const marked = [{ ...rooms[0]!, unread: true }, rooms[1]!, { id: "design", name: "design", kind: "open" as const, icon: null, unread: true }];
  const shownRooms = () => within(screen.getByRole("region", { name: "Rooms" })).queryAllByRole("link").map((link) => link.textContent);

  it("shows only the rows marked unread, and hides the DMs' placeholder", () => {
    const { rerender } = render(<Sidebar workspaceName="Ember" rooms={marked} starred={unstarred} currentRoomId={null} unreadOnly onSelect={vi.fn()} />);
    expect(shownRooms()).toEqual(["#general", "#design"]);
    expect(screen.queryByText("No direct messages yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "DMs" })).toBeInTheDocument();
    expect(screen.queryByText("You’re all caught up. No unread conversations.")).not.toBeInTheDocument();

    rerender(<Sidebar workspaceName="Ember" rooms={marked} starred={unstarred} currentRoomId={null} unreadOnly={false} onSelect={vi.fn()} />);
    expect(shownRooms()).toEqual(["#general", "#random", "#design"]);
    expect(screen.getByText("No direct messages yet.")).toBeInTheDocument();
  });

  it("leaves out the room the tab shows, which is never marked", () => {
    render(<Sidebar workspaceName="Ember" rooms={marked} starred={unstarred} currentRoomId="general" unreadOnly onSelect={vi.fn()} />);
    expect(shownRooms()).toEqual(["#design"]);
  });

  it("says everything's read when nothing is marked", () => {
    render(<Sidebar workspaceName="Ember" rooms={rooms} starred={unstarred} currentRoomId="general" unreadOnly onSelect={vi.fn()} />);
    expect(shownRooms()).toEqual([]);
    expect(screen.getByText("You’re all caught up. No unread conversations.")).toHaveClass("text-[13px]", "text-muted-foreground");
  });
});

describe(feature("sidebar.favorites"), () => {
  it("ends a starred room's row with a star, after its unread dot, which screen readers hear as Favorite", () => {
    const starred = new Set(["general", "random"]);
    render(<Sidebar workspaceName="Ember" rooms={[rooms[0]!, { ...rooms[1]!, unread: true }]} starred={starred} currentRoomId={null} unreadOnly={false} onSelect={vi.fn()} />);
    const [general, random] = within(screen.getByRole("region", { name: "Rooms" })).getAllByRole("link");
    const star = within(general!).getByRole("img", { name: "Favorite" });
    expect(star).toHaveTextContent("★");
    expect(star).toHaveClass("ml-auto", "text-[14px]", "text-muted-foreground");
    expect(general!.lastElementChild).toBe(star);

    // The dot takes the space before it.
    const [dot, marker] = Array.from(random!.children).slice(-2);
    expect(dot).toHaveClass("ml-auto", "rounded-full");
    expect(marker).toHaveAccessibleName("Favorite");
    expect(marker).not.toHaveClass("ml-auto");
  });

  it("leaves the other rows without one", () => {
    render(<Sidebar workspaceName="Ember" rooms={rooms} starred={new Set(["random"])} currentRoomId="general" unreadOnly={false} onSelect={vi.fn()} />);
    const [general, random] = within(screen.getByRole("region", { name: "Rooms" })).getAllByRole("link");
    expect(within(general!).queryByRole("img")).not.toBeInTheDocument();
    expect(within(random!).getByRole("img", { name: "Favorite" })).toBeInTheDocument();
  });
});
