import type { ClientFrame, ScheduledMessage, ServerFrame, User } from "@ember/protocol";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RoomFrames } from "./use-room";
import { useScheduled } from "./use-scheduled";

const ada: User = { id: "u1", name: "Ada" };
const waiting = (overrides: Partial<ScheduledMessage> = {}): ScheduledMessage => ({
  id: "s1",
  clientMessageId: "c1",
  roomId: "general",
  creator: ada,
  body: "<p>After lunch</p>",
  plainText: "After lunch",
  mentions: [],
  sendAt: "2026-11-13T15:04:00.000Z",
  createdAt: "2026-11-13T14:00:00.000Z",
  ...overrides,
});

function fakeFrames() {
  const listeners = new Set<(frame: ServerFrame) => void>();
  const sent: ClientFrame[] = [];
  const frames: RoomFrames & { sent: ClientFrame[]; receive: (frame: ServerFrame) => void } = {
    sent,
    send: (frame) => {
      sent.push(frame);
      return true;
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    receive: (frame) => {
      for (const listener of listeners) listener(frame);
    },
  };
  return frames;
}

describe("Waiting messages", () => {
  it("asks the room for this person's waiting messages as the room opens, and again as it lets the page in", () => {
    const frames = fakeFrames();
    const { result } = renderHook(() => useScheduled(frames));
    expect(frames.sent).toEqual([{ type: "scheduled.list" }]);
    expect(result.current).toEqual([]);

    const first = waiting();
    act(() => frames.receive({ type: "scheduled.listed", scheduled: [first] }));
    expect(result.current).toEqual([first]);

    act(() =>
      frames.receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0 }),
    );
    expect(frames.sent).toEqual([{ type: "scheduled.list" }, { type: "scheduled.list" }]);
  });

  it("adds a newly scheduled message soonest first, and drops one cancelled or posted", () => {
    const frames = fakeFrames();
    const { result } = renderHook(() => useScheduled(frames));
    const later = waiting({ id: "s2", sendAt: "2026-11-13T16:00:00.000Z", plainText: "Later" });
    const sooner = waiting({ id: "s1", sendAt: "2026-11-13T15:00:00.000Z", plainText: "Sooner" });

    act(() => frames.receive({ type: "scheduled.created", scheduled: later }));
    act(() => frames.receive({ type: "scheduled.created", scheduled: sooner }));
    expect(result.current.map((item) => item.id)).toEqual(["s1", "s2"]);

    act(() => frames.receive({ type: "scheduled.cancelled", scheduledId: "s2" }));
    expect(result.current.map((item) => item.id)).toEqual(["s1"]);

    act(() => frames.receive({ type: "scheduled.sent", scheduledId: "s1" }));
    expect(result.current).toEqual([]);
  });
});
