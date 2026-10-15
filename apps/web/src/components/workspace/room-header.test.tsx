import { feature } from "@ember/parity";
import { avatarSvg, type Room, type User } from "@ember/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { RoomHeader } from "./room-header";

const people = (count: number): User[] => Array.from({ length: count }, (_, i) => ({ id: `u${i}`, name: `Person ${i}` }));
const general: Room = { id: "general", name: "general", kind: "open", icon: null };

afterEach(() => history.replaceState(null, "", "/"));

/** The header inside the drawer's Sheet, which its menu button opens, as in the workspace. */
function renderHeader(props: Partial<ComponentProps<typeof RoomHeader>> = {}, onOpenChange?: (open: boolean) => void) {
  return render(
    <Sheet onOpenChange={onOpenChange}>
      <RoomHeader room={general} present={[]} status="open" offline={false} favorite={false} onStarred={vi.fn()} onSessionChanged={vi.fn()} {...props} />
    </Sheet>,
  );
}

describe(feature("realtime.who-is-here"), () => {
  it("shows up to four faces of the people here, and how many more", () => {
    renderHeader({ present: people(6) });
    expect(screen.getByText("6 here now")).toBeInTheDocument();
    const faces = [...screen.getByTitle(/^Person 0, Person 1, .*Person 5$/).querySelectorAll("img")];
    // Their initials, drawn as the Worker draws them while the directory doesn't list them.
    expect(faces.map((face) => atob(face.getAttribute("src")!.split(",")[1]!))).toEqual(people(4).map((person) => avatarSvg(person.id, person.name)));
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("shows no overflow count for four or fewer", () => {
    renderHeader({ present: people(2) });
    expect(screen.getByText("2 here now")).toBeInTheDocument();
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  });
});

describe(feature("ui.room-header"), () => {
  it("shows the room's name after a # in the Page navigation, and screen readers hear just the name", () => {
    renderHeader();
    expect(screen.getByRole("navigation", { name: "Page" })).toHaveTextContent(/^#general/);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("general");
  });
});

describe(feature("sidebar.favorites"), () => {
  it("has a star after the room's name, pressed while it's starred", () => {
    const { unmount } = renderHeader();
    const star = screen.getByRole("button", { name: "Favorite room" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    expect(star.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    unmount();

    renderHeader({ favorite: true });
    expect(screen.getByRole("button", { name: "Favorite room" })).toHaveAttribute("aria-pressed", "true");
  });

  it("has none in a DM, which can't be starred", () => {
    renderHeader({ room: { id: "direct-1", name: "Ada", kind: "direct", icon: null } });
    expect(screen.queryByRole("button", { name: "Favorite room" })).not.toBeInTheDocument();
  });
});

describe(feature("rooms.settings-page"), () => {
  it("links to the room's settings at the address for its kind, showing them in place", async () => {
    renderHeader({ room: { id: "leads", name: "Leads", kind: "closed", icon: null } });
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
  ] as const)("says when the room is %s, once it has been without a connection a while", (status, label) => {
    renderHeader({ status, offline: true });
    expect(screen.getByRole("status")).toHaveTextContent(label);
  });

  it("says nothing while the connection has only just dropped", () => {
    renderHeader({ status: "reconnecting" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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

describe(feature("rooms.icons"), () => {
  it("shows the room's icon before its name, or `#`", () => {
    const { unmount } = renderHeader({ room: { ...general, icon: "rocket" } });
    const icon = document.querySelector<HTMLElement>('[data-icon="rocket"]')!;
    expect(icon).toHaveStyle({ width: "22px", height: "22px" });
    expect(icon.compareDocumentPosition(screen.getByRole("heading", { level: 1, name: "general" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();

    renderHeader();
    expect(screen.getByText("#")).toHaveAttribute("aria-hidden", "true");
  });
});
