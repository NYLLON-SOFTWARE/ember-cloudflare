import type { Me, Room } from "@ember/protocol";
import type { RoomTab } from "@ember/protocol/library";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_LAYOUT } from "@/hooks/use-phone-layout";
import { PushContext } from "@/hooks/use-push";
import { PUSH_ON } from "@/test-push";
import { RoomTabsContext, type RoomTabsState } from "../workspace/room-tabs";
import { MobileRoomHeader } from "./room-header";

const linus: Me = { id: "linus", name: "Linus", administrator: false };
const ada = { id: "ada", name: "Ada" };
const backend: Room = { id: "backend", name: "Backend", kind: "closed", icon: null, parent: { id: "engineering", name: "Engineering" } };
const adaDirect: Room = { id: "direct-1", kind: "direct", members: [ada, { id: "linus", name: "Linus" }], activeAt: "2026-10-15T12:00:00.000Z" };
const groupDirect: Room = { ...adaDirect, id: "direct-2", members: [...adaDirect.members, { id: "grace", name: "Grace" }] };

beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === PHONE_LAYOUT, media, addEventListener() {}, removeEventListener() {} }));
  // The room's settings, with who's in it, and Ada's page, with her time zone.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/users/ada")) return Response.json({ person: { ...ada, bio: null, role: "member", status: "active", avatarUrl: "/users/ada/avatar", timeZone: "Asia/Tokyo" } });
    return Response.json({ room: backend, people: Array.from({ length: 9 }, (_, i) => ({ id: `u${i}`, name: `Person ${i}`, member: true })), canAdminister: false });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

function tabsOf(tabs: RoomTab[] = [], shown = "messages"): RoomTabsState {
  return { tabs, shown, show: vi.fn(), add: vi.fn(), edit: vi.fn(), deleted: false, adding: null, editing: false, closeDialogs: vi.fn(), setTabs: vi.fn(), reload: vi.fn() };
}

function renderHeader(props: Partial<ComponentProps<typeof MobileRoomHeader>> = {}, tabs: RoomTabsState = tabsOf()) {
  return render(
    <PushContext value={PUSH_ON}>
      <RoomTabsContext value={tabs}>
        <MobileRoomHeader
          room={backend}
          me={linus}
          name="Engineering – Backend"
          present={[]}
          status="open"
          offline={false}
          favorite={false}
          onStarred={vi.fn()}
          involvement="mentions"
          askForRoom={() => vi.fn()}
          onSessionChanged={vi.fn()}
          onFailed={vi.fn()}
          {...props}
        />
      </RoomTabsContext>
    </PushContext>,
  );
}

const header = () => screen.getByRole("navigation", { name: "Page" });
const details = () => screen.getByRole("dialog");

describe("A room's top bar on a phone", () => {
  it("is Back, and the room's own name with its parent's and how many are in it, for a sub-room", async () => {
    renderHeader();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Backend$/);
    expect(await within(header()).findByRole("button", { name: "Backend Engineering · 9 members" })).toBeInTheDocument();
    expect(within(header()).getByRole("link", { name: "Back" })).toHaveAttribute("href", "/");
    // The star and the bell are in the room's details, rather than the top bar.
    expect(within(header()).queryByRole("button", { name: "Favorite room" })).not.toBeInTheDocument();
    expect(within(header()).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("goes Back up to Activity for a room Activity opened", () => {
    history.replaceState(null, "", "/activity/rooms/backend/@m1");
    renderHeader();
    expect(within(header()).getByRole("link", { name: "Back" })).toHaveAttribute("href", "/activity");
  });

  it("says the tab shown in place of how many there are", async () => {
    const tab: RoomTab = { id: "t1", kind: "canvas", title: "Roadmap" } as RoomTab;
    const { unmount } = renderHeader({}, tabsOf([tab]));
    expect(await within(header()).findByRole("button", { name: "Backend Engineering · 9 members · 1 tab" })).toBeInTheDocument();
    unmount();
    renderHeader({}, tabsOf([tab], "t1"));
    expect(await within(header()).findByRole("button", { name: "Backend Engineering · 9 members · Roadmap" })).toBeInTheDocument();
  });

  it("has a DM with one person's avatar, whether they're here, and their time where they are", async () => {
    vi.setSystemTime(new Date("2026-11-12T17:51:00Z"));
    renderHeader({ room: adaDirect, name: "Ada", present: [ada] });
    const time = new Date().toLocaleTimeString(undefined, { timeZone: "Asia/Tokyo", hour: "numeric", minute: "2-digit" });
    expect(await within(header()).findByRole("button", { name: `Direct message with Ada Active · ${time} local` })).toBeInTheDocument();
    expect(header().querySelector("img")).toBeInTheDocument();
    expect(within(header()).getByRole("link", { name: "Back" })).toHaveAttribute("href", "/dms");
    vi.useRealTimers();
  });

  it("has how many are in a group DM", () => {
    renderHeader({ room: groupDirect, name: "Ada and Grace" });
    expect(within(header()).getByRole("button", { name: "Direct message with Ada and Grace 3 members" })).toBeInTheDocument();
  });
});

describe("Room details on a phone", () => {
  it("opens from the pill with the room's tabs, the star, the bell, its members, Search and its settings", async () => {
    const tabs = tabsOf();
    renderHeader({}, tabs);
    await userEvent.click(within(header()).getByRole("button", { name: /^Backend/ }));
    const sheet = details();
    expect(within(sheet).getByRole("button", { name: "Messages" })).toHaveAttribute("aria-current", "true");
    expect(within(sheet).getByRole("button", { name: "Favorite room" })).toHaveAttribute("aria-pressed", "false");
    expect(within(sheet).getByRole("checkbox", { name: "Notifying about @ mentions" })).toBeInTheDocument();
    expect(await within(sheet).findByRole("button", { name: "View members, 9 members" })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Search in conversation" })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/rooms/closeds/backend/edit");

    await userEvent.click(within(sheet).getByRole("button", { name: "Files & links" }));
    expect(tabs.show).toHaveBeenCalledWith("files");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("adds a tab from a sheet of its own", async () => {
    const tabs = tabsOf();
    renderHeader({}, tabs);
    await userEvent.click(within(header()).getByRole("button", { name: /^Backend/ }));
    await userEvent.click(within(details()).getByRole("button", { name: "Add a tab" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Add a tab" })).getByRole("button", { name: "Canvas" }));
    expect(tabs.add).toHaveBeenCalledWith("canvas");
  });

  it("has a DM with one person's profile in place of its members, and no star", async () => {
    renderHeader({ room: adaDirect, name: "Ada" });
    await userEvent.click(within(header()).getByRole("button", { name: /^Direct message with Ada/ }));
    expect(within(details()).getByRole("link", { name: "View profile" })).toHaveAttribute("href", "/users/ada");
    expect(within(details()).queryByRole("button", { name: /^View members/ })).not.toBeInTheDocument();
    expect(within(details()).queryByRole("button", { name: "Favorite room" })).not.toBeInTheDocument();
  });
});
