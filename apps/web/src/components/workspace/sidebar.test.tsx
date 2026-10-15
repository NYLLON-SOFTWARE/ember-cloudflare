import { feature } from "@ember/parity";
import type { Favorites, SidebarRoom } from "@ember/protocol";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";

const rooms = [
  { id: "general", name: "general", kind: "open" as const, icon: null, unread: false },
  { id: "random", name: "random", kind: "open" as const, icon: null, unread: false },
];
const unstarred: Favorites = { rooms: [], version: 0 };
const HELP = "Hold a starred room to drag it, or press Alt and the up or down arrow to reorder your favorites. Other rooms follow the workspace order.";

type Props = ComponentProps<typeof Sidebar>;

/** The sidebar, with `props` in place of an unstarred one listing `rooms` with none open. */
function renderSidebar(props: Partial<Props> = {}) {
  const all: Props = {
    workspaceName: "Ember",
    rooms,
    favorites: unstarred,
    currentRoomId: null,
    unreadOnly: false,
    onSelect: vi.fn(),
    onStarred: vi.fn(),
    onSessionChanged: vi.fn(),
    ...props,
  };
  const view = render(<Sidebar {...all} />);
  return { ...view, ...all, rerender: (changes: Partial<Props>) => view.rerender(<Sidebar {...all} {...changes} />) };
}

/** The room rows, top to bottom. */
const rows = () => within(screen.getByRole("region", { name: "Rooms" })).queryAllByRole("link");
const listed = () => rows().map((row) => row.textContent?.replace(/★$/, ""));
const row = (name: string) => rows().find((link) => link.textContent?.replace(/★$/, "") === `#${name}`)!;

afterEach(() => vi.restoreAllMocks());

