import type { Me, Message, Room, SearchResults } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { DraftsPage } from "./drafts-page";

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

function showPage(tab: "drafts" | "sent") {
  const onFailed = vi.fn();
  render(
    <Sheet>
      <DraftsPage me={ada} tab={tab} rooms={[general, random]} onFailed={onFailed} />
    </Sheet>,
  );
  return { onFailed };
}

describe("Drafts & sent", () => {
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
