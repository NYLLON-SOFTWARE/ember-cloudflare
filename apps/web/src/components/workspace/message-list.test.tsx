import { feature } from "@ember/parity";
import type { Message, User } from "@ember/protocol";
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

/** The list's ResizeObserver callbacks, which a browser calls when the log's size changes. */
let resizeObservers: (() => void)[] = [];

class FakeResizeObserver {
  constructor(notify: () => void) {
    resizeObservers.push(notify);
  }
  observe() {}
  disconnect() {}
}

const scrollTopIntoView = () =>
  act(() => {
    FakeIntersectionObserver.topVisible = true;
    FakeIntersectionObserver.observers.forEach((o) => o.callback([{ isIntersecting: true }]));
  });

/** jsdom has no layout either, so give the log the scroll geometry a browser would. */
function scrollTo(log: HTMLElement, { top, height = 2000, viewport = 500 }: { top: number; height?: number; viewport?: number }) {
  const resized = log.clientHeight !== viewport;
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, value: height },
    clientHeight: { configurable: true, value: viewport },
  });
  // A browser reports the log's new size before the reader gets to scroll it.
  if (resized) resizeObservers.forEach((notify) => notify());
  Object.defineProperty(log, "scrollTop", { configurable: true, writable: true, value: top });
  fireEvent.scroll(log);
}

const ada: User = { id: "u1", name: "Ada" };
const actions = { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(), remove: vi.fn() };

/** A message from Ada, named by its id. */
const message = (id: string, createdAt = "2026-10-12T10:00:00.000Z"): Message => ({
  id,
  clientMessageId: id,
  roomId: "general",
  creator: ada,
  body: id,
  createdAt,
  updatedAt: createdAt,
  boosts: [],
});

const list = (state: Partial<RoomState>, onLoadOlder: () => void = vi.fn()) => (
  <MessageList roomName="general" state={{ ...initialRoomState, status: "open", ...state }} me={ada} actions={actions} onLoadOlder={onLoadOlder} />
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T18:00:00"));
  FakeIntersectionObserver.topVisible = false;
  resizeObservers = [];
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

    scrollTo(log, { top: 600 });
    const button = screen.getByRole("button", { name: "Return to latest messages" });
    log.scrollTo = vi.fn();
    await userEvent.click(button);
    expect(log.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" });

    scrollTo(log, { top: 1450 });
    expect(screen.queryByRole("button", { name: "Return to latest messages" })).not.toBeInTheDocument();
  });
});
