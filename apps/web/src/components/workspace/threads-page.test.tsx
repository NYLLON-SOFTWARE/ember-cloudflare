import { THREAD_CONTEXT, type ListedThread, type ListedThreads, type Me, type Message, type Room, type User } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { handOver } from "@/lib/outbox";
import { ThreadsPage, withFirstPage } from "./threads-page";

vi.mock("@/lib/outbox", () => ({ handOver: vi.fn() }));

const ada: Me = { id: "u1", name: "Ada", administrator: false };
const grace: User = { id: "u2", name: "Grace" };
const general: Room = { id: "general", name: "general", kind: "open", icon: null };
const secret: Room = { id: "secret", name: "secret", kind: "closed", icon: null };

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

const thread: ListedThread = {
  roomId: general.id,
  parent: message("p1", "Shall we ship it?", grace, 0),
  replies: [message("r2", "Tests are green", ada, 20, "p1"), message("r3", "Ship it", grace, 30, "p1")],
  count: 5,
  following: false,
  mentioned: false,
};

/** A thread with as many replies as its card shows under its first message, and earlier ones it leaves out. */
const busy: ListedThread = {
  ...thread,
  replies: Array.from({ length: THREAD_CONTEXT - 1 }, (_, i) => message(`b${i}`, `Reply ${i}`, grace, 10 + i, "p1")),
  count: THREAD_CONTEXT + 2,
};

/** The messages a card shows, by their text, in the order it shows them. */
const shownIn = (card: HTMLElement) =>
  ["Shall we ship it?", ...busy.replies.map(({ plainText }) => plainText), "On it"]
    .flatMap((text) => within(card).queryByText(text) ?? [])
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map((element) => element.textContent);

