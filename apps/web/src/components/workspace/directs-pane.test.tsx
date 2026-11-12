import type { DirectoryUser, DirectPreview, Message, SidebarRoom, User } from "@ember/protocol";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeopleContext } from "@/hooks/use-directory";
import { guardLeaving } from "@/hooks/use-route";
import { DirectsPane } from "./directs-pane";

type Props = ComponentProps<typeof DirectsPane>;

const [ada, grace, linus, alan, edsger, barbara]: User[] = ["Ada", "Grace", "Linus", "Alan", "Edsger", "Barbara"].map((name, i) => ({ id: `u${i + 1}`, name }));
const general: SidebarRoom = { id: "general", name: "general", kind: "open", icon: null, unread: false, involvement: "mentions" };
/** `minutes` past noon, on the day these tests take place. */
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 15, 12, minutes)).toISOString();
/** A DM between `members`, as the list shows it to Ada, who's always in it, last active `activeAt`. */
const direct = (id: string, members: User[], unread = false, activeAt = at(0)): SidebarRoom => ({ id, kind: "direct", members, activeAt, unread, involvement: "everything" });
/** A message `creator` wrote in DM `roomId`. */
const message = (roomId: string, creator: User, plainText: string, createdAt = at(5)): Message => ({
  id: `${roomId}-${plainText}`,
  clientMessageId: `${roomId}-${plainText}`,
  roomId,
  creator,
  body: `<p>${plainText}</p>`,
  plainText,
  mentions: [],
  createdAt,
  updatedAt: createdAt,
  editedAt: null,
  boosts: [],
});
/** An AI agent, as the people directory lists it. */
const agent = (id: string, name: string): DirectoryUser => ({ id, name, bio: null, role: "bot", status: "active", avatarUrl: `/users/${id}/avatar`, agent: true });

/** The list as Ada sees it, with `props` in place of an empty one's, the people directory listing `people`. */
function renderPane(props: Partial<Props> = {}, people: readonly DirectoryUser[] = []) {
  const all: Props = {
    meId: ada!.id,
    rooms: [],
    loaded: true,
    previews: new Map(),
    suggestions: [],
    currentRoomId: null,
    unreadOnly: false,
    onSelect: vi.fn(),
    onNewDirect: vi.fn(),
    onStartDirect: vi.fn(async () => true),
    ...props,
  };
  const listed = new Map(people.map((person) => [person.id, person]));
  const pane = (changes: Partial<Props>) => (
    <PeopleContext value={listed}>
      <DirectsPane {...all} {...changes} />
    </PeopleContext>
  );
  const view = render(pane({}));
  return { ...view, ...all, rerender: (changes: Partial<Props>) => view.rerender(pane(changes)) };
}

const list = () => screen.getByRole("region", { name: "Direct messages" });
/** The DM rows, top to bottom. */
const directRows = () => within(list()).queryAllByRole("link", { name: /^Direct message with / });
/** The rows suggesting people to start a DM with, top to bottom. */
const suggestionRows = () => within(list()).queryAllByRole("button", { name: /^Start a direct message with / });

afterEach(() => vi.restoreAllMocks());

