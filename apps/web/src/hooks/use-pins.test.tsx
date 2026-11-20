import { type ClientFrame, type Message, type ServerFrame, type User } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePins } from "./use-pins";

const ada: User = { id: "u1", name: "Ada" };

/** A message, whose body is its plain text as typed. */
const message = (id: string, plainText: string, overrides: Partial<Message> = {}): Message => ({
  id,
  clientMessageId: id,
  roomId: "general",
  creator: ada,
  body: bodyFromPlainText(plainText),
  plainText,
  mentions: [],
  createdAt: "2026-11-13T10:00:00.000Z",
  updatedAt: "2026-11-13T10:00:00.000Z",
  editedAt: null,
  boosts: [],
  ...overrides,
});

const welcome = (): ServerFrame => ({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0 });
const resumed = (): ServerFrame => ({ type: "resumed", you: ada, messages: [], deletedIds: [], present: [ada], seq: 0 });

/**
 * The room's socket, as the hook sends over it and hears it: what was sent, and what a test has the
 * room say, which every listener of the hook's takes, as the room's timeline does.
 */
function roomFrames() {
  const sent: ClientFrame["type"][] = [];
  const listeners = new Set<(frame: ServerFrame) => void>();
  return {
    sent,
    frames: {
      send: (frame: ClientFrame) => {
        sent.push(frame.type);
        return true;
      },
      listen: (listener: (frame: ServerFrame) => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    hear: (frame: ServerFrame) => act(() => listeners.forEach((listener) => listener(frame))),
  };
}

/** The room's listing of one pinned message. */
const listed = (message: Message) => [{ message, by: ada, at: "2026-11-13T10:01:00.000Z" }];

afterEach(cleanup);

describe("usePins", () => {
  it("asks the room for its pins as it opens, fills them from its listing, and asks again when it lets it in again", () => {
    const { sent, frames, hear } = roomFrames();
    const first = message("m1", "First pinned");
    const hook = renderHook(() => usePins("general", frames));
    expect(sent).toEqual(["pins.list"]);

    hear({ type: "pins.listed", pins: listed(first) });
    expect(hook.result.current.pins).toEqual([{ messageId: "m1", by: ada, at: "2026-11-13T10:01:00.000Z" }]);
    expect(hook.result.current.pinnedIds).toEqual(new Set(["m1"]));
    expect(hook.result.current.listed.get("m1")).toEqual(first);

    hear(welcome());
    expect(sent).toEqual(["pins.list", "pins.list"]);
  });

  it("keeps a pinned message as its edit says, and leaves a message it hasn't listed out", () => {
    const { frames, hear } = roomFrames();
    const first = message("m1", "First pinned");
    const hook = renderHook(() => usePins("general", frames));
    hear({ type: "pins.listed", pins: listed(first) });

    hear({ type: "message.updated", message: message("m1", "First pinned, retold", { editedAt: "2026-11-13T11:00:00.000Z" }), seq: 2 });
    expect(hook.result.current.listed.get("m1")!.plainText).toBe("First pinned, retold");
    // An edit of a message the room never listed adds nothing to show.
    hear({ type: "message.updated", message: message("m2", "Unlisted, retold"), seq: 3 });
    expect([...hook.result.current.listed.keys()]).toEqual(["m1"]);
  });

  it("takes a pinned message's going out of its pins and its list, as its deletion, or its update kept for replies, says", () => {
    const { frames, hear } = roomFrames();
    const first = message("m1", "Gone, or kept for replies");
    const hook = renderHook(() => usePins("general", frames));
    hear({ type: "pins.listed", pins: listed(first) });

    hear({ type: "message.updated", message: message("m1", "", { deleted: true }), seq: 2 });
    expect(hook.result.current.pins).toEqual([]);
    expect(hook.result.current.listed.size).toBe(0);

    hear({ type: "pins.listed", pins: listed(first) });
    hear({ type: "message.deleted", messageId: "m1", seq: 3 });
    expect(hook.result.current.pins).toEqual([]);
    expect(hook.result.current.listed.size).toBe(0);
  });

  it("keeps a pinned message's reactions as the room says they come and go", () => {
    const { frames, hear } = roomFrames();
    const first = message("m1", "First pinned");
    const hook = renderHook(() => usePins("general", frames));
    hear({ type: "pins.listed", pins: listed(first) });

    const boost = { id: "b1", messageId: "m1", booster: ada, content: "🎉", createdAt: "2026-11-13T10:02:00.000Z" };
    hear({ type: "boost.created", boost, seq: 2 });
    expect(hook.result.current.listed.get("m1")!.boosts).toEqual([boost]);
    hear({ type: "boost.deleted", boostId: "b1", messageId: "m1", seq: 3 });
    expect(hook.result.current.listed.get("m1")!.boosts).toEqual([]);
  });

  it("takes a pin's going, in another tab, for its own, with its time waiting for its listing", () => {
    const { frames, hear } = roomFrames();
    const first = message("m1", "First pinned");
    const second = message("m2", "Second pinned");
    const hook = renderHook(() => usePins("general", frames));
    hear({ type: "pins.listed", pins: listed(first) });

    hear({ type: "pin.created", messageId: "m2", by: ada, seq: 2 });
    expect(hook.result.current.pins).toEqual([
      { messageId: "m1", by: ada, at: "2026-11-13T10:01:00.000Z" },
      { messageId: "m2", by: ada, at: null },
    ]);
    hear({ type: "pin.deleted", messageId: "m2", by: ada, seq: 3 });
    expect(hook.result.current.pins).toEqual([{ messageId: "m1", by: ada, at: "2026-11-13T10:01:00.000Z" }]);
    hear(resumed());
    expect(hook.result.current.pins).toEqual([{ messageId: "m1", by: ada, at: "2026-11-13T10:01:00.000Z" }]);
  });
});