describe(feature("sidebar.rooms"), () => {
  it("lists the rooms under the workspace name and marks the one you're in", () => {
    renderSidebar({ workspaceName: "Analytical Engines", currentRoomId: "random" });
    expect(screen.getByRole("heading", { level: 2, name: "Analytical Engines" })).toBeInTheDocument();
    expect(rows().map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
      ["#general", "/rooms/general", null],
      ["#random", "/rooms/random", "page"],
    ]);
  });

  it("switches rooms in place, but leaves modified clicks to the browser", async () => {
    const { onSelect } = renderSidebar({ currentRoomId: "general" });
    await userEvent.click(screen.getByRole("link", { name: /random/ }));
    expect(onSelect).toHaveBeenCalledWith("random");

    vi.mocked(onSelect).mockClear();
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
      const click = fireEvent.click(screen.getByRole("link", { name: /random/ }), modifier);
      expect(click).toBe(true); // not prevented, so the browser opens a tab or window
    }
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe(feature("rooms.icons"), () => {
  it("shows each room's icon before its name, or `#`", () => {
    renderSidebar({ rooms: [{ ...rooms[0]!, icon: "coffee" }, rooms[1]!], currentRoomId: "general" });
    const [coffee, random] = rows();
    expect(coffee).toHaveAccessibleName("general");
    expect(coffee!.querySelector('[data-icon="coffee"]')).toHaveStyle({ width: "19px", height: "19px" });
    expect(random).toHaveTextContent("#random");
  });
});

describe(feature("sidebar.unread"), () => {
  it("makes an unread room's row bold, with a dot, and says so to screen readers", () => {
    renderSidebar({ rooms: [{ ...rooms[0]!, unread: true }, rooms[1]!] });
    const [general, random] = rows();
    expect(general).toHaveClass("font-[650]");
    expect(general).toHaveAccessibleName("general");
    expect(general).toHaveAccessibleDescription(`Unread ${HELP}`);
    expect(general!.lastElementChild).toHaveAttribute("aria-hidden", "true");
    expect(general!.lastElementChild).toHaveClass("ml-auto", "size-[7px]", "rounded-full", "bg-foreground");

    expect(random).not.toHaveClass("font-[650]");
    expect(random).toHaveAccessibleDescription(HELP);
    expect(random!.querySelector(".rounded-full")).toBeNull();
  });

  it("never marks the room the tab shows", () => {
    renderSidebar({ rooms: [{ ...rooms[0]!, unread: true }, rooms[1]!], currentRoomId: "general" });
    const general = screen.getByRole("link", { current: "page" });
    expect(general).not.toHaveClass("font-[650]");
    expect(general).toHaveAccessibleDescription(HELP);
    expect(general.querySelector(".rounded-full")).toBeNull();
  });
});

describe(feature("sidebar.activity-filter"), () => {
  const marked = [{ ...rooms[0]!, unread: true }, rooms[1]!, { id: "design", name: "design", kind: "open" as const, icon: null, unread: true }];

  it("shows only the rows marked unread, and hides the DMs' placeholder", () => {
    const { rerender } = renderSidebar({ rooms: marked, unreadOnly: true });
    expect(listed()).toEqual(["#design", "#general"]);
    expect(screen.queryByText("No direct messages yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "DMs" })).toBeInTheDocument();
    expect(screen.queryByText("You’re all caught up. No unread conversations.")).not.toBeInTheDocument();

    rerender({ unreadOnly: false });
    expect(listed()).toEqual(["#design", "#general", "#random"]);
    expect(screen.getByText("No direct messages yet.")).toBeInTheDocument();
  });

  it("leaves out the room the tab shows, which is never marked", () => {
    renderSidebar({ rooms: marked, currentRoomId: "general", unreadOnly: true });
    expect(listed()).toEqual(["#design"]);
  });

  it("says everything's read when nothing is marked", () => {
    renderSidebar({ currentRoomId: "general", unreadOnly: true });
    expect(listed()).toEqual([]);
    expect(screen.getByText("You’re all caught up. No unread conversations.")).toHaveClass("text-[13px]", "text-muted-foreground");
  });
});

describe(feature("sidebar.room-order"), () => {
  it("lists your starred rooms first, in the order you starred them, then the rest by name", () => {
    const more = [...rooms, { id: "design", name: "Design", kind: "open" as const, icon: null, unread: false }, { id: "ops", name: "ops", kind: "open" as const, icon: null, unread: false }];
    renderSidebar({ rooms: more, favorites: { rooms: ["random", "ops"], version: 2 } });
    expect(listed()).toEqual(["#random", "#ops", "#Design", "#general"]);
  });
});

describe(feature("sidebar.favorites"), () => {
  it("ends a starred room's row with a grip and a star, around its unread dot, which screen readers hear as Favorite", () => {
    renderSidebar({ rooms: [rooms[0]!, { ...rooms[1]!, unread: true }], favorites: { rooms: ["general", "random"], version: 2 } });
    const [general, random] = rows();
    const star = within(general!).getByRole("img", { name: "Favorite" });
    expect(star).toHaveTextContent("★");
    expect(star).toHaveClass("text-[14px]", "text-muted-foreground");
    expect(general!.lastElementChild).toBe(star);
    const grip = star.previousElementSibling!;
    expect(grip).toHaveAttribute("aria-hidden", "true");
    expect(grip).toHaveClass("ml-auto", "text-muted-foreground");
    expect(grip.querySelector("svg")).toHaveClass("size-3.5");

    // The grip takes the space before the dot.
    const [handle, dot, marker] = Array.from(random!.children).slice(-3);
    expect(handle).toHaveClass("ml-auto");
    expect(dot).toHaveClass("rounded-full");
    expect(dot).not.toHaveClass("ml-auto");
    expect(marker).toHaveAccessibleName("Favorite");
  });

  it("leaves the other rows without one", () => {
    renderSidebar({ favorites: { rooms: ["random"], version: 1 }, currentRoomId: "general" });
    expect(within(row("general")).queryByRole("img")).not.toBeInTheDocument();
    expect(row("general").querySelector("svg")).toBeNull();
    expect(within(row("random")).getByRole("img", { name: "Favorite" })).toBeInTheDocument();
  });
});

describe(feature("sidebar.favorite-order"), () => {
  const team = [...rooms, { id: "design", name: "design", kind: "open" as const, icon: null, unread: false }, { id: "ops", name: "ops", kind: "open" as const, icon: null, unread: false }];
  const stars: Favorites = { rooms: ["general", "random", "design"], version: 3 };
  const status = () => screen.getByRole("status");
  /** What was sent to save an order, as the JSON it was sent as. */
  const sent = () => vi.mocked(fetch).mock.calls.map(([input, init]) => [String(input), init?.method, JSON.parse(String(init?.body))]);

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });

  // jsdom lays nothing out, so each row is 36px tall, in the order the list draws them, and the list
  // scrolls in a box too tall for a drag to scroll it.
  function layOutRows() {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (!this.dataset.roomId) return DOMRect.fromRect({ x: 0, y: -1000, width: 280, height: 3000 });
      return DOMRect.fromRect({ x: 0, y: Array.prototype.indexOf.call(this.parentElement!.children, this) * 36, width: 280, height: 36 });
    });
  }

  /** Holds `name`'s row down with the mouse until it can be dragged. */
  function hold(name: string) {
    fireEvent.pointerDown(row(name), { pointerType: "mouse", button: 0, clientX: 20, clientY: rows().indexOf(row(name)) * 36 + 18 });
    act(() => vi.advanceTimersByTime(400));
  }

  const dragTo = (clientY: number) => fireEvent.pointerMove(window, { pointerType: "mouse", clientX: 20, clientY });

  it("says how the stars are reordered on every row, and gives starred rows the keys that do it", () => {
    renderSidebar({ rooms: team, favorites: stars });
    for (const link of rows()) expect(link).toHaveAccessibleDescription(HELP);
    expect(rows().map((link) => link.getAttribute("aria-keyshortcuts"))).toEqual([
      "Alt+ArrowUp Alt+ArrowDown",
      "Alt+ArrowUp Alt+ArrowDown",
      "Alt+ArrowUp Alt+ArrowDown",
      null,
    ]);
    expect(row("ops")).not.toHaveClass("cursor-grab");
    expect(row("general")).toHaveClass("cursor-grab", "[-webkit-touch-callout:none]");
    expect(row("general")).toHaveAttribute("draggable", "false");
  });

  it("moves a starred row past the one above or below it with Alt and an arrow, saving the order, and keeps it focused", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ favorites: { rooms: ["random", "general", "design"], version: 4 } }));
    const { onStarred } = renderSidebar({ rooms: team, favorites: stars });
    row("random").focus();

    fireEvent.keyDown(row("random"), { key: "ArrowUp", altKey: true });
    expect(listed()).toEqual(["#random", "#general", "#design", "#ops"]);
    expect(status()).toHaveTextContent("Saving room order…");
    expect(status()).toHaveClass("sr-only");
    expect(row("random")).toHaveFocus();
    await act(async () => {});
    expect(sent()).toEqual([["/api/sidebar/order", "PUT", { roomIds: ["random", "general", "design"] }]]);
    expect(onStarred).toHaveBeenCalledWith({ rooms: ["random", "general", "design"], version: 4 });
    expect(status()).toHaveTextContent("Starred room order saved.");
  });

  it("moves down past the next starred row shown, keeping the places of the stars Activity hides, and goes no further than the last", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ favorites: { rooms: ["design", "general", "random"], version: 4 } }));
    const unread = team.map((room) => (room.id === "random" ? room : { ...room, unread: true }));
    renderSidebar({ rooms: unread, favorites: stars, unreadOnly: true });
    expect(listed()).toEqual(["#general", "#design", "#ops"]);

    fireEvent.keyDown(row("general"), { key: "ArrowDown", altKey: true });
    await act(async () => {});
    expect(sent()).toEqual([["/api/sidebar/order", "PUT", { roomIds: ["design", "general", "random"] }]]);

    // Only starred rows move, and not past the end of them, or with the arrow alone.
    for (const [name, key, altKey] of [["ops", "ArrowUp", true], ["design", "ArrowUp", false]] as const) fireEvent.keyDown(row(name), { key, altKey });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  describe("dragged", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      layOutRows();
    });
    afterEach(() => vi.useRealTimers());

    it("lifts a starred row held for 400ms, moves it past the rows whose middle it passes, and saves where it's let go", async () => {
      vi.mocked(fetch).mockResolvedValue(Response.json({ favorites: { rooms: ["random", "design", "general"], version: 4 } }));
      const { onSelect, onStarred } = renderSidebar({ rooms: team, favorites: stars });

      hold("general");
      expect(status()).toHaveTextContent("Moving general. Release to save, or press Escape to cancel.");
      expect(row("general")).toHaveClass("cursor-grabbing", "bg-background!", "shadow-[0_4px_14px_var(--color-drag-shadow)]", "outline");
      expect(row("general").parentElement).toHaveClass("select-none");

      // Below the middle of design's row, the third, is after every star but never past the unstarred rows.
      dragTo(3 * 36 + 30);
      expect(listed()).toEqual(["#random", "#design", "#general", "#ops"]);
      fireEvent.pointerUp(window);
      expect(row("general")).not.toHaveClass("cursor-grabbing");
      expect(row("general")).toHaveFocus();
      expect(status()).toHaveTextContent("Saving room order…");
      // Letting go doesn't open the room.
      fireEvent.click(row("general"));
      expect(onSelect).not.toHaveBeenCalled();

      await act(async () => {});
      expect(sent()).toEqual([["/api/sidebar/order", "PUT", { roomIds: ["random", "design", "general"] }]]);
      expect(onStarred).toHaveBeenCalledWith({ rooms: ["random", "design", "general"], version: 4 });
      act(() => vi.advanceTimersByTime(500));
      fireEvent.click(row("general"));
      expect(onSelect).toHaveBeenCalledWith("general");
    });

    it("saves where a row is let go without a starred room that went meanwhile, deleted or no longer theirs", async () => {
      vi.mocked(fetch).mockResolvedValue(Response.json({ favorites: { rooms: ["design", "general"], version: 4 } }));
      const { rerender } = renderSidebar({ rooms: team, favorites: stars });
      hold("design");
      dragTo(0);
      // The list drops a room that's gone, and its star, with no news that the stars changed.
      rerender({ rooms: team.filter((room) => room.id !== "random"), favorites: { rooms: ["general", "design"], version: 3 } });
      expect(row("design")).toHaveClass("cursor-grabbing");

      fireEvent.pointerUp(window);
      await act(async () => {});
      expect(sent()).toEqual([["/api/sidebar/order", "PUT", { roomIds: ["design", "general"] }]]);
    });

    it("puts a dragged row back on Escape wherever the focus is, saving nothing", () => {
      renderSidebar({ rooms: team, favorites: stars });
      hold("design");
      dragTo(0);
      expect(listed()).toEqual(["#design", "#general", "#random", "#ops"]);

      // Safari leaves the focus where it was when a row is clicked, in the composer, say. Escape is
      // taken as it's pressed, so it closes nothing else, but only while a row is dragged.
      expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(false);
      expect(listed()).toEqual(["#general", "#random", "#design", "#ops"]);
      expect(status()).toHaveTextContent("Room move canceled.");
      fireEvent.pointerUp(window);
      expect(fetch).not.toHaveBeenCalled();
      expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(true);
    });

    it("ignores Alt and an arrow while a row is held, saving only where a dragged one is let go", async () => {
      vi.mocked(fetch).mockResolvedValue(Response.json({ favorites: { rooms: ["design", "general", "random"], version: 4 } }));
      renderSidebar({ rooms: team, favorites: stars });
      // Before the hold has lifted the row, and once it's dragged.
      fireEvent.pointerDown(row("design"), { pointerType: "mouse", button: 0, clientX: 20, clientY: 2 * 36 + 18 });
      fireEvent.keyDown(row("random"), { key: "ArrowUp", altKey: true });
      act(() => vi.advanceTimersByTime(400));
      dragTo(0);
      fireEvent.keyDown(row("random"), { key: "ArrowUp", altKey: true });
      expect(listed()).toEqual(["#design", "#general", "#random", "#ops"]);

      fireEvent.pointerUp(window);
      await act(async () => {});
      expect(sent()).toEqual([["/api/sidebar/order", "PUT", { roomIds: ["design", "general", "random"] }]]);
    });

    it("lets go of a row that moves 8px before the hold ends, a click, an unstarred row, and a lone starred one", () => {
      const { onSelect, rerender } = renderSidebar({ rooms: team, favorites: stars });
      fireEvent.pointerDown(row("general"), { pointerType: "mouse", button: 0, clientX: 20, clientY: 18 });
      fireEvent.pointerMove(window, { pointerType: "mouse", clientX: 20, clientY: 27 });
      act(() => vi.advanceTimersByTime(400));
      expect(status()).toBeEmptyDOMElement();

      fireEvent.pointerDown(row("general"), { pointerType: "mouse", button: 0, clientX: 20, clientY: 18 });
      fireEvent.pointerUp(window);
      fireEvent.click(row("general"));
      expect(onSelect).toHaveBeenCalledWith("general");
      act(() => vi.advanceTimersByTime(400));
      expect(status()).toBeEmptyDOMElement();

      hold("ops");
      expect(status()).toBeEmptyDOMElement();
      rerender({ favorites: { rooms: ["general"], version: 4 } });
      hold("general");
      expect(status()).toBeEmptyDOMElement();
    });

    it("says on screen when an order can't be saved, putting the stars back as they were", async () => {
      vi.mocked(fetch).mockResolvedValue(Response.json({ error: "Those aren't the rooms you've starred" }, { status: 403 }));
      renderSidebar({ rooms: team, favorites: stars });
      hold("design");
      dragTo(0);
      fireEvent.pointerUp(window);
      expect(listed()).toEqual(["#design", "#general", "#random", "#ops"]);

      await act(async () => {});
      expect(listed()).toEqual(["#general", "#random", "#design", "#ops"]);
      expect(status()).toHaveTextContent("Couldn’t save room order. Please try again.");
      expect(status()).toHaveClass("mx-[9px]", "my-1", "text-xs", "leading-normal", "text-negative", "wrap-anywhere");
      expect(status()).not.toHaveClass("sr-only");
    });

    it("signs out when the session has expired", async () => {
      vi.mocked(fetch).mockResolvedValue(Response.json({ error: "Not signed in" }, { status: 401 }));
      const { onSessionChanged } = renderSidebar({ rooms: team, favorites: stars });
      hold("design");
      dragTo(0);
      fireEvent.pointerUp(window);
      await act(async () => {});
      expect(onSessionChanged).toHaveBeenCalledWith(null);
    });

    it("drags with a finger held 400ms, which until then scrolls the list as usual", () => {
      renderSidebar({ rooms: team, favorites: stars });
      const touchmove = () => fireEvent.touchMove(window, { touches: [{ clientX: 20, clientY: 0 }] });
      fireEvent.touchStart(row("design"), { touches: [{ clientX: 20, clientY: 2 * 36 + 18 }] });
      // A tap goes to the row as usual, and a pointer's events from the finger change nothing.
      fireEvent.pointerDown(row("design"), { pointerType: "touch", button: 0, clientX: 20, clientY: 2 * 36 + 18 });
      act(() => vi.advanceTimersByTime(400));
      expect(status()).toHaveTextContent("Moving design.");
      expect(touchmove()).toBe(false); // prevented, so the page doesn't scroll
      expect(listed()).toEqual(["#design", "#general", "#random", "#ops"]);
      fireEvent.touchCancel(window);
      expect(listed()).toEqual(["#general", "#random", "#design", "#ops"]);
      expect(status()).toHaveTextContent("Room move canceled.");
    });
  });
});

describe(feature("sidebar.refresh-preserves-state"), () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => vi.useRealTimers());

  it("keeps a drag going through a reload of the list, but ends it when the stars have changed elsewhere", () => {
    const stars: Favorites = { rooms: ["general", "random"], version: 2 };
    const more: SidebarRoom[] = [...rooms, { id: "design", name: "design", kind: "open", icon: null, unread: true }];
    const { rerender } = renderSidebar({ favorites: stars });
    fireEvent.pointerDown(row("random"), { pointerType: "mouse", button: 0, clientX: 20, clientY: 54 });
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole("status")).toHaveTextContent("Moving random.");

    rerender({ rooms: more, favorites: { ...stars } });
    expect(row("random")).toHaveClass("cursor-grabbing");
    rerender({ rooms: more, favorites: { rooms: ["random"], version: 3 } });
    expect(row("random")).not.toHaveClass("cursor-grabbing");
    expect(screen.getByRole("status")).toHaveTextContent("Room move canceled.");
    fireEvent.pointerUp(window);
    expect(fetch).not.toHaveBeenCalled();
  });
});
