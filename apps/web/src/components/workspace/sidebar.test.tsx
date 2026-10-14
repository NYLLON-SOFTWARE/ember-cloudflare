import { feature } from "@ember/parity";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";

const rooms = [
  { id: "general", name: "general", kind: "open" as const, icon: null, unread: false },
  { id: "random", name: "random", kind: "open" as const, icon: null, unread: false },
];

describe(feature("sidebar.rooms"), () => {
  it("lists the rooms under the workspace name and marks the one you're in", () => {
    render(<Sidebar rooms={rooms} currentRoomId="random" onSelect={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 2, name: "Ember" })).toBeInTheDocument();
    const links = within(screen.getByRole("region", { name: "Rooms" })).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
      ["#general", "/rooms/general", null],
      ["#random", "/rooms/random", "page"],
    ]);
  });

  it("switches rooms in place, but leaves modified clicks to the browser", async () => {
    const onSelect = vi.fn();
    render(<Sidebar rooms={rooms} currentRoomId="general" onSelect={onSelect} />);
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
    render(<Sidebar rooms={[{ ...rooms[0]!, icon: "coffee" }, rooms[1]!]} currentRoomId="general" onSelect={vi.fn()} />);
    const [coffee, random] = within(screen.getByRole("region", { name: "Rooms" })).getAllByRole("link");
    expect(coffee).toHaveAccessibleName("general");
    expect(coffee!.querySelector('[data-icon="coffee"]')).toHaveStyle({ width: "19px", height: "19px" });
    expect(random).toHaveTextContent("#random");
  });
});

describe(feature("sidebar.unread"), () => {
  it("makes an unread room's row bold, with a dot, and says so to screen readers", () => {
    render(<Sidebar rooms={[{ ...rooms[0]!, unread: true }, rooms[1]!]} currentRoomId={null} onSelect={vi.fn()} />);
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
    render(<Sidebar rooms={[{ ...rooms[0]!, unread: true }, rooms[1]!]} currentRoomId="general" onSelect={vi.fn()} />);
    const general = screen.getByRole("link", { current: "page" });
    expect(general).not.toHaveClass("font-[650]");
    expect(general).not.toHaveAttribute("aria-description");
    expect(general.querySelector(".rounded-full")).toBeNull();
  });
});
