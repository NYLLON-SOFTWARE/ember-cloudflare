import type { Account, DirectoryUser, Favorites, LiveHuddle, SidebarRoom, User } from "@ember/protocol";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "@/hooks/use-account";
import { PeopleContext } from "@/hooks/use-directory";
import { Sidebar } from "./sidebar";

const rooms = [
  { id: "general", name: "general", kind: "open" as const, icon: null, unread: false, involvement: "mentions" as const },
  { id: "random", name: "random", kind: "open" as const, icon: null, unread: false, involvement: "mentions" as const },
];
const unstarred: Favorites = { rooms: [], version: 0 };
const HELP = "Hold a starred room to drag it, or press Alt and the up or down arrow to reorder your favorites. Other rooms follow the workspace order.";

type Props = ComponentProps<typeof Sidebar>;

/** The workspace, as it's set up. */
const EMBER: Account = { name: "Ember", tagline: "", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null, joinLink: true, openSignUp: false, memberfulJoin: false, memberfulSignIn: false, emailDomainSignUp: false, emailDomains: [], navigationIcons: {}, huddles: false };

/**
 * The sidebar, with `props` in place of an unstarred one listing `rooms` with none open, in `account`'s
 * workspace, with the people directory listing `people`.
 */
function renderSidebar(props: Partial<Props> = {}, account = EMBER, people: readonly DirectoryUser[] = []) {
  const all: Props = {
    workspaceName: "Ember",
    meId: "u1",
    rooms,
    favorites: unstarred,
    sharedOrder: [],
    huddles: {},
    loaded: true,
    currentRoomId: null,
    currentPage: null,
    draftCount: 0,
    unreadOnly: false,
    onSelect: vi.fn(),
    onStarred: vi.fn(),
    onSessionChanged: vi.fn(),
    ...props,
  };
  const listed = new Map(people.map((person) => [person.id, person]));
  const sidebar = (changes: Partial<Props>, shown: Account) => (
    <PeopleContext value={listed}>
      <AccountContext value={shown}>
        <Sidebar {...all} {...changes} />
      </AccountContext>
    </PeopleContext>
  );
  const view = render(sidebar({}, account));
  return { ...view, ...all, rerender: (changes: Partial<Props>, changed = account) => view.rerender(sidebar(changes, changed)) };
}

const [ada, grace, linus, alan]: User[] = ["Ada", "Grace", "Linus", "Alan"].map((name, i) => ({ id: `u${i + 1}`, name }));
/** A time on 15 October 2026, `minutes` past noon UTC. */
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 15, 12, minutes)).toISOString();
/** A DM between `members`, as the list has it for Ada, who's always in it. */
const direct = (id: string, members: User[], unread = false): SidebarRoom => ({ id, kind: "direct", members, activeAt: new Date(0).toISOString(), unread, involvement: "everything" });

/** The room rows, top to bottom: the starred ones, then the rest. */
const rows = () => screen.queryAllByRole("region", { name: /^(Starred|Rooms)$/ }).flatMap((region) => within(region).queryAllByRole("link"));
const listed = () => rows().map((row) => row.textContent);
const row = (name: string) => rows().find((link) => link.textContent === `#${name}`)!;

afterEach(() => vi.restoreAllMocks());

describe("Workspace name", () => {
  it("heads the list with the workspace's name alone, leaving out its tagline", () => {
    const tagline = "Engines for every occasion";
    renderSidebar({ workspaceName: "Analytical Engines" }, { ...EMBER, tagline });
    // Clear of the drawer's close button.
    expect(screen.getByRole("heading", { level: 2, name: "Analytical Engines" })).toHaveClass("max-md:pr-10");
    // It starts where the rows' icons and the sections' carets do, 9px in.
    expect(screen.getByRole("heading", { level: 2, name: "Analytical Engines" })).toHaveClass("px-[9px]");
    expect(screen.getByRole("link", { name: "Threads" })).toHaveClass("px-[9px]");
    expect(screen.getByRole("button", { name: "Rooms" })).toHaveClass("px-[9px]");
    expect(screen.queryByText(tagline)).not.toBeInTheDocument();
  });
});