describe("DMs page", () => {
  it("heads the list with Direct messages, Unreads, New direct message and Find a DM…", () => {
    renderPane();
    expect(screen.getByRole("heading", { level: 2, name: "Direct messages" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Unreads" })).not.toBeChecked();
    expect(screen.getByRole("link", { name: "New direct message" })).toHaveAttribute("href", "/rooms/directs/new");
    expect(screen.getByRole("searchbox", { name: "Find a DM" })).toHaveAttribute("placeholder", "Find a DM…");
  });

  it("lists only DMs, latest active first, naming the others in each, or you in your DM with yourself", () => {
    renderPane({ rooms: [general, direct("d2", [ada!, grace!, linus!], false, at(2)), direct("d1", [ada!, grace!], false, at(3)), direct("d3", [ada!], false, at(1))] });
    expect(directRows()).toHaveLength(3);
    expect(directRows().map((row) => row.getAttribute("href"))).toEqual(["/dms/d1", "/dms/d2", "/dms/d3"]);
    expect(directRows()[0]).toHaveAccessibleName("Direct message with Grace");
    expect(directRows()[1]).toHaveAccessibleName("Direct message with Grace, Linus");
    expect(directRows()[2]).toHaveAccessibleName("Direct message with Ada (you)");
  });

  it("shows the other person's avatar at 36px, or up to four of a group's", () => {
    renderPane({ rooms: [direct("d1", [ada!, grace!], false, at(2)), direct("d2", [ada!, grace!, linus!, alan!, edsger!, barbara!], false, at(1))] });
    const [one, group] = directRows();
    expect([...one!.querySelectorAll("img")].map((img) => img.getAttribute("class"))).toEqual([expect.stringContaining("size-9")]);
    const faces = [...group!.querySelectorAll("img")];
    expect(faces).toHaveLength(4);
    expect(faces[0]!.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(faces[0]!.parentElement).toHaveClass("size-9", "grid-cols-2");
  });

  it("badges a DM with an AI agent alone after its name, but not a group DM it's in, nor one with another bot", () => {
    const recap = agent("u8", "Recap");
    const bot: DirectoryUser = { id: "u9", name: "Build Bot", bio: null, role: "bot", status: "active", avatarUrl: "/users/u9/avatar" };
    renderPane({ rooms: [direct("d1", [ada!, recap], false, at(3)), direct("d2", [ada!, recap, grace!], false, at(2)), direct("d3", [ada!, bot], false, at(1))] }, [recap, bot]);
    const [alone, group, withBot] = directRows();
    expect(alone).toHaveAccessibleName("Direct message with Recap Agent");
    expect(within(alone!).getByText("Agent")).toHaveAttribute("data-slot", "badge");
    expect(group).toHaveAccessibleName("Direct message with Recap, Grace");
    expect(withBot).toHaveAccessibleName("Direct message with Build Bot");
  });

  it("shows each DM's latest message, yours as You:, and the writer's name first in a group, with when it came", () => {
    const today = new Date().toISOString();
    const rooms = [direct("d1", [ada!, grace!], false, at(3)), direct("d2", [ada!, grace!, linus!], false, at(2)), direct("d3", [ada!, linus!], false, at(1))];
    const previews = new Map<string, DirectPreview>([
      ["d1", { roomId: "d1", latest: message("d1", grace!, "see you   at\nnoon", today), unread: 0 }],
      ["d2", { roomId: "d2", latest: message("d2", linus!, "pushed the fix", today), unread: 0 }],
      ["d3", { roomId: "d3", latest: message("d3", ada!, "thanks", today), unread: 0 }],
    ]);
    renderPane({ rooms, previews });
    const [withGrace, group, withLinus] = directRows();
    expect(within(withGrace!).getByText("see you at noon")).toHaveClass("line-clamp-2", "text-muted-foreground");
    expect(within(group!).getByText("Linus: pushed the fix")).toBeInTheDocument();
    expect(within(withLinus!).getByText("You: thanks")).toBeInTheDocument();
    expect(withGrace!.querySelector("time")).toHaveAttribute("dateTime", today);
    expect(withGrace).toHaveAccessibleDescription(expect.stringContaining("see you at noon"));
  });

  it("makes an unread DM's row bold with how many are unread, or a dot until that's known, and says so to screen readers", () => {
    const rooms = [direct("d1", [ada!, grace!], true, at(3)), direct("d2", [ada!, linus!], true, at(2)), direct("d3", [ada!, alan!], false, at(1))];
    const previews = new Map<string, DirectPreview>([["d1", { roomId: "d1", latest: message("d1", grace!, "ping"), unread: 12 }]]);
    const { rerender } = renderPane({ rooms, previews });
    const [counted, dotted, read] = directRows();
    expect(within(counted!).getByText("9+")).toHaveClass("rounded-full", "bg-foreground");
    expect(counted).toHaveAccessibleDescription(expect.stringMatching(/^Unread 9\+ unread, /));
    expect(screen.getByText("Direct message with", { selector: `#${CSS.escape(counted!.getAttribute("aria-labelledby")!)} > *` }).parentElement).toHaveClass("font-[750]");
    expect(dotted!.querySelector(".size-\\[7px\\]")).toHaveClass("rounded-full", "bg-foreground");
    expect(dotted).toHaveAccessibleDescription(expect.stringMatching(/^Unread /));
    expect(read!.querySelector(".rounded-full.bg-foreground")).toBeNull();

    rerender({ currentRoomId: "d1" });
    expect(within(directRows()[0]!).queryByText("9+")).not.toBeInTheDocument();
  });

  it("marks the DM shown, and opens one in place, but leaves modified clicks to the browser", async () => {
    const { onSelect } = renderPane({ rooms: [direct("d1", [ada!, grace!], false, at(2)), direct("d2", [ada!, linus!], false, at(1))], currentRoomId: "d2" });
    expect(directRows().map((row) => row.getAttribute("aria-current"))).toEqual([null, "page"]);
    await userEvent.click(directRows()[0]!);
    expect(onSelect).toHaveBeenCalledWith("d1");
    expect(fireEvent.click(directRows()[0]!, { metaKey: true })).toBe(true);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("shows only the DMs marked unread with Unreads, or Activity, on", async () => {
    const rooms = [direct("d1", [ada!, grace!], true, at(2)), direct("d2", [ada!, linus!], false, at(1))];
    const { rerender } = renderPane({ rooms, suggestions: [alan!] });
    await userEvent.click(screen.getByRole("switch", { name: "Unreads" }));
    expect(directRows().map((row) => row.getAttribute("href"))).toEqual(["/dms/d1"]);
    expect(suggestionRows()).toEqual([]);
    await userEvent.click(screen.getByRole("switch", { name: "Unreads" }));
    expect(directRows()).toHaveLength(2);

    rerender({ unreadOnly: true });
    expect(screen.getByRole("switch", { name: "Unreads" })).toBeChecked();
    expect(directRows()).toHaveLength(1);
    rerender({ unreadOnly: true, currentRoomId: "d1" });
    expect(screen.getByText("You’re all caught up. No unread direct messages.")).toBeInTheDocument();
  });

  it("finds DMs by anyone's name in them, whatever its case", async () => {
    renderPane({ rooms: [direct("d1", [ada!, grace!], false, at(2)), direct("d2", [ada!, linus!, grace!], false, at(1)), direct("d3", [ada!, alan!])] });
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a DM" }), "GRA");
    expect(directRows().map((row) => row.getAttribute("href"))).toEqual(["/dms/d1", "/dms/d2"]);
    await userEvent.clear(screen.getByRole("searchbox", { name: "Find a DM" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a DM" }), "nobody");
    expect(directRows()).toEqual([]);
    expect(screen.getByText("No DMs with anyone by that name.")).toBeInTheDocument();
  });

  it("leaves out the DMs you've hidden", () => {
    const hidden: SidebarRoom = { ...direct("d2", [ada!, linus!], true), involvement: "invisible" };
    renderPane({ rooms: [direct("d1", [ada!, grace!]), hidden] });
    expect(directRows().map((row) => row.getAttribute("href"))).toEqual(["/dms/d1"]);
  });

  it("opens New direct message in place, which a click with a modifier key leaves to the browser", async () => {
    const { onNewDirect } = renderPane();
    const link = screen.getByRole("link", { name: "New direct message" });
    await userEvent.click(link);
    expect(onNewDirect).toHaveBeenCalledExactlyOnceWith(link);
    expect(fireEvent.click(link, { shiftKey: true })).toBe(true);
    expect(onNewDirect).toHaveBeenCalledOnce();
  });

  it("says there are no DMs once the list has come with none, nor anyone to suggest", () => {
    const { rerender } = renderPane({ loaded: false });
    expect(screen.queryByText("No direct messages yet.")).not.toBeInTheDocument();
    rerender({ loaded: true });
    expect(screen.getByText("No direct messages yet.")).toBeInTheDocument();
    rerender({ suggestions: [grace!] });
    expect(screen.queryByText("No direct messages yet.")).not.toBeInTheDocument();
  });
});

describe("Suggested people", () => {
  it("suggests people after the DMs, leaving out the people in them", () => {
    renderPane({ rooms: [direct("d1", [ada!, grace!])], suggestions: [grace!, linus!, alan!] });
    expect(suggestionRows().map((row) => row.textContent)).toEqual(["Start a direct message with Linus", "Start a direct message with Alan"]);
    expect(directRows()[0]!.compareDocumentPosition(suggestionRows()[0]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("starts a DM with someone suggested, only once while it starts", async () => {
    let started = (_: boolean) => {};
    const onStartDirect = vi.fn(() => new Promise<boolean>((resolve) => (started = resolve)));
    renderPane({ suggestions: [grace!], onStartDirect });
    const suggestion = suggestionRows()[0]!;
    await userEvent.click(suggestion);
    await userEvent.click(suggestion);
    expect(onStartDirect).toHaveBeenCalledExactlyOnceWith(grace);
    await act(async () => started(false));
    expect(suggestion).not.toHaveAttribute("aria-disabled");
  });

  it("asks before a page with changes to lose is left for the DM, starting it only once the page lets it", async () => {
    let proceed = () => {};
    const release = guardLeaving((_, go) => {
      proceed = () => void go();
      return true;
    });
    try {
      const { onStartDirect } = renderPane({ suggestions: [grace!] });
      await userEvent.click(suggestionRows()[0]!);
      expect(onStartDirect).not.toHaveBeenCalled();
      await act(async () => proceed());
      expect(onStartDirect).toHaveBeenCalledExactlyOnceWith(grace);
    } finally {
      release();
    }
  });
});
