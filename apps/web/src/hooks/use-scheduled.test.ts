import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ScheduledMessage } from "@ember/protocol";
import type { RoomFrames } from "./use-room";
import { useAllScheduled, useScheduled } from "./use-scheduled";

const scheduled: ScheduledMessage[] = [{ id: "s1", body: "<p>Ada's plans</p>", sendAt: Date.now() + 60_000 }];

/** A room's socket that tells of `messages` scheduled there as it's listened to. */
const telling = (messages: ScheduledMessage[]): RoomFrames => ({ send: () => true, listen: (hear) => (hear({ type: "scheduled", messages }), () => {}) });
/** A room's socket that's yet to say anything, as one that can't connect. */
const silent: RoomFrames = { send: () => false, listen: () => () => {} };

describe("useScheduled", () => {
  it("doesn't show someone signed in after another in this tab what the other scheduled", () => {
    const frames = telling(scheduled);
    const ada = renderHook(() => useScheduled("ada", "general", frames));
    expect(ada.result.current.messages).toEqual(scheduled);
    ada.unmount();

    // Sam signs in in place of Ada, in the same tab, and opens the room before it's said anything.
    expect(renderHook(() => useScheduled("sam", "general", silent)).result.current.messages).toEqual([]);
    expect(renderHook(() => useAllScheduled("sam")).result.current).toEqual([]);
  });

  it("forgets the last person's lists once someone else's arrive", () => {
    const [adas, sams] = [telling(scheduled), telling([])];
    renderHook(() => useScheduled("ada", "general", adas)).unmount();
    renderHook(() => useScheduled("sam", "random", sams)).unmount();
    // Ada back, before the room has said anything again: nothing of hers is kept from before.
    expect(renderHook(() => useScheduled("ada", "general", silent)).result.current.messages).toEqual([]);
  });
});