describe("Conversations sidebar", () => {
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

describe("Room icons", () => {
  it("shows each room's icon before its name, or `#`", () => {
    renderSidebar({ rooms: [{ ...rooms[0]!, icon: "coffee" }, rooms[1]!], currentRoomId: "general" });
    const [coffee, random] = rows();
    expect(coffee).toHaveAccessibleName("general");
    expect(coffee!.querySelector('[data-icon="coffee"]')).toHaveStyle({ width: "19px", height: "19px" });
    expect(random).toHaveTextContent("#random");
  });

  it("shows a lock before a private room's name in place of `#`, but its own icon when it has one", () => {
    const secret = { id: "secret", name: "secret", kind: "closed" as const, icon: null, unread: false, involvement: "mentions" as const };
    renderSidebar({ rooms: [secret, { ...secret, id: "vault", name: "vault", icon: "coffee" }] });
    expect(row("secret")).toBeUndefined();
    const [locked, vault] = rows();
    expect(locked).toHaveTextContent(/^secret$/);
    expect(locked).toHaveAccessibleName("secret");
    expect(locked!.querySelector("svg")).toHaveClass("iconoir-lock");
    expect(vault!.querySelector('[data-icon="coffee"]')).toBeInTheDocument();
    expect(vault!.querySelector(".iconoir-lock")).toBeNull();
  });
});

describe("Unread rooms", () => {
  it("counts an unread room's messages in a pill in place of its dot, up to 9+, saying how many to screen readers", () => {
    const { rerender } = renderSidebar({ rooms: [{ ...rooms[0]!, unread: true, unreadCount: 3 }, { ...rooms[1]!, unread: true, unreadCount: 10 }] });
    const [general, random] = rows();
    expect(general).toHaveClass("font-bold");
    expect(general).toHaveAccessibleName("general");
    expect(general).toHaveAccessibleDescription(`3 unread ${HELP}`);
    expect(general!.lastElementChild).toHaveTextContent(/^3$/);
    expect(general!.lastElementChild).toHaveAttribute("aria-hidden", "true");
    expect(general!.lastElementChild).toHaveClass("ml-auto", "rounded-full", "bg-muted-foreground/25", "text-foreground");
    expect(general!.querySelector(".size-\\[7px\\]")).toBeNull();
    expect(random!.lastElementChild).toHaveTextContent(/^9\+$/);
    expect(random).toHaveAccessibleDescription(`9+ unread ${HELP}`);

    // The room the tab shows is never marked, whatever it counted.
    rerender({ currentRoomId: "general" });
    expect(row("general").querySelector(".rounded-full")).toBeNull();
  });

  it("keeps a room followed not at all grey, without bold or a dot, until a message mentions you, which its pill counts", () => {
    const muted = { ...rooms[0]!, involvement: "nothing" as const, unread: true };
    const { rerender } = renderSidebar({ rooms: [muted, rooms[1]!] });
    expect(row("general")).toHaveClass("text-muted-foreground");
    expect(row("general")).not.toHaveClass("font-bold");
    expect(row("general").querySelector(".rounded-full")).toBeNull();
    expect(row("general")).toHaveAccessibleDescription(HELP);

    rerender({ rooms: [{ ...muted, unreadCount: 1, unreadMentioned: true }, rooms[1]!] });
    expect(rows()[0]).toHaveClass("font-bold");
    expect(rows()[0]!.lastElementChild).toHaveTextContent(/^1$/);
    expect(rows()[0]!.lastElementChild).toHaveClass("bg-foreground");
  });

  it("draws the pill strong, in ink, where a message it counts mentions you, and says so", () => {
    renderSidebar({ rooms: [{ ...rooms[0]!, unread: true, unreadCount: 2, unreadMentioned: true }, rooms[1]!] });
    const [general] = rows();
    expect(general!.lastElementChild).toHaveClass("bg-foreground", "text-background");
    expect(general!.lastElementChild).not.toHaveClass("bg-muted-foreground/25");
    expect(general).toHaveAccessibleDescription(`2 unread, mentioning you ${HELP}`);
  });

  it("makes an unread room's row bold, with a dot, and says so to screen readers", () => {
    renderSidebar({ rooms: [{ ...rooms[0]!, unread: true }, rooms[1]!] });
    const [general, random] = rows();
    expect(general).toHaveClass("font-bold");
    expect(general).toHaveAccessibleName("general");
    expect(general).toHaveAccessibleDescription(`Unread ${HELP}`);
    expect(general!.lastElementChild).toHaveAttribute("aria-hidden", "true");
    expect(general!.lastElementChild).toHaveClass("ml-auto", "size-[7px]", "rounded-full", "bg-muted-foreground");

    expect(random).not.toHaveClass("font-bold");
    expect(random).toHaveAccessibleDescription(HELP);
    expect(random!.querySelector(".rounded-full")).toBeNull();
  });

  it("never marks the room the tab shows", () => {
    renderSidebar({ rooms: [{ ...rooms[0]!, unread: true }, rooms[1]!], currentRoomId: "general" });
    const general = screen.getByRole("link", { current: "page" });
    expect(general).not.toHaveClass("font-bold");
    expect(general).toHaveAccessibleDescription(HELP);
    expect(general.querySelector(".rounded-full")).toBeNull();
  });
});

describe("Activity filter", () => {
  const marked = [{ ...rooms[0]!, unread: true }, rooms[1]!, { id: "design", name: "design", kind: "open" as const, icon: null, unread: true, involvement: "mentions" as const }];

  it("shows only the rows marked unread", () => {
    const { rerender } = renderSidebar({ rooms: marked, unreadOnly: true });
    expect(listed()).toEqual(["#design", "#general"]);
    expect(screen.queryByText("You’re all caught up. No unread rooms.")).not.toBeInTheDocument();

    rerender({ unreadOnly: false });
    expect(listed()).toEqual(["#design", "#general", "#random"]);
  });

  it("leaves out the room the tab shows, which is never marked", () => {
    renderSidebar({ rooms: marked, currentRoomId: "general", unreadOnly: true });
    expect(listed()).toEqual(["#design"]);
  });

  it("says everything's read when nothing is marked", () => {
    renderSidebar({ currentRoomId: "general", unreadOnly: true });
    expect(listed()).toEqual([]);
    expect(screen.getByText("You’re all caught up. No unread rooms.")).toHaveClass("text-[13px]", "text-muted-foreground");
  });
});

describe("Room order", () => {
  it("lists your starred rooms first, in the order you starred them, then the rest by name", () => {
    const more = [...rooms, { id: "design", name: "Design", kind: "open" as const, icon: null, unread: false, involvement: "mentions" as const }, { id: "ops", name: "ops", kind: "open" as const, icon: null, unread: false, involvement: "mentions" as const }];
    renderSidebar({ rooms: more, favorites: { rooms: ["random", "ops"], version: 2 } });
    expect(listed()).toEqual(["#random", "#ops", "#Design", "#general"]);
  });
});

describe("Shared room order", () => {
  it("lists the rooms the shared order ranks after your stars, in its order, then the rest by name", () => {
    const more = [...rooms, { id: "design", name: "Design", kind: "open" as const, icon: null, unread: false, involvement: "mentions" as const }, { id: "ops", name: "ops", kind: "open" as const, icon: null, unread: false, involvement: "mentions" as const }];
    renderSidebar({ rooms: more, favorites: { rooms: ["ops"], version: 1 }, sharedOrder: ["random", "ops", "gone", "general"] });
    expect(listed()).toEqual(["#ops", "#random", "#general", "#Design"]);
  });

  it("moves only the starred rows, which stay above the rest", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ favorites: { rooms: ["general"], version: 2 } }));
    renderSidebar({ favorites: { rooms: ["general"], version: 1 }, sharedOrder: ["random", "general"] });
    expect(listed()).toEqual(["#general", "#random"]);
    for (const [name, key] of [["random", "ArrowUp"], ["general", "ArrowDown"]] as const) fireEvent.keyDown(row(name), { key, altKey: true });
    expect(listed()).toEqual(["#general", "#random"]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Star rooms", () => {
  it("draws a starred room's row with no star of its own, which Starred already says, nor a grip", () => {
    renderSidebar({ rooms: [rooms[0]!, { ...rooms[1]!, unread: true }], favorites: { rooms: ["general", "random"], version: 2 } });
    const [general, random] = rows();
    expect(general!.querySelectorAll("svg")).toHaveLength(0);
    expect(general!.lastElementChild).toHaveTextContent(/^general$/);
    expect(within(general!).queryByRole("img")).not.toBeInTheDocument();
    // An unread one ends with its dot.
    expect(random!.lastElementChild).toHaveClass("ml-auto", "rounded-full");
  });
});

describe("Selected room", () => {
  it("fills the room the tab shows, without making it bold, which only unread rows are", () => {
    renderSidebar({ currentRoomId: "general" });
    expect(row("general")).toHaveClass("aria-[current=page]:bg-hover");
    expect(row("general").className).not.toMatch(/font-semibold|font-bold/);
  });
});

describe("Folding sections", () => {
  beforeEach(() => localStorage.clear());
  const more = [...rooms, { id: "design", name: "design", kind: "open" as const, icon: null, unread: true, involvement: "mentions" as const }, { id: "ops", name: "ops", kind: "open" as const, icon: null, unread: false, involvement: "mentions" as const }];
  const stars: Favorites = { rooms: ["general", "ops"], version: 2 };

  it("folds Starred and Rooms under their headings, with a caret before each, leaving the room shown and the unread ones", async () => {
    renderSidebar({ rooms: more, favorites: stars, currentRoomId: "random" });
    expect(listed()).toEqual(["#general", "#ops", "#design", "#random"]);
    const starred = screen.getByRole("button", { name: "Starred" });
    expect(starred).toHaveAttribute("aria-expanded", "true");
    expect(starred.closest("h3")).toBeInTheDocument();
    expect(starred.firstElementChild).toHaveClass("iconoir-nav-arrow-down", "size-3");

    await userEvent.click(starred);
    expect(starred).toHaveAttribute("aria-expanded", "false");
    expect(starred.firstElementChild).toHaveClass("-rotate-90");
    expect(listed()).toEqual(["#design", "#random"]);

    await userEvent.click(screen.getByRole("button", { name: "Rooms" }));
    expect(listed()).toEqual(["#design", "#random"]);
    await userEvent.click(starred);
    expect(listed()).toEqual(["#general", "#ops", "#design", "#random"]);
  });

  it("remembers in this browser which sections are folded", async () => {
    const { unmount } = renderSidebar({ rooms: more, favorites: stars });
    await userEvent.click(screen.getByRole("button", { name: "Rooms" }));
    unmount();
    renderSidebar({ rooms: more, favorites: stars });
    expect(screen.getByRole("button", { name: "Rooms" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Starred" })).toHaveAttribute("aria-expanded", "true");
    expect(listed()).toEqual(["#general", "#ops", "#design"]);
  });
});

describe("Rooms with a huddle", () => {
  /** Someone as the people directory lists them. */
  const inDirectory = (user: User): DirectoryUser => ({ ...user, bio: null, role: "member", status: "active", avatarUrl: `/users/${user.id}/avatar` });
  const everyone = [ada!, grace!, linus!, alan!].map(inDirectory);
  /** A huddle with those people in it, in the order they joined. */
  const huddleOf = (...people: User[]): LiveHuddle => ({ startedAt: at(0), userIds: people.map(({ id }) => id) });
  /** What a room's row ends with while a huddle is going on in it. */
  const mark = (row: HTMLElement) => row.querySelector<HTMLElement>("[title]");
  const faces = (row: HTMLElement) => [...mark(row)!.querySelectorAll("img")].map((face) => face.getAttribute("src"));

  it("ends the row with the faces of the first two people in it, the headphones and how many are in it, in green", () => {
    renderSidebar({ huddles: { general: huddleOf(grace!, linus!, alan!) } }, EMBER, everyone);
    const [general, random] = rows();
    // Nothing shows after it: the words that follow it are hidden.
    expect(mark(general!)!.nextElementSibling).toBe(general!.lastElementChild);
    expect(general!.lastElementChild).not.toBeVisible();
    expect(mark(general!)).toHaveClass("ml-auto", "shrink-0", "text-positive");
    expect(faces(general!)).toEqual(["/users/u2/avatar", "/users/u3/avatar"]);
    for (const face of mark(general!)!.querySelectorAll("img")) expect(face).toHaveClass("size-4", "rounded-full", "ring-1", "ring-surface");
    expect(mark(general!)!.querySelector("svg")).toHaveClass("iconoir-headset", "size-3.5");
    expect(within(mark(general!)!).getByText("3")).toHaveClass("tabular-nums");

    expect(mark(random!)).toBeNull();
    expect(random!.querySelector("svg")).toBeNull();
  });

  it("says who's in it under a pointer, and to screen readers as the row's description, calling you you", () => {
    const { rerender } = renderSidebar({ huddles: { general: huddleOf(grace!, linus!) } }, EMBER, everyone);
    const general = () => rows()[0]!;
    expect(mark(general())).toHaveAttribute("title", "Grace and Linus are in the huddle");
    // The mark is the eye's, and the row keeps its room's name.
    expect(mark(general())).toHaveAttribute("aria-hidden", "true");
    expect(general()).toHaveAccessibleName("general");
    expect(general()).toHaveAccessibleDescription(`Grace and Linus are in the huddle ${HELP}`);
    expect(rows()[1]).toHaveAccessibleDescription(HELP);

    rerender({ huddles: { general: huddleOf(grace!, ada!) } });
    expect(mark(general())).toHaveAttribute("title", "Grace and you are in the huddle");
    expect(general()).toHaveAccessibleDescription(`Grace and you are in the huddle ${HELP}`);
    expect(faces(general())).toEqual(["/users/u2/avatar", "/users/u1/avatar"]);

    rerender({ huddles: { general: huddleOf(ada!) } });
    expect(mark(general())).toHaveAttribute("title", "Just you in the huddle");
    expect(within(mark(general())!).getByText("1")).toBeInTheDocument();
  });

  it("counts the people the directory doesn't list, whose faces it can't show", () => {
    const { rerender } = renderSidebar({ huddles: { general: huddleOf(linus!, grace!, alan!) } }, EMBER, [inDirectory(grace!)]);
    const general = () => rows()[0]!;
    expect(mark(general())).toHaveAttribute("title", "Grace and 2 others are in the huddle");
    expect(faces(general())).toEqual(["/users/u2/avatar"]);
    expect(within(mark(general())!).getByText("3")).toBeInTheDocument();

    // With you in it, everyone is counted.
    rerender({ huddles: { general: huddleOf(linus!, ada!) } });
    expect(mark(general())).toHaveAttribute("title", "2 people are in the huddle");
    expect(faces(general())).toEqual([]);
  });

  it("comes before the row's unread dot, and takes the space before it", () => {
    renderSidebar({ rooms: [{ ...rooms[0]!, unread: true }, rooms[1]!], huddles: { general: huddleOf(grace!), random: huddleOf(linus!) } }, EMBER, everyone);
    const [general, random] = rows();
    const [first, words, dot] = Array.from(general!.children).slice(-3);
    expect(first).toBe(mark(general!));
    expect(first).toHaveClass("ml-auto");
    expect(words).not.toBeVisible();
    expect(dot).toHaveClass("size-[7px]", "rounded-full");
    expect(dot).not.toHaveClass("ml-auto");
    expect(general).toHaveAccessibleDescription(`Grace is in the huddle Unread ${HELP}`);

    const [its] = Array.from(random!.children).slice(-2);
    expect(its).toBe(mark(random!));
    expect(its).toHaveClass("ml-auto");
  });

  it("follows the huddle as people join and leave it, and goes when it ends", () => {
    const { rerender } = renderSidebar({ huddles: { random: huddleOf(grace!) } }, EMBER, everyone);
    const random = () => rows()[1]!;
    /** How many it says are in it, and who under a pointer. */
    const says = () => [mark(random())!.textContent, mark(random())!.title];
    expect(says()).toEqual(["1", "Grace is in the huddle"]);

    rerender({ huddles: { random: huddleOf(grace!, linus!, alan!) } });
    expect(says()).toEqual(["3", "Grace, Linus, and Alan are in the huddle"]);
    rerender({ huddles: { random: huddleOf(linus!) } });
    expect(says()).toEqual(["1", "Linus is in the huddle"]);
    expect(faces(random())).toEqual(["/users/u3/avatar"]);

    // The row is as it was, its words gone with its mark.
    rerender({ huddles: {} });
    expect(mark(random())).toBeNull();
    expect(random()).toHaveAccessibleDescription(HELP);
    expect(listed()).toEqual(["#general", "#random"]);
  });
});

describe("Reorder starred rooms", () => {
  const team = [...rooms, { id: "design", name: "design", kind: "open" as const, icon: null, unread: false, involvement: "mentions" as const }, { id: "ops", name: "ops", kind: "open" as const, icon: null, unread: false, involvement: "mentions" as const }];
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

describe("Background sidebar reloads keep your place", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => vi.useRealTimers());

  it("keeps a drag going through a reload of the list, but ends it when the stars have changed elsewhere", () => {
    const stars: Favorites = { rooms: ["general", "random"], version: 2 };
    const more: SidebarRoom[] = [...rooms, { id: "design", name: "design", kind: "open", icon: null, unread: true, involvement: "mentions" }];
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

describe("Hide a room", () => {
  it("leaves out the rooms you've hidden, even the one open", () => {
    const hidden = { id: "design", name: "design", kind: "open" as const, icon: null, unread: true, involvement: "invisible" as const };
    renderSidebar({ rooms: [...rooms, hidden], currentRoomId: "design" });
    expect(listed()).toEqual(["#general", "#random"]);
  });
});

describe("Home sidebar", () => {
  it("lists rooms only, never DMs, which the DMs page lists", () => {
    renderSidebar({ rooms: [...rooms, direct("d1", [ada!, grace!], true)] });
    expect(listed()).toEqual(["#general", "#random"]);
    expect(screen.queryByRole("link", { name: /Direct message with/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "DMs" })).not.toBeInTheDocument();
  });

  it("counts the drafts at the end of Drafts & sent, and nothing at none", () => {
    const { rerender } = renderSidebar({ draftCount: 3 });
    const drafts = screen.getByRole("link", { name: "Drafts & sent" });
    expect(drafts).toHaveAccessibleDescription("3 drafts");
    expect(drafts.lastElementChild).toHaveTextContent("3");
    expect(drafts.lastElementChild).toHaveAttribute("aria-hidden", "true");
    rerender({ draftCount: 0 });
    expect(drafts).toHaveTextContent(/^Drafts & sent$/);
    expect(drafts).not.toHaveAttribute("aria-description");
  });

  it("links to Threads, Drafts & sent and People above the rooms, marking the one shown", () => {
    const { rerender } = renderSidebar();
    const links = within(screen.getByRole("navigation", { name: "Home" })).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
      ["Threads", "/threads", null],
      ["Drafts & sent", "/drafts", null],
      ["People", "/people", null],
    ]);
    expect(links[0]!.compareDocumentPosition(rows()[0]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    rerender({ currentPage: "drafts" });
    expect(screen.getByRole("link", { name: "Drafts & sent" })).toHaveAttribute("aria-current", "page");
  });

  it("moves starred rooms under Starred, above Rooms, which lists the rest, and has no Starred without a star", () => {
    const { rerender } = renderSidebar({ favorites: { rooms: ["random"], version: 1 } });
    expect(within(screen.getByRole("region", { name: "Starred" })).getAllByRole("link").map((link) => link.textContent)).toEqual(["#random"]);
    expect(within(screen.getByRole("region", { name: "Rooms" })).getAllByRole("link").map((link) => link.textContent)).toEqual(["#general"]);
    rerender({ favorites: { rooms: [], version: 2 } });
    expect(screen.queryByRole("region", { name: "Starred" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Rooms" })).getAllByRole("link")).toHaveLength(2);
  });
});
