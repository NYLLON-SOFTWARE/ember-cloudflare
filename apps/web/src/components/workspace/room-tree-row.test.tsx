import type { Account, Favorites, SharedRoom, SidebarRoom } from "@ember/protocol";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "@/hooks/use-account";
import { RoomTreeRow, type TreeRowOptions } from "./room-tree-row";
import { Sidebar } from "./sidebar";

const EMBER: Account = { name: "Ember", tagline: "", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null, joinLink: true, openSignUp: false, memberfulJoin: false, memberfulSignIn: false, emailDomainSignUp: false, emailDomains: [], navigationIcons: {}, huddles: false };
const unstarred: Favorites = { rooms: [], version: 0 };

const shared = (id: string, name: string, parent?: string, unread = false): SidebarRoom & SharedRoom => ({
  id,
  name,
  kind: "open",
  icon: null,
  unread,
  involvement: "mentions",
  ...(parent && { parent: { id: parent, name: "Strata" } }),
});
const strata = shared("strata", "Strata");
const general = shared("general", "general");
const subRooms = [shared("sales", "Sales", "strata"), shared("titling", "Titling", "strata", true), shared("inventory", "Inventory", "strata")];

function renderSidebar(props: Partial<ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <AccountContext value={EMBER}>
      <Sidebar
        workspaceName="Ember"
        meId="u1"
        rooms={[general, strata, ...subRooms]}
        loaded
        suggestions={[]}
        favorites={unstarred}
        sharedOrder={["strata", "inventory", "sales", "titling", "general"]}
        currentRoomId={null}
        unreadOnly={false}
        onSelect={vi.fn()}
        onNewDirect={vi.fn()}
        onStartDirect={vi.fn(async () => true)}
        onStarred={vi.fn()}
        onSessionChanged={vi.fn()}
        {...props}
      />
    </AccountContext>,
  );
}

const roomsRegion = () => screen.getByRole("region", { name: "Rooms" });
const listed = () => within(roomsRegion()).queryAllByRole("link").map((link) => link.textContent);
const toggle = () => within(roomsRegion()).getByRole("button", { name: /Strata’s sub-rooms$/ });

beforeEach(() => localStorage.clear());

describe("Sub-rooms in the sidebar", () => {
  it("lists a parent's sub-rooms under it, in the shared order, behind an arrow that's expanded", () => {
    renderSidebar();
    expect(listed()).toEqual(["#Strata", "#Inventory", "#Sales", "#Titling•", "#general"].map((text) => text.replace("•", "")));
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByRole("group", { name: "Strata’s sub-rooms" })).getAllByRole("link")).toHaveLength(3);
  });

  it("shows the arrow to a pointer only as its row is hovered or has focus while expanded, and always while collapsed", async () => {
    renderSidebar();
    expect(toggle()).toHaveClass("opacity-0", "group-hover/tree:opacity-100", "touch:opacity-100");
    await userEvent.click(toggle());
    expect(toggle()).not.toHaveClass("opacity-0");
  });

  it("collapses them with the arrow, which the parent's name doesn't, showing their unread mark on the parent, and remembers it", async () => {
    const onSelect = vi.fn();
    const { unmount } = renderSidebar({ onSelect });
    await userEvent.click(toggle());
    expect(listed()).toEqual(["#Strata", "#general"]);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(within(roomsRegion()).getByRole("link", { name: /Strata/ })).toHaveAccessibleDescription(/Unread/);
    expect(onSelect).not.toHaveBeenCalled();
    unmount();

    renderSidebar({ currentRoomId: "sales" });
    // Collapsed still, it keeps the room the tab shows under its parent.
    expect(listed()).toEqual(["#Strata", "#Sales", "#general"]);
    await userEvent.click(within(roomsRegion()).getByRole("link", { name: /Strata/ }));
  });

  it("names a starred sub-room, listed with the stars, with its parent", () => {
    renderSidebar({ favorites: { rooms: ["sales"], version: 1 } });
    expect(listed()[0]).toBe("#Strata – Sales");
    expect(listed()).not.toContain("#Sales");
  });
});

