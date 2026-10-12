import type { Message, User } from "@ember/protocol";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
  return layout;
}

const scrollTo = (log: HTMLElement, top: number) => {
  log.scrollTop = top;
  fireEvent.scroll(log);
};

const ada: User = { id: "u1", name: "Ada" };
const message = (id: string): Message => ({
  id,
  clientMessageId: id,
  roomId: "general",
  creator: ada,
  body: id,
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  boosts: [],
});
const actions = { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(), remove: vi.fn() };
const list = (state: Partial<RoomState>, onLoadOlder: () => void) => (
  <MessageList roomName="general" state={{ ...initialRoomState, status: "open", ...state }} me={ada} actions={actions} onLoadOlder={onLoadOlder} />
);

beforeEach(() => {
  FakeIntersectionObserver.topVisible = false;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe("MessageList", () => {
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
