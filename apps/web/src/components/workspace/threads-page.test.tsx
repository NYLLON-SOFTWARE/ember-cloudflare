import type { FollowedThread, FollowedThreads, Me, Message, Room, User } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { handOver } from "@/lib/outbox";
import { ThreadsPage } from "./threads-page";

vi.mock("@/lib/outbox", () => ({ handOver: vi.fn() }));

const ada: Me = { id: "u1", name: "Ada", administrator: false };
const grace: User = { id: "u2", name: "Grace" };
const general: Room = { id: "general", name: "general", kind: "open", icon: null };

const message = (id: string, plainText: string, creator: User, minutes: number, parentId?: string): Message => ({
  id,
  clientMessageId: id,
  roomId: general.id,
  creator,
  body: bodyFromPlainText(plainText),
  plainText,
  mentions: [],
  createdAt: new Date(Date.UTC(2026, 9, 12, 10, minutes)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 9, 12, 10, minutes)).toISOString(),
  editedAt: null,
  boosts: [],
  ...(parentId && { parentId }),
});

const thread: FollowedThread = {
  roomId: general.id,
  parent: message("p1", "Shall we ship it?", grace, 0),
  replies: [message("r2", "Tests are green", ada, 20, "p1"), message("r3", "Ship it", grace, 30, "p1")],
  count: 5,
};

function showPage(answer: FollowedThreads) {
  vi.spyOn(globalThis, "fetch").mockClear().mockImplementation(async () => Response.json(answer));
  render(
    <Sheet>
      <ThreadsPage me={ada} rooms={[general]} onFailed={vi.fn()} />
    </Sheet>,
  );
}

describe("Threads page", () => {
  it("shows each thread's room, first message, how many earlier replies it leaves out, and its latest replies", async () => {
    showPage({ threads: [thread], next: null });
    const card = await screen.findByRole("article", { name: "Thread in general" });
    expect(within(card).getByRole("heading", { level: 2, name: "general" })).toBeInTheDocument();
    expect(within(card).getByText("Shall we ship it?")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "3 more replies" })).toHaveAttribute("href", "/rooms/general/threads/p1");
    expect(within(card).getByText("Ship it")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Open thread" })).toHaveAttribute("href", "/rooms/general/threads/p1");
  });

  it("sends a reply written in a card to its thread, showing it at once", async () => {
    showPage({ threads: [thread], next: null });
    const box = await screen.findByRole("textbox", { name: "Reply in thread in general" });
    await userEvent.type(box, "On it{Enter}");
    expect(handOver).toHaveBeenCalledExactlyOnceWith("general", [expect.objectContaining({ parentId: "p1", plainText: "On it", queued: true, creator: ada })]);
    expect(box).toHaveValue("");
    expect(within(screen.getByRole("article", { name: "Thread in general" })).getByText("On it")).toBeInTheDocument();
  });

  it("says when there are no threads", async () => {
    showPage({ threads: [], next: null });
    expect(await screen.findByRole("heading", { name: "No threads yet" })).toBeInTheDocument();
  });

  it("loads the next page after the one it shows", async () => {
    showPage({ threads: [thread], next: 42 });
    await userEvent.click(await screen.findByRole("button", { name: "Show more" }));
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/threads"))).toEqual(["/api/threads", "/api/threads?cursor=42"]);
  });
});
