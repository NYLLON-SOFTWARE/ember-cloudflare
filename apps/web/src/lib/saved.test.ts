import type { SavedMarks } from "@ember/protocol";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetSaved, heardSaved, reloadSaved, useSavedMark } from "./saved";

const marking = (messageId: string): SavedMarks => ({ marks: [{ id: `s-${messageId}`, list: "saved", messageId }], openTodos: 0, overdueTodos: 0, savedItems: 1 });

/** Answers `/api/saved/marks` with `marks` once the function it answers is called, so a change can come first. */
function heldMarks(marks: SavedMarks): () => void {
  let release = () => {};
  const answered = new Promise<void>((resolve) => (release = resolve));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await answered;
      return Response.json(marks);
    }),
  );
  return release;
}

/** Whether message `messageId` is marked kept now. */
const isMarked = (messageId: string) => renderHook(() => useSavedMark(messageId)).result.current !== undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  forgetSaved();
});

describe("What you keep", () => {
  it("takes what it loads afresh", async () => {
    const release = heldMarks(marking("m1"));
    const loading = reloadSaved();
    release();
    await loading;
    expect(isMarked("m1")).toBe(true);
  });

  it("keeps a change heard while a load was on its way over what the load read before it", async () => {
    const release = heldMarks(marking("old"));
    const loading = reloadSaved();
    heardSaved(marking("new"));
    release();
    await loading;
    expect([isMarked("new"), isMarked("old")]).toEqual([true, false]);
  });

  it("drops a load still on its way for the person signed in before", async () => {
    const release = heldMarks(marking("ada's"));
    const loading = reloadSaved();
    forgetSaved();
    release();
    await loading;
    expect(isMarked("ada's")).toBe(false);
  });
});
