import type { Me, Room } from "@ember/protocol";
import type { RoomTab } from "@ember/protocol/library";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_LAYOUT } from "@/hooks/use-phone-layout";
import { PushContext } from "@/hooks/use-push";
import { PUSH_ON } from "@/test-push";
import { loadRarePages } from "../workspace/rare-pages";
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

// Room details load with the pages.
beforeAll(() => loadRarePages(), 120_000);

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
    expect(within(header()).queryByRole("button", { name: "Star room" })).not.toBeInTheDocument();
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
    expect(within(sheet).getByRole("button", { name: "Star room" })).toHaveAttribute("aria-pressed", "false");
    expect(within(sheet).getByRole("button", { name: "Notifications" })).toHaveAccessibleDescription("@ mentions");
    expect(within(sheet).getByRole("button", { name: "Members" })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Search in conversation" })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/rooms/closeds/backend/edit");

    await userEvent.click(within(sheet).getByRole("button", { name: "Files & links" }));
    expect(tabs.show).toHaveBeenCalledWith("files");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("picks your level in the room from a sheet of its own, whether or not this phone can have notifications", async () => {
    const answered = vi.fn();
    const fetched = vi.mocked(fetch);
    fetched.mockImplementation(async (input) => (String(input).endsWith("/involvement") ? Response.json({ involvement: "everything" }) : Response.json({ room: backend, people: [], canAdminister: false })));
    render(
      <RoomTabsContext value={tabsOf()}>
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
          askForRoom={() => answered}
          onSessionChanged={vi.fn()}
          onFailed={vi.fn()}
        />
      </RoomTabsContext>,
    );
    await userEvent.click(within(header()).getByRole("button", { name: /^Backend/ }));
    // Where notifications can't be on at all, as in Safari outside the Home Screen, there's nothing to enable.
    expect(within(details()).queryByRole("button", { name: "Enable notifications" })).not.toBeInTheDocument();
    await userEvent.click(within(details()).getByRole("button", { name: "Notifications" }));
    const levels = within(await screen.findByRole("dialog", { name: "Notifications" })).getByRole("radiogroup", { name: "Notifications" });
    expect(within(levels).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["All messages", "@ mentions", "Off", "Off and hidden"]);
    expect(within(levels).getByRole("radio", { name: "@ mentions" })).toBeChecked();
    await userEvent.click(within(levels).getByRole("radio", { name: "All messages" }));
    expect(fetched).toHaveBeenCalledWith("/api/rooms/backend/involvement", expect.objectContaining({ method: "PUT", body: JSON.stringify({ involvement: "everything" }) }));
    expect(answered).toHaveBeenCalledWith({ type: "involved", roomId: "backend", involvement: "everything" });
    // Back to the room's details, which the levels came from.
    expect(await screen.findByRole("dialog", { name: "Engineering – Backend" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("shows the members on a page of their own over the room, which Back closes", async () => {
    renderHeader();
    await userEvent.click(within(header()).getByRole("button", { name: /^Backend/ }));
    await userEvent.click(within(details()).getByRole("button", { name: "Members" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Members" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await vi.waitFor(() => expect(screen.queryByRole("heading", { level: 1, name: "Members" })).not.toBeInTheDocument());
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
    expect(within(details()).queryByRole("button", { name: "Members" })).not.toBeInTheDocument();
    expect(within(details()).queryByRole("button", { name: "Star room" })).not.toBeInTheDocument();
  });
});
