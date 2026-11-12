import type { Me, Message, Room, ScheduledMessage, SearchResults } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import type { RoomFrames } from "@/hooks/use-room";
import { useScheduled } from "@/hooks/use-scheduled";
import { DraftsPage, scheduledLabel } from "./drafts-page";

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
  it("lists what you've scheduled in the rooms opened here, soonest first, each opening where it's to go, saying when", async () => {
    const soon = new Date(2026, 10, 12, 15, 0).getTime();
    const later = new Date(2026, 10, 20, 9, 30).getTime();
    render(
      <>
        <RoomScheduling roomId="random" messages={[{ id: "s2", body: "<p>for later</p>", sendAt: later, parentId: "m7" }]} />
        <RoomScheduling roomId="general" messages={[{ id: "s1", body: "<p>for soon</p>", sendAt: soon }, { id: "s3", body: "<p>stuck</p>", sendAt: soon + 1, failed: "You left the room" }]} />
      </>,
    );
    showPage("scheduled");
    const rows = screen.getAllByRole("link", { name: /^(general|random)/ });
    expect(rows.map((row) => row.getAttribute("href"))).toEqual(["/rooms/general", "/rooms/general", "/rooms/random/threads/m7"]);
    expect(rows[0]).toHaveTextContent("for soon");
    expect(rows[1]).toHaveTextContent("Not sent");
    expect(within(rows[2]!).getByText("· Thread reply", { exact: false })).toBeInTheDocument();
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
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(results));
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
