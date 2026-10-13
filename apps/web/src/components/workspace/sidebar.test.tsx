import { feature } from "@ember/parity";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";

const rooms = [
  { id: "general", name: "general", kind: "open" as const },
  { id: "random", name: "random", kind: "open" as const },
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
