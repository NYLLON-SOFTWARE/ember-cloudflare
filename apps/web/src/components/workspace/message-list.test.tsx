import { feature } from "@ember/parity";
import type { Invitation, Me, Message } from "@ember/protocol";
import type { ComponentProps } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { initialRoomState, type RoomState } from "@/lib/room-state";
import { MessageList } from "./message-list";

/**
 * jsdom has no layout, so tests say whether each end of the timeline is in view. Like the real
 * thing, an observer reports once when it starts observing, then on every change.
 */
class FakeIntersectionObserver {
  static inView = { top: false, bottom: false };
  static observers = new Set<FakeIntersectionObserver>();
  private end: "top" | "bottom" = "top";
  constructor(readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) {}
  observe(target: Element) {
    // The timeline's top is the first thing in it, and its bottom the last.
    this.end = target.previousElementSibling ? "bottom" : "top";
    FakeIntersectionObserver.observers.add(this);
    this.report();
  }
  report() {
    this.callback([{ isIntersecting: FakeIntersectionObserver.inView[this.end] }]);
  }
  disconnect() {
    FakeIntersectionObserver.observers.delete(this);
  }
}

/** jsdom has no ResizeObserver either. Like the real thing, it reports when it starts observing and when the size changes. */
class FakeResizeObserver {
  static observers = new Set<FakeResizeObserver>();
  constructor(readonly callback: () => void) {}
  observe() {
    FakeResizeObserver.observers.add(this);
    this.callback();
  }
  disconnect() {
    FakeResizeObserver.observers.delete(this);
  }
}

const scrollIntoView = (end: "top" | "bottom") =>
  act(() => {
    FakeIntersectionObserver.inView[end] = true;
    FakeIntersectionObserver.observers.forEach((o) => o.report());
  });

/**
 * jsdom has no layout either, so tests lay the timeline out: its messages one after another, each 100px
 * tall unless `heights` says otherwise, in a log that shows 400px of them and scrolls only as far as they
 * go. A test that changes a height calls `resize`, as a message that grows after it's drawn makes the
 * browser report.
 */
function layOut(log: HTMLElement, heights: Record<string, number> = {}) {
  const rows = () => [...log.querySelectorAll<HTMLElement>("[data-row]")];
  const heightOf = (row: HTMLElement) => heights[row.dataset.messageId!] ?? 100;
  const total = (rows: HTMLElement[]) => rows.reduce((sum, row) => sum + heightOf(row), 0);
  const scrollHeight = () => Math.max(400, total(rows()));
  let scrollTop = 0;
  Object.defineProperties(log, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, get: scrollHeight },
    scrollTop: { configurable: true, get: () => scrollTop, set: (top: number) => (scrollTop = Math.min(Math.max(0, top), scrollHeight() - 400)) },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this === log) return DOMRect.fromRect({ width: 800, height: 400 });
    const above = rows().indexOf(this);
    if (above < 0) return DOMRect.fromRect();
    return DOMRect.fromRect({ y: total(rows().slice(0, above)) - scrollTop, width: 800, height: heightOf(this) });
  });
  const resize = () => act(() => FakeResizeObserver.observers.forEach((o) => o.callback()));
  resize();
  return { heights, resize };
}

const scrollTo = (log: HTMLElement, top: number) => {
  log.scrollTop = top;
  fireEvent.scroll(log);
};

const ada: Me = { id: "u1", name: "Ada", administrator: false };
const actions = { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(), remove: vi.fn() };
const editors = { open: vi.fn(), close: vi.fn(), returnFocus: vi.fn(), attach: vi.fn(), reply: vi.fn() };

/** Messages from Ada named m`from` to m`to`. */
const messages = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => message(`m${from + i}`));

/** A message from Ada, named by its id. */
const message = (id: string, createdAt = "2026-10-12T10:00:00.000Z"): Message => ({
  id,
  clientMessageId: id,
  roomId: "general",
  creator: ada,
  body: id,
  plainText: id,
  mentions: [],
  createdAt,
  updatedAt: createdAt,
  editedAt: null,
  boosts: [],
});