describe("A collapsed parent's unread count", () => {
  it("shows in the sidebar's pill the parent's and its sub-rooms' counts, or the dot when none are counted", async () => {
    const counts = [{ ...strata, unread: true, unreadCount: 2 }, ...subRooms.map((sub) => (sub.unread ? { ...sub, unreadCount: 8 } : sub))];
    renderSidebar({ rooms: [general, ...counts] });
    await userEvent.click(toggle());
    expect(within(roomsRegion()).getByRole("link", { name: /Strata/ })).toHaveAccessibleDescription(/^9\+ unread/);
    expect(within(roomsRegion()).getByRole("link", { name: /Strata/ })).toHaveTextContent("9+");
  });

  it("keeps the pill at the row's end, where the arrow takes its place as the row is hovered or has focus", async () => {
    const counts = [{ ...strata, unread: true, unreadCount: 2 }, ...subRooms];
    renderSidebar({ rooms: [general, ...counts] });
    const parentRow = () => within(roomsRegion()).getByRole("link", { name: /Strata/ });
    for (const collapsed of [false, true]) {
      expect(parentRow()).not.toHaveClass("pr-10");
      expect(parentRow()).toHaveClass("group-hover/tree:[&>:last-child]:invisible", "touch:[&>:last-child]:visible");
      expect(toggle()).toHaveClass("opacity-0", "group-hover/tree:opacity-100", "touch:opacity-100");
      if (!collapsed) await userEvent.click(toggle());
    }
  });

  it("keeps the dot on a collapsed parent whose unread sub-rooms count nothing", async () => {
    renderSidebar();
    await userEvent.click(toggle());
    const parent = within(roomsRegion()).getByRole("link", { name: /Strata/ });
    expect(parent).toHaveAccessibleDescription(/^Unread/);
    expect(parent).not.toHaveTextContent(/\d/);
  });

  type Counted = SharedRoom & { unread: boolean; unreadCount?: number; unreadMentioned?: boolean };
  const counted = (room: Counted, unreadCount: number): Counted => ({ ...room, unread: true, unreadCount });
  /** The options the tree gives each room's row, by room. */
  function optionsOf(parent: Counted, subs: Counted[], collapsed: boolean) {
    const given = new Map<string, TreeRowOptions>();
    render(
      <RoomTreeRow
        branch={{ room: parent, subRooms: subs }}
        label={parent.name}
        row={(room, options) => {
          given.set(room.id, options);
          return <a key={room.id} href={`#${room.id}`}>{options.label}</a>;
        }}
        isUnread={(room) => room.unread}
        currentRoomId={null}
        collapsed={collapsed}
        onToggle={vi.fn()}
      />,
    );
    return given;
  }

  it("counts the parent's and its unread sub-rooms' messages, up to the cap, while collapsed", () => {
    const given = optionsOf(counted(strata, 2), [counted(subRooms[0]!, 3), { ...subRooms[2]!, unreadCount: 4 }], true);
    // Inventory, not marked unread, counts nothing.
    expect(given.get("strata")).toMatchObject({ unread: true, count: 5 });
    expect(optionsOf(counted(strata, 6), [counted(subRooms[0]!, 9)], true).get("strata")).toMatchObject({ count: 10 });
  });

  it("leaves an expanded parent, and one with nothing counted, its own count", () => {
    expect(optionsOf(counted(strata, 2), [counted(subRooms[0]!, 3)], false).get("strata")).not.toHaveProperty("count");
    expect(optionsOf(strata, [subRooms[1]!], true).get("strata")).toMatchObject({ unread: true });
    expect(optionsOf(strata, [subRooms[1]!], true).get("strata")).not.toHaveProperty("count");
  });

  it("says a collapsed parent is mentioned where it or an unread sub-room is, and leaves an expanded one its own", () => {
    const mentioning = { ...counted(subRooms[0]!, 3), unreadMentioned: true };
    expect(optionsOf(counted(strata, 2), [mentioning], true).get("strata")).toMatchObject({ count: 5, mentioned: true });
    expect(optionsOf({ ...counted(strata, 2), unreadMentioned: true }, [counted(subRooms[0]!, 3)], true).get("strata")).toMatchObject({ mentioned: true });
    expect(optionsOf(counted(strata, 2), [counted(subRooms[0]!, 3)], true).get("strata")).toMatchObject({ mentioned: false });
    // Inventory, not marked unread, mentions no one the sidebar shows.
    expect(optionsOf(counted(strata, 2), [{ ...subRooms[2]!, unreadCount: 4, unreadMentioned: true }], true).get("strata")).toMatchObject({ mentioned: false });
    expect(optionsOf(counted(strata, 2), [mentioning], false).get("strata")).not.toHaveProperty("mentioned");
  });
});