function showPage(answer: ListedThreads) {
  vi.spyOn(globalThis, "fetch").mockClear().mockImplementation(async () => Response.json(answer));
  vi.mocked(handOver).mockClear();
  render(
    <Sheet>
      <ThreadsPage me={ada} rooms={[general, secret]} onFailed={vi.fn()} />
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
    // Shown on hover beside the page; on phones the room's name, 44px tall, opens the thread.
    expect(within(card).getByRole("link", { name: "Open thread" })).toHaveClass("opacity-0", "group-hover/card:opacity-100", "max-md:hidden");
    const roomLink = within(card.querySelector("h2")!).getByRole("link", { name: "general" });
    expect(roomLink).toHaveAttribute("href", "/rooms/general/threads/p1");
    expect(roomLink).toHaveClass("max-md:min-h-11");
    expect(card).toHaveClass("max-md:rounded-none", "max-md:border-x-0");
  });

  it("shows a thread's first message and its latest replies, THREAD_CONTEXT messages in all, the ones written here among them", async () => {
    showPage({ threads: [busy], next: null });
    const card = await screen.findByRole("article", { name: "Thread in general" });
    expect(shownIn(card)).toEqual(["Shall we ship it?", "Reply 0", "Reply 1", "Reply 2", "Reply 3", "Reply 4"]);
    expect(within(card).getByRole("link", { name: "3 more replies" })).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "Reply" }));
    await userEvent.type(within(card).getByRole("textbox"), "On it{Enter}");
    expect(shownIn(card)).toEqual(["Shall we ship it?", "Reply 1", "Reply 2", "Reply 3", "Reply 4", "On it"]);
    expect(within(card).getByRole("link", { name: "4 more replies" })).toBeInTheDocument();
  });

  it("marks the threads that mention you, and the ones you follow", async () => {
    showPage({ threads: [{ ...thread, mentioned: true, following: true }, { ...thread, parent: message("p2", "Lunch?", grace, 1), replies: [], count: 1, following: true }, { ...thread, parent: message("p3", "FYI", grace, 2), replies: [], count: 1 }], next: null });
    const [mentions, following, other] = await screen.findAllByRole("article", { name: "Thread in general" });
    expect(within(mentions!).getByText("Mentions you")).toBeInTheDocument();
    expect(within(following!).getByText("Following")).toBeInTheDocument();
    // Not on phones, where a card is lean, and its thread has the rest, as does its Reply.
    expect(within(following!).getByText("Following")).toHaveClass("max-md:hidden");
    expect(within(following!).getByRole("button", { name: "Reply" })).toHaveClass("max-md:hidden");
    expect(within(other!).queryByText(/Mentions you|Following/)).toBeNull();
  });

  it("opens a box to reply in only once Reply is pressed, closing it again with Escape while it's empty", async () => {
    showPage({ threads: [thread], next: null });
    const card = await screen.findByRole("article", { name: "Thread in general" });
    expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Reply" }));
    expect(within(card).getByRole("textbox", { name: "Reply in thread in general" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("sends a reply written in a card to its thread, showing it at once", async () => {
    showPage({ threads: [thread], next: null });
    await userEvent.click(await screen.findByRole("button", { name: "Reply" }));
    const box = screen.getByRole("textbox", { name: "Reply in thread in general" });
    await userEvent.type(box, "On it{Enter}");
    expect(handOver).toHaveBeenCalledExactlyOnceWith("general", [expect.objectContaining({ parentId: "p1", plainText: "On it", queued: true, creator: ada })]);
    expect(box).toHaveValue("");
    expect(within(screen.getByRole("article", { name: "Thread in general" })).getByText("On it")).toBeInTheDocument();
  });

  it("brings the cards up to date as the tab is shown again, with others' replies, its own written there once each", async () => {
    showPage({ threads: [thread], next: null });
    const card = await screen.findByRole("article", { name: "Thread in general" });
    await userEvent.click(within(card).getByRole("button", { name: "Reply" }));
    await userEvent.type(within(card).getByRole("textbox"), "On it{Enter}");
    const mine = vi.mocked(handOver).mock.calls[0]![1][0]!;

    // Since: Grace replied, and the reply written here reached the thread.
    const now: ListedThread = { ...thread, replies: [...thread.replies, message("r4", "Shipped", grace, 40, "p1"), { ...mine, id: "r5", clientMessageId: mine.clientMessageId } as Message], count: 7 };
    vi.mocked(fetch).mockImplementation(async () => Response.json({ threads: [now], next: null }));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(await within(card).findByText("Shipped")).toBeInTheDocument();
    expect(within(card).getAllByText("On it")).toHaveLength(1);
  });

  it("puts the first page asked for again first, keeping the threads loaded after it and the cursor after those", () => {
    const [a, b, c] = ["a", "b", "c"].map((id): ListedThread => ({ ...thread, parent: message(id, id, grace, 0) }));
    expect(withFirstPage({ threads: [a!, b!], next: 7 }, { threads: [c!, b!], next: 3 })).toEqual({ threads: [c, b, a], next: 7 });
  });

  it("starts the first reply after the ones left out with its author, though they wrote the first message just before", async () => {
    const close: ListedThread = { ...thread, replies: [message("r9", "And also", grace, 1, "p1")], count: 4 };
    showPage({ threads: [close], next: null });
    const card = await screen.findByRole("article", { name: "Thread in general" });
    expect(within(card).getByRole("link", { name: "3 more replies" })).toBeInTheDocument();
    // Grace's name heads both her first message and her reply.
    expect(within(card).getAllByText("Grace", { selector: "h3 *, h3" }).length).toBeGreaterThanOrEqual(2);
  });

  it("marks a private room's thread with a lock, as the sidebar does, rather than `#`", async () => {
    showPage({ threads: [{ ...thread, roomId: "secret" }], next: null });
    const card = await screen.findByRole("article", { name: "Thread in secret" });
    expect(card.querySelector("header .iconoir-lock")).toBeInTheDocument();
    expect(within(card.querySelector("header")!).queryByText("#")).toBeNull();
  });

  it("shows the shapes of cards while the threads load, and says so to screen readers", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    render(
      <Sheet>
        <ThreadsPage me={ada} rooms={[general]} onFailed={vi.fn()} />
      </Sheet>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.getByRole("status").querySelectorAll(".rounded-xl")).toHaveLength(2);
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
