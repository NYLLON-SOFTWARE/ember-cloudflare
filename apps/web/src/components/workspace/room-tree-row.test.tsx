import type { Account, Favorites, SidebarRoom } from "@ember/protocol";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "@/hooks/use-account";
import { Sidebar } from "./sidebar";

const EMBER: Account = { name: "Ember", tagline: "", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null, joinLink: true, openSignUp: false, memberfulJoin: false, memberfulSignIn: false, emailDomainSignUp: false, emailDomains: [], navigationIcons: {}, huddles: false };
const unstarred: Favorites = { rooms: [], version: 0 };

const shared = (id: string, name: string, parent?: string, unread = false): SidebarRoom => ({
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
