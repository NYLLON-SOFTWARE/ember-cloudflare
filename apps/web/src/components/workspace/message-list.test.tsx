import { feature } from "@ember/parity";
import type { Invitation, Message, User } from "@ember/protocol";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialRoomState, type RoomState } from "@/lib/room-state";
import { MessageList } from "./message-list";

/**
 * jsdom has no layout, so tests say whether the top of the timeline is in view. Like the real
 * thing, an observer reports once when it starts observing, then on every change.
 */
class FakeIntersectionObserver {
  static topVisible = false;
  static observers = new Set<FakeIntersectionObserver>();
  constructor(readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) {}
  observe() {
    FakeIntersectionObserver.observers.add(this);
    this.callback([{ isIntersecting: FakeIntersectionObserver.topVisible }]);
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

const scrollTopIntoView = () =>
  act(() => {
    FakeIntersectionObserver.topVisible = true;
    FakeIntersectionObserver.observers.forEach((o) => o.callback([{ isIntersecting: true }]));
  });

/** jsdom has no layout either, so tests say how tall the timeline's content is. It shows 400px of it. */
function layOut(log: HTMLElement, height: number) {
  const layout = { height };
  Object.defineProperty(log, "scrollHeight", { configurable: true, get: () => layout.height });
  Object.defineProperty(log, "clientHeight", { configurable: true, value: 400 });
  FakeResizeObserver.observers.forEach((o) => o.callback());
  return layout;
}

const scrollTo = (log: HTMLElement, top: number) => {
  log.scrollTop = top;
  fireEvent.scroll(log);
};

const ada: User = { id: "u1", name: "Ada" };
const actions = { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(), remove: vi.fn() };

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

const list = (state: Partial<RoomState>, onLoadOlder: () => void = vi.fn(), invitation: Invitation | null = null) => (
  <MessageList roomName="general" invitation={invitation} state={{ ...initialRoomState, status: "open", ...state }} me={ada} actions={actions} onLoadOlder={onLoadOlder} />
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T18:00:00"));
  FakeIntersectionObserver.topVisible = false;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
  it("separates days, naming today and yesterday", () => {
    render(list({ messages: [message("Saturday", "2026-10-10T09:00:00"), message("Sunday", "2026-10-11T09:00:00"), message("Monday", "2026-10-12T09:00:00")] }));
    const separators = screen.getAllByRole("separator").map((s) => s.textContent);
    expect(separators).toEqual([expect.stringMatching(/Saturday, October 10/), "Yesterday", "Today"]);
  });
});

describe(feature("messages.history"), () => {
  it("loads earlier messages when the top of the timeline comes into view", () => {
    const onLoadOlder = vi.fn();
    render(list({ messages: [message("m2")], hasMore: true }, onLoadOlder));
    expect(onLoadOlder).not.toHaveBeenCalled();
    scrollTopIntoView();
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("keeps loading while a tall window still shows the top, but not after a failed page", () => {
    FakeIntersectionObserver.topVisible = true;
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
    scrollTopIntoView();
    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it("keeps a scrolled-up reader's place when older messages arrive, whether or not the browser kept it already", () => {
    const onLoadOlder = vi.fn();
    const { rerender } = render(list({ messages: [message("m5")], hasMore: true }, onLoadOlder));
    const log = screen.getByRole("log");
    const layout = layOut(log, 2000);
    scrollTo(log, 150);

    // Without scroll anchoring, the reader stays put only if the timeline moves them down by the page's height.
    layout.height = 3000;
    rerender(list({ messages: [message("m4"), message("m5")], hasMore: true }, onLoadOlder));
    expect(log.scrollTop).toBe(1150);

    // With it, the browser has already moved them by the time the page renders.
    layout.height = 4000;
    log.scrollTop = 2150;
    rerender(list({ messages: [message("m3"), message("m4"), message("m5")], hasMore: true }, onLoadOlder));
    expect(log.scrollTop).toBe(2150);
  });

  it("leaves a scrolled-up reader to the browser when the oldest message goes or a reconnect replaces history", () => {
    const onLoadOlder = vi.fn();
    const { rerender } = render(list({ messages: [message("m1"), message("m2"), message("m3")] }, onLoadOlder));
    const log = screen.getByRole("log");
    const layout = layOut(log, 2000);
    scrollTo(log, 500);

    // The browser's scroll anchoring keeps the reader's place as the deleted message goes.
    layout.height = 1957;
    log.scrollTop = 457;
    rerender(list({ messages: [message("m2"), message("m3")] }, onLoadOlder));
    expect(log.scrollTop).toBe(457);

    // The room's latest page no longer has the message the timeline started with.
    layout.height = 1500;
    rerender(list({ messages: [message("m3"), message("m4")] }, onLoadOlder));
    expect(log.scrollTop).toBe(457);
  });

  it("stops once history runs out", () => {
    FakeIntersectionObserver.topVisible = true;
    const onLoadOlder = vi.fn();
    render(list({ messages: [message("m1")], hasMore: false }, onLoadOlder));
    scrollTopIntoView();
    expect(onLoadOlder).not.toHaveBeenCalled();
  });
});

describe(feature("ui.scroll"), () => {
  it("offers a way back to the latest messages after scrolling up", async () => {
    render(list({ messages: [message("first")] }));
    const log = screen.getByRole("log", { name: "Messages in general" });
    expect(screen.queryByRole("button", { name: "Return to latest messages" })).not.toBeInTheDocument();

    layOut(log, 2000);
    scrollTo(log, 600);
    const button = screen.getByRole("button", { name: "Return to latest messages" });
    log.scrollTo = vi.fn();
    await userEvent.click(button);
    expect(log.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" });

    scrollTo(log, 1550);
    expect(screen.queryByRole("button", { name: "Return to latest messages" })).not.toBeInTheDocument();
  });
});
