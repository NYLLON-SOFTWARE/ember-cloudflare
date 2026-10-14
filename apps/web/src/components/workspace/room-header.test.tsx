import { feature } from "@ember/parity";
import type { Room, User } from "@ember/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { RoomHeader } from "./room-header";

const people = (count: number): User[] => Array.from({ length: count }, (_, i) => ({ id: `u${i}`, name: `Person ${i}` }));
const general: Room = { id: "general", name: "general", kind: "open" };

afterEach(() => history.replaceState(null, "", "/"));

/** The header inside the drawer's Sheet, which its menu button opens, as in the workspace. */
function renderHeader(props: Partial<ComponentProps<typeof RoomHeader>> = {}, onOpenChange?: (open: boolean) => void) {
  return render(
    <Sheet onOpenChange={onOpenChange}>
      <RoomHeader room={general} present={[]} status="open" {...props} />
    </Sheet>,
  );
}

describe(feature("realtime.who-is-here"), () => {
  it("shows up to four faces of the people here, and how many more", () => {
    renderHeader({ present: people(6) });
    expect(screen.getByText("6 here now")).toBeInTheDocument();
    expect(screen.getAllByText(/^P\d$/).map((face) => face.textContent)).toEqual(["P0", "P1", "P2", "P3"]);
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByTitle(/^Person 0, Person 1, .*Person 5$/)).toBeInTheDocument();
  });

  it("shows no overflow count for four or fewer", () => {
    renderHeader({ present: people(2) });
    expect(screen.getByText("2 here now")).toBeInTheDocument();
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  });
});

describe(feature("ui.room-header"), () => {
  it("shows the room's name after a #, and screen readers hear just the name", () => {
    renderHeader();
    expect(screen.getByRole("banner")).toHaveTextContent(/^#general/);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("general");
  });
});

describe(feature("rooms.settings-page"), () => {
  it("links to the room's settings at the address for its kind, showing them in place", async () => {
    renderHeader({ room: { id: "leads", name: "Leads", kind: "closed" } });
    const settings = screen.getByRole("link", { name: "Settings for this room" });
    expect(settings).toHaveAttribute("title", "Conversation settings");
    expect(settings).toHaveAttribute("href", "/rooms/closeds/leads/edit");
    await userEvent.click(settings);
    expect(location.pathname).toBe("/rooms/closeds/leads/edit");
  });
});

describe(feature("realtime.reconnect"), () => {
  it.each([
    ["connecting", "Connecting…"],
    ["reconnecting", "Reconnecting…"],
  ] as const)("says when the room is %s", (status, label) => {
    renderHeader({ status });
    expect(screen.getByRole("status")).toHaveTextContent(label);
  });

  it("shows no status once connected", () => {
    renderHeader();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows no status for a room that's gone, which nothing reconnects to", () => {
    renderHeader({ status: "gone" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe(feature("ui.mobile-drawer"), () => {
  it("has a button that opens the conversations drawer", async () => {
    const onOpenChange = vi.fn();
    renderHeader({}, onOpenChange);
    const button = screen.getByRole("button", { name: "Open conversations" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
