import type { ListedScheduledMessage, Me, Message, Room, ScheduledMessage, SearchResults } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import type { RoomFrames } from "@/hooks/use-room";
import { useScheduled } from "@/hooks/use-scheduled";
import { changeScheduled } from "@/lib/scheduled-actions";
import { DraftsPage, SCHEDULED_DELAY_MS, scheduledLabel } from "./drafts-page";

vi.mock("@/lib/scheduled-actions", () => ({ changeScheduled: vi.fn() }));

const ada: Me = { id: "u1", name: "Ada", administrator: false };
const general: Room = { id: "general", name: "general", kind: "open", icon: null };
const random: Room = { id: "random", name: "random", kind: "open", icon: null };

const sent = (id: string, room: Room, plainText: string, parentId?: string): Message => ({
  id,
  clientMessageId: id,
  roomId: room.id,
  creator: ada,
  body: bodyFromPlainText(plainText),
  plainText,
  mentions: [],
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  editedAt: null,
  boosts: [],
  ...(parentId && { parentId }),
});

function showPage(tab: "drafts" | "scheduled" | "sent") {
  const onFailed = vi.fn();
  render(
    <Sheet>
      <DraftsPage me={ada} tab={tab} rooms={[general, random]} onFailed={onFailed} />
    </Sheet>,
  );
  return { onFailed };
}

/** A room, as its composer hears of it, telling of the messages `messages` you've scheduled there. */
function RoomScheduling({ roomId, messages }: { roomId: string; messages: ScheduledMessage[] }) {
  const frames: RoomFrames = { send: () => true, listen: (hear) => (hear({ type: "scheduled", messages }), () => {}) };
  useScheduled(roomId, frames);
  return null;
}

