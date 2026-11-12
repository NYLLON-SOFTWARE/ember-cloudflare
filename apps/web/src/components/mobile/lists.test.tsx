import type { Me, SidebarRoom } from "@ember/protocol";
import { render as renderPage, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";
import { ActivityPage } from "./activity-page";
import { DmsPage } from "./dms-page";

/** A tab's page, in the layout's Sheet, as its top bar's drawer button needs where there's a drawer. */
const render = (page: ReactNode) => renderPage(<Sheet>{page}</Sheet>);

const me: Me = { id: "u1", name: "Ada", administrator: false } as Me;
const ada = { id: "u1", name: "Ada" };
const grace = { id: "u2", name: "Grace" };
const alan = { id: "u3", name: "Alan" };
const rooms: SidebarRoom[] = [
  { id: "general", name: "general", kind: "open", icon: null, unread: true, unreadSince: "2026-11-11T10:00:00Z", involvement: "mentions" },
  { id: "random", name: "random", kind: "open", icon: null, unread: false, involvement: "mentions" },
  { id: "d1", kind: "direct", members: [ada, grace], activeAt: "2026-11-11T09:00:00Z", unread: false, involvement: "everything" },
  { id: "d2", kind: "direct", members: [ada, alan, grace], activeAt: "2026-11-11T11:00:00Z", unread: true, unreadSince: "2026-11-11T11:00:00Z", involvement: "everything" },
] as SidebarRoom[];

describe("DMs on a phone", () => {
  it("lists the DMs latest active first, the people in one-to-one DMs as faces, and only the unread ones with Unreads", async () => {
    render(<DmsPage me={me} rooms={rooms} loaded onNewDirect={vi.fn()} />);
    const list = within(screen.getByRole("list", { name: "Direct messages" }));
    expect(list.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/rooms/d2", "/rooms/d1"]);
    expect(list.getByRole("link", { name: /Alan, Grace/ })).toHaveAccessibleDescription("Unread");
    expect(within(screen.getByRole("list", { name: "Recent" })).getAllByRole("link").map((link) => link.textContent)).toEqual(["Grace"]);

    await userEvent.click(screen.getByRole("button", { name: "Unreads" }));
    expect(screen.getByRole("button", { name: "Unreads" })).toHaveAttribute("aria-pressed", "true");
    expect(list.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/rooms/d2"]);
  });

  it("opens New direct message from its floating button", async () => {
    const onNewDirect = vi.fn();
    render(<DmsPage me={me} rooms={rooms} loaded onNewDirect={onNewDirect} />);
    await userEvent.click(screen.getByRole("link", { name: "New direct message" }));
    expect(onNewDirect).toHaveBeenCalledWith(screen.getByRole("link", { name: "New direct message" }));
  });
});

describe("Activity on a phone", () => {
  it("lists the unread conversations, newest first, which DMs and Rooms filter", async () => {
    render(<ActivityPage me={me} rooms={rooms} loaded />);
    const links = () => within(screen.getByRole("list", { name: "Unread conversations" })).queryAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links()).toEqual(["/rooms/d2", "/rooms/general"]);
    await userEvent.click(screen.getByRole("button", { name: "Rooms" }));
    expect(links()).toEqual(["/rooms/general"]);
    await userEvent.click(screen.getByRole("button", { name: "DMs" }));
    expect(links()).toEqual(["/rooms/d2"]);
  });

  it("says when everything's read", () => {
    render(<ActivityPage me={me} rooms={rooms.filter((room) => !room.unread)} loaded />);
    expect(screen.getByText("You’re all caught up. No unread conversations.")).toBeInTheDocument();
  });
});
