import type { DirectPreview, Message } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { keepShapes, keptShapes, shapeOf } from "./dm-shapes";

const latest = (plainText: string) => ({ plainText }) as Message;
const preview = (roomId: string, text: string | null): DirectPreview => ({ roomId, latest: text === null ? null : latest(text), unread: 0 });

beforeEach(() => localStorage.clear());

describe("DM shapes", () => {
  it("says a DM's row is quiet, a line or two, by its latest message", () => {
    expect(shapeOf(preview("d1", null))).toBe(0);
    expect(shapeOf(preview("d1", "see you at noon"))).toBe(1);
    expect(shapeOf(preview("d1", "Want to look at the empty state together tomorrow? 15 minutes is plenty."))).toBe(2);
  });

  it("keeps each of someone's DMs' shapes, and nothing of what was said, in place of those kept before", () => {
    keepShapes("u1", new Map([["d1", preview("d1", null)], ["d2", preview("d2", "hi")]]));
    expect([...keptShapes("u1")]).toEqual([["d1", 0], ["d2", 1]]);
    expect(localStorage.getItem("ember:dm-shapes:u1")).not.toContain("hi");
    expect(keptShapes("u2").size).toBe(0);
    keepShapes("u1", new Map([["d2", preview("d2", null)]]));
    expect([...keptShapes("u1")]).toEqual([["d2", 0]]);
  });
});