describe("Drafts & sent", () => {
  it("lists what you've scheduled in every room, as the server lists it, each opening where it's to go, saying when", async () => {
    const soon = new Date(2026, 10, 12, 15, 0).getTime();
    const later = new Date(2026, 10, 20, 9, 30).getTime();
    const messages: ListedScheduledMessage[] = [
      { id: "s1", roomId: "general", sendAt: soon, preview: "for soon" },
      { id: "s3", roomId: "general", sendAt: soon + 1, preview: "stuck", failed: "You left the room" },
      { id: "s2", roomId: "random", sendAt: later, preview: "for later", parentId: "m7" },
      { id: "s4", roomId: "gone", sendAt: later, preview: "in a room I left" },
    ];
    vi.spyOn(globalThis, "fetch").mockClear().mockImplementation(async () => Response.json({ messages }));
    showPage("scheduled");
    // Shapes while it loads.
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    await screen.findByText("for soon");
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toContain("/api/scheduled");
    const rows = screen.getAllByRole("link", { name: /^(general|random)/ });
    expect(rows.map((row) => row.getAttribute("href"))).toEqual(["/rooms/general", "/rooms/general", "/rooms/random/threads/m7"]);
    expect(rows[1]).toHaveTextContent("Not sent");
    expect(within(rows[2]!).getByText("· Thread reply", { exact: false })).toBeInTheDocument();
  });

  it("asks again a moment after a room open here says your scheduled messages changed", async () => {
    vi.spyOn(globalThis, "fetch").mockClear().mockImplementation(async () => Response.json({ messages: [] }));
    showPage("scheduled");
    expect(await screen.findByRole("heading", { name: "Nothing scheduled" })).toBeInTheDocument();
    const asked = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === "/api/scheduled").length;
    expect(asked()).toBe(1);
    vi.mocked(fetch).mockImplementation(async () => Response.json({ messages: [{ id: "s9", roomId: "general", sendAt: Date.now() + 60_000, preview: "just now" }] }));
    render(<RoomScheduling roomId="general" messages={[{ id: "s9", body: "<p>just now</p>", sendAt: Date.now() + 60_000 }]} />);
    expect(await screen.findByText("just now", {}, { timeout: SCHEDULED_DELAY_MS + 2000 })).toBeInTheDocument();
    expect(asked()).toBe(2);
  });

  it("sends one now, moves one, and deletes one with Undo, from each row's actions, over its room's socket", async () => {
    const later = Date.now() + 3_600_000;
    const messages: ListedScheduledMessage[] = [
      { id: "s1", roomId: "general", sendAt: later, preview: "for soon" },
      { id: "s2", roomId: "random", sendAt: later + 1, preview: "for later" },
      { id: "s3", roomId: "general", sendAt: later + 2, preview: "stuck", failed: "You left the room" },
    ];
    vi.spyOn(globalThis, "fetch").mockClear().mockImplementation(async () => Response.json({ messages }));
    const asTheRoomHadIt = { id: "s2", body: "<p>for later</p>", sendAt: later + 1 };
    vi.mocked(changeScheduled).mockClear().mockImplementation(async (_roomId, change) => (change.type === "restore" ? change.message : asTheRoomHadIt));
    showPage("scheduled");
    const user = userEvent.setup();
    const row = async (text: string) => (await screen.findByText(text)).closest("li")!;

    // One that couldn't be sent can't be moved.
    expect(within(await row("stuck")).queryByRole("button", { name: "Edit time" })).not.toBeInTheDocument();
    expect(within(await row("stuck")).getByRole("button", { name: "Send now" })).toBeInTheDocument();

    await user.click(within(await row("for soon")).getByRole("button", { name: "Send now" }));
    expect(changeScheduled).toHaveBeenLastCalledWith("general", { type: "send", id: "s1" });
    await vi.waitFor(() => expect(screen.queryByText("for soon")).not.toBeInTheDocument());

    await user.click(within(await row("for later")).getByRole("button", { name: "Edit time" }));
    expect(await screen.findByRole("dialog", { name: "Edit time" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(within(await row("for later")).getByRole("button", { name: "Delete" }));
    expect(changeScheduled).toHaveBeenLastCalledWith("random", { type: "delete", id: "s2" });
    expect(await screen.findByText("Scheduled message deleted")).toBeInTheDocument();
    expect(screen.queryByText("for later")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(changeScheduled).toHaveBeenLastCalledWith("random", { type: "restore", message: asTheRoomHadIt });
    expect(await screen.findByText("for later")).toBeInTheDocument();
  });

  it("keeps a row whose change didn't go", async () => {
    const messages: ListedScheduledMessage[] = [{ id: "s1", roomId: "general", sendAt: Date.now() + 3_600_000, preview: "for soon" }];
    vi.spyOn(globalThis, "fetch").mockClear().mockImplementation(async () => Response.json({ messages }));
    vi.mocked(changeScheduled).mockClear().mockResolvedValue(null);
    showPage("scheduled");
    const user = userEvent.setup();
    await user.click(within((await screen.findByText("for soon")).closest("li")!).getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(changeScheduled).toHaveBeenCalledOnce());
    expect(screen.queryByText("Scheduled message deleted")).not.toBeInTheDocument();
    expect(screen.getByText("for soon")).toBeInTheDocument();
  });

  it("opens the sheet of what can be done with one on a phone's long press", async () => {
    vi.stubGlobal("matchMedia", (media: string) => ({ matches: media.includes("width < 48rem"), media, addEventListener() {}, removeEventListener() {} }));
    const messages: ListedScheduledMessage[] = [{ id: "s1", roomId: "general", sendAt: Date.now() + 3_600_000, preview: "for soon" }];
    vi.spyOn(globalThis, "fetch").mockClear().mockImplementation(async () => Response.json({ messages }));
    vi.mocked(changeScheduled).mockClear().mockResolvedValue({ id: "s1", body: "<p>for soon</p>", sendAt: messages[0]!.sendAt });
    showPage("scheduled");
    const link = await screen.findByRole("link", { name: /^general/ });
    // A finger rests on it, and the browser's own long press comes first.
    link.dispatchEvent(Object.assign(new MouseEvent("pointerdown", { bubbles: true }), { pointerType: "touch", isPrimary: true }));
    link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const sheet = await screen.findByRole("dialog", { name: "for soon" });
    expect(within(sheet).getAllByRole("button").map((button) => button.textContent)).toEqual(["Send now", "Edit time", "Delete", "Cancel"]);
    await userEvent.setup().click(within(sheet).getByRole("button", { name: "Delete" }));
    expect(changeScheduled).toHaveBeenLastCalledWith("general", { type: "delete", id: "s1" });
    expect(await screen.findByText("Scheduled message deleted")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("says when a scheduled message goes: its time today, tomorrow, its weekday this week, and else its date", () => {
    const now = new Date(2026, 10, 12, 9, 0);
    expect(scheduledLabel(new Date(2026, 10, 12, 15, 0), now)).toMatch(/^\d/);
    expect(scheduledLabel(new Date(2026, 10, 13, 9, 0), now)).toMatch(/^Tomorrow at /);
    expect(scheduledLabel(new Date(2026, 10, 16, 9, 0), now)).toMatch(/^Monday at /);
    expect(scheduledLabel(new Date(2026, 11, 2, 9, 0), now)).toMatch(/^Dec 2 at /);
  });

  it("has Drafts and Sent tabs, marking the one shown", () => {
    showPage("drafts");
    const tabs = within(screen.getByRole("navigation", { name: "Drafts and sent" })).getAllByRole("link");
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute("href"), tab.getAttribute("aria-current")])).toEqual([
      ["Drafts", "/drafts", "page"],
      ["Scheduled", "/drafts/scheduled", null],
      ["Sent", "/drafts/sent", null],
    ]);
  });

  it("lists your drafts in rooms you're in, each opening where it was written, and discards one", async () => {
    localStorage.setItem("composer-draft-u1-general", "<p>half a thought</p>");
    localStorage.setItem("composer-draft-u1-random/threads/m7", "<p>a reply</p>");
    localStorage.setItem("composer-draft-u1-gone", "<p>in a room I left</p>");
    showPage("drafts");
    const draft = screen.getByRole("link", { name: /half a thought/ });
    expect(draft).toHaveAttribute("href", "/rooms/general");
    expect(screen.getByRole("link", { name: /a reply/ })).toHaveAttribute("href", "/rooms/random/threads/m7");
    expect(screen.queryByText("in a room I left")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete draft in general" }));
    expect(screen.queryByRole("link", { name: /half a thought/ })).not.toBeInTheDocument();
    expect(localStorage.getItem("composer-draft-u1-general")).toBeNull();
  });

  it("says when there are no drafts", () => {
    showPage("drafts");
    expect(screen.getByRole("heading", { name: "No drafts" })).toBeInTheDocument();
  });

  it("lists what you've sent, newest first, from search, each with its room and a link to it", async () => {
    const results: SearchResults = { search: { q: "", from: ada.id }, matches: [sent("m2", random, "the latest"), sent("m1", general, "a reply", "m0")].map((message) => ({ message, words: [] })), next: null, rooms: [general, random], recent: [] };
    vi.spyOn(globalThis, "fetch").mockClear().mockImplementation(async () => Response.json(results));
    showPage("sent");
    expect(await screen.findByText("the latest")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("from=u1");
    // Each a row, as the DMs page's are, the whole of it opening the message where it is.
    const opens = screen.getAllByRole("link", { name: /^(random|general)/ });
    expect(opens.map((link) => link.getAttribute("href"))).toEqual(["/rooms/random/@m2", "/rooms/general/threads/m0/@m1"]);
    expect(opens[0]).toHaveTextContent("random");
    expect(opens[0]).toHaveTextContent("the latest");
    expect(opens[0]!.querySelector("time")).toBeInTheDocument();
    expect(within(opens[1]!).getByText("· Thread reply", { exact: false })).toBeInTheDocument();
  });
});