const list = (state: Partial<RoomState>, onLoadOlder: () => void = vi.fn(), invitation: Invitation | null = null, more: Partial<ComponentProps<typeof MessageList>> = {}) => (
  <MessageList
    roomName="general"
    invitation={invitation}
    state={{ ...initialRoomState, status: "open", ...state }}
    me={ada}
    actions={actions}
    editing={new Set()}
    editors={editors}
    onLoadOlder={onLoadOlder}
    onLoadNewer={vi.fn()}
    onJumpToNewest={vi.fn(() => true)}
    {...more}
  />
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T18:00:00"));
  FakeIntersectionObserver.inView = { top: false, bottom: false };
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(feature("ui.empty-room"), () => {
  it("welcomes people to a room with no messages yet", () => {
    render(list({ messages: [] }));
    expect(screen.getByRole("heading", { name: "Welcome to #general" })).toBeInTheDocument();
  });

  it("doesn't claim the room is empty before it has loaded", () => {
    render(list({ status: "connecting", messages: [] }));
    expect(screen.queryByRole("heading", { name: "Welcome to #general" })).not.toBeInTheDocument();
  });

  it("loads earlier messages instead when every message it had was deleted", () => {
    FakeIntersectionObserver.inView.top = true;
    const onLoadOlder = vi.fn();
    render(list({ messages: [], hasMore: true }, onLoadOlder));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Welcome to #general" })).not.toBeInTheDocument();
  });
});

describe(feature("dms.naming"), () => {
  it("names a DM's messages and its beginning for the others in it", () => {
    render(
      <MessageList roomName="Grace and Linus" direct invitation={null} state={{ ...initialRoomState, status: "open", messages: [] }} me={ada} actions={actions} editing={new Set()} editors={editors} onLoadOlder={vi.fn()} onLoadNewer={vi.fn()} onJumpToNewest={vi.fn()} />,
    );
    expect(screen.getByRole("log", { name: "Messages with Grace and Linus" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Grace and Linus" })).toBeInTheDocument();
    expect(screen.getByText("This is the very beginning of your direct messages.")).toBeInTheDocument();
    expect(screen.queryByText(/#/)).not.toBeInTheDocument();
  });
});

describe(feature("realtime.reconnect"), () => {
  it("marks the timeline busy until the room lets the socket in, which brings its messages afresh", () => {
    const { rerender } = render(list({ status: "connecting", messages: [] }));
    expect(screen.getByRole("log")).toHaveAttribute("aria-busy", "true");
    rerender(list({ messages: [message("m1")] }));
    expect(screen.getByRole("log")).not.toHaveAttribute("aria-busy");
    rerender(list({ status: "reconnecting", messages: [message("m1")] }));
    expect(screen.getByRole("log")).toHaveAttribute("aria-busy", "true");
    rerender(list({ status: "gone", messages: [message("m1")] }));
    expect(screen.getByRole("log")).not.toHaveAttribute("aria-busy");
  });
});

describe(feature("rooms.invitation-card"), () => {
  const invitation = { roomId: "general", joinCode: "aB3d-Ef5h-iJ7k" };
  const card = () => screen.queryByRole("heading", { name: "Welcome to Ember" });

  it("welcomes people to the workspace's first room with the card instead, while it's new", () => {
    render(list({ messages: [], paged: false }, vi.fn(), invitation));
    expect(card()).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Welcome to #general" })).not.toBeInTheDocument();
  });

  it("puts the card above the room's messages, in the timeline", () => {
    render(list({ messages: [message("hello")], paged: false }, vi.fn(), invitation));
    const log = screen.getByRole("log");
    expect(log).toContainElement(card());
    expect(card()!.compareDocumentPosition(screen.getByRole("article")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("leaves it out where the room had more than a page when it opened, or hasn't answered yet", () => {
    const { rerender } = render(list({ messages: [message("hello")], paged: true }, vi.fn(), invitation));
    expect(card()).not.toBeInTheDocument();
    rerender(list({ status: "connecting", messages: [], paged: null }, vi.fn(), invitation));
    expect(card()).not.toBeInTheDocument();
  });

  it("shows no card in other rooms", () => {
    render(list({ messages: [], paged: false }));
    expect(card()).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome to #general" })).toBeInTheDocument();
  });
});

describe(feature("messages.day-separators"), () => {
  it("heads each day with its date, and the date and time of its first message on hover", () => {
    render(list({ messages: [message("Saturday", "2026-10-10T09:00:00"), message("Sunday", "2026-10-11T09:00:00"), message("Later", "2026-10-11T15:04:00")] }));
    const days = screen.getAllByRole("heading", { level: 2 });
    expect(days.map((day) => day.textContent)).toEqual(["October 10, 2026", "October 11, 2026"]);
    expect(days[1]!.querySelector("time")).toHaveAttribute("title", "10/11/26, 9:00 AM");
  });
});

describe(feature("messages.history"), () => {
  it("loads earlier messages when the top of the timeline comes into view", () => {
    const onLoadOlder = vi.fn();
    render(list({ messages: [message("m2")], hasMore: true }, onLoadOlder));
    expect(onLoadOlder).not.toHaveBeenCalled();
    scrollIntoView("top");
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("keeps loading while a tall window still shows the top, but not after a failed page", () => {
    FakeIntersectionObserver.inView.top = true;
    const onLoadOlder = vi.fn();
    const messages = [message("m3")];
    const { rerender } = render(list({ messages, hasMore: true }, onLoadOlder));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    rerender(list({ messages, hasMore: true, loadingOlder: true }, onLoadOlder));
    // The page failed: nothing changed, so it doesn't ask again on its own.
    rerender(list({ messages, hasMore: true }, onLoadOlder));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    // A page arrived and the top is still in view, so it asks for the next one.
    rerender(list({ messages: [message("m2"), ...messages], hasMore: true }, onLoadOlder));
    expect(onLoadOlder).toHaveBeenCalledTimes(2);
  });

  it("says when it's loading earlier messages, and doesn't ask again meanwhile", () => {
    const onLoadOlder = vi.fn();
    render(list({ messages: [message("m2")], hasMore: true, loadingOlder: true }, onLoadOlder));
    expect(screen.getByText("Loading earlier messages…")).toBeInTheDocument();
    scrollIntoView("top");
    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it("keeps a reader's place as earlier messages come in above them", () => {
    const { rerender } = render(list({ messages: messages(5, 12), hasMore: true }));
    const log = screen.getByRole("log");
    const { resize } = layOut(log);
    scrollTo(log, 50);

    // The two that came are 200px tall, so the reader moves down as far and sees what they saw.
    rerender(list({ messages: messages(3, 12), hasMore: true }));
    expect(log.scrollTop).toBe(250);
    // The browser's own scroll anchoring may have moved them already, which changes nothing.
    resize();
    expect(log.scrollTop).toBe(250);
  });

  it("keeps a reader's place as messages above them go, deleted or cut from the start of a long timeline", () => {
    // Reading older history, so pages come at the end and the oldest messages are cut.
    const { rerender } = render(list({ messages: messages(1, 10), hasNewer: true }));
    const log = screen.getByRole("log");
    layOut(log);
    scrollTo(log, 550);

    rerender(list({ messages: messages(2, 10), hasNewer: true }));
    expect(log.scrollTop).toBe(450);
    rerender(list({ messages: messages(4, 12), hasNewer: true }));
    expect(log.scrollTop).toBe(250);
  });

  it("loads later messages when the bottom comes into view while the timeline holds older history", () => {
    const onLoadNewer = vi.fn();
    const more = { onLoadNewer };
    const { rerender } = render(list({ messages: messages(1, 2), hasNewer: true }, vi.fn(), null, more));
    expect(onLoadNewer).not.toHaveBeenCalled();
    scrollIntoView("bottom");
    expect(onLoadNewer).toHaveBeenCalledTimes(1);

    // Not while they're on their way, nor once it holds the newest.
    rerender(list({ messages: messages(1, 2), hasNewer: true, loadingNewer: true }, vi.fn(), null, more));
    rerender(list({ messages: messages(1, 3), hasNewer: true, loadingNewer: true }, vi.fn(), null, more));
    rerender(list({ messages: messages(1, 4) }, vi.fn(), null, more));
    expect(onLoadNewer).toHaveBeenCalledTimes(1);
  });

  it("stops once history runs out", () => {
    FakeIntersectionObserver.inView.top = true;
    const onLoadOlder = vi.fn();
    render(list({ messages: [message("m1")], hasMore: false }, onLoadOlder));
    scrollIntoView("top");
    expect(onLoadOlder).not.toHaveBeenCalled();
  });
});

describe(feature("ui.scroll"), () => {
  const jump = () => screen.queryByRole("button", { name: "Jump to newest message" });

  it("stays at the newest message as new ones come while you're near it", () => {
    const { rerender } = render(list({ messages: messages(1, 6) }));
    const log = screen.getByRole("log", { name: "Messages in general" });
    layOut(log);
    expect(log.scrollTop).toBe(200);

    rerender(list({ messages: messages(1, 7), arrivals: 1 }));
    expect(log.scrollTop).toBe(300);
    // Within 100px of the end is at it, as in ember-rust.
    scrollTo(log, 220);
    rerender(list({ messages: messages(1, 8), arrivals: 2 }));
    expect(log.scrollTop).toBe(400);
    expect(jump()).not.toBeInTheDocument();
  });

  it("offers Jump to newest message when new ones come while you're further up, rather than on scrolling up", async () => {
    const onJumpToNewest = vi.fn(() => true);
    const more = { onJumpToNewest };
    const { rerender } = render(list({ messages: messages(1, 6) }, vi.fn(), null, more));
    const log = screen.getByRole("log");
    layOut(log);
    scrollTo(log, 0);
    expect(jump()).not.toBeInTheDocument();

    rerender(list({ messages: messages(1, 7), arrivals: 1 }, vi.fn(), null, more));
    expect(log.scrollTop).toBe(0);
    await userEvent.click(jump()!);
    expect(onJumpToNewest).toHaveBeenCalledTimes(1);
    expect(jump()).not.toBeInTheDocument();

    // It goes once the reader is back at the end, too.
    rerender(list({ messages: messages(1, 8), arrivals: 2 }, vi.fn(), null, more));
    expect(jump()).toBeInTheDocument();
    scrollTo(log, 400);
    expect(jump()).not.toBeInTheDocument();
  });

  it("offers it whenever new ones come while the timeline holds older history, which they wait beyond", () => {
    const { rerender } = render(list({ messages: messages(1, 6), hasNewer: true }));
    const log = screen.getByRole("log");
    layOut(log);
    scrollTo(log, 200);
    rerender(list({ messages: messages(1, 6), hasNewer: true, arrivals: 1 }));
    expect(jump()).toBeInTheDocument();
  });

  it("keeps it to try again when it can't go yet, as while the room is away and the newest aren't loaded", async () => {
    const onJumpToNewest = vi.fn(() => false);
    const more = { onJumpToNewest };
    const { rerender } = render(list({ messages: messages(1, 6), hasNewer: true }, vi.fn(), null, more));
    const log = screen.getByRole("log");
    layOut(log);
    scrollTo(log, 200);
    rerender(list({ messages: messages(1, 6), hasNewer: true, arrivals: 1 }, vi.fn(), null, more));
    await userEvent.click(jump()!);
    expect(jump()).toBeInTheDocument();

    onJumpToNewest.mockReturnValue(true);
    await userEvent.click(jump()!);
    expect(onJumpToNewest).toHaveBeenCalledTimes(2);
    expect(jump()).not.toBeInTheDocument();
  });

  it("follows new ones again once a short last page of later messages leaves the reader at the end", () => {
    const { rerender } = render(list({ messages: messages(1, 6), hasNewer: true }));
    const log = screen.getByRole("log");
    layOut(log, { m7: 40 });
    scrollTo(log, 200);
    rerender(list({ messages: messages(1, 6), hasNewer: true, arrivals: 1 }));
    expect(jump()).toBeInTheDocument();

    // The last page adds 40px below the view, which doesn't scroll the reader, but leaves them at the end.
    rerender(list({ messages: messages(1, 7), arrivals: 1 }));
    expect(log.scrollTop).toBe(200);
    expect(jump()).not.toBeInTheDocument();
    rerender(list({ messages: messages(1, 8), arrivals: 2 }));
    expect(log.scrollTop).toBe(340);
    expect(jump()).not.toBeInTheDocument();
  });

  it("keeps what's in view where it is as a message above its end grows, as an edit or a reaction does", () => {
    const { rerender } = render(list({ messages: messages(1, 8) }));
    const log = screen.getByRole("log");
    const { heights, resize } = layOut(log);
    scrollTo(log, 200);

    // m5 is in view, above m6, the last message that starts in view, whose bottom stays where it was.
    heights.m5 = 150;
    resize();
    expect(log.scrollTop).toBe(250);
    // m8 is below it, so nothing moves.
    heights.m8 = 300;
    resize();
    expect(log.scrollTop).toBe(250);
    // Nor as a message changes in the room, as ember-rust's maintain_scroll_controller.js keeps the
    // bottom for an edit above the fold.
    heights.m2 = 200;
    rerender(list({ messages: messages(1, 8) }));
    expect(log.scrollTop).toBe(350);
  });

  it("goes to the end as you send or jump there", () => {
    const { rerender } = render(list({ messages: messages(1, 8) }));
    const log = screen.getByRole("log");
    layOut(log);
    scrollTo(log, 0);
    rerender(list({ messages: messages(1, 8), focus: { messageId: null } }));
    expect(log.scrollTop).toBe(400);
  });
});

describe(feature("messages.permalink"), () => {
  it("centres the message a permalink goes to and outlines it, each time it's gone to", () => {
    // jsdom can't animate.
    const animate = vi.fn();
    Element.prototype.animate = animate;
    onTestFinished(() => void delete (Element.prototype as Partial<Element>).animate);
    const { rerender } = render(list({ messages: messages(1, 10) }));
    const log = screen.getByRole("log");
    layOut(log);
    const body = log.querySelector('[data-message-id="m5"] [data-body-content]');

    // m5 is 400px down and 100px tall, so it's in the middle of the 400px view at 250px.
    let focus = { messageId: "m5" };
    rerender(list({ messages: messages(1, 10), focus }));
    expect(log.scrollTop).toBe(250);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.contexts[0]).toBe(body);

    scrollTo(log, 0);
    focus = { messageId: "m5" };
    rerender(list({ messages: messages(1, 10), focus }));
    expect(log.scrollTop).toBe(250);
    expect(animate).toHaveBeenCalledTimes(2);

    // Away from the end, the reader stays as new messages come, and can jump to them.
    rerender(list({ messages: messages(1, 11), focus, arrivals: 1 }));
    expect(log.scrollTop).toBe(250);
    expect(screen.getByRole("button", { name: "Jump to newest message" })).toBeInTheDocument();
  });
});
