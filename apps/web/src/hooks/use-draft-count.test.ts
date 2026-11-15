import { act, renderHook } from "@testing-library/react";
import type { Room } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { tellDraftsChanged } from "@/lib/draft-keys";
import { useDraftCount } from "./use-draft-count";

beforeEach(() => localStorage.clear());

describe("useDraftCount", () => {
  it("counts someone's drafts, again as soon as this tab keeps or forgets one, or another tab changes one", () => {
    localStorage.setItem("composer-draft-u1-general", "<p>half a thought</p>");
    localStorage.setItem("composer-draft-u2-general", "<p>someone else's</p>");
    const { result } = renderHook(() => useDraftCount("u1", null));
    expect(result.current).toBe(1);

    // As the composer keeps one in the room shown.
    localStorage.setItem("composer-draft-u1-random/threads/m1", "<p>a reply</p>");
    act(() => tellDraftsChanged());
    expect(result.current).toBe(2);

    // As sending one forgets it.
    localStorage.removeItem("composer-draft-u1-general");
    act(() => tellDraftsChanged());
    expect(result.current).toBe(1);

    localStorage.removeItem("composer-draft-u1-random/threads/m1");
    act(() => void window.dispatchEvent(new StorageEvent("storage")));
    expect(result.current).toBe(0);
  });

  it("counts only the drafts Drafts & sent lists: in rooms you're still in, with something written in them", () => {
    const general: Room = { id: "general", name: "general", kind: "open", icon: null };
    const random: Room = { id: "random", name: "random", kind: "open", icon: null };
    localStorage.setItem("composer-draft-u1-general", "<p>half a thought</p>");
    localStorage.setItem("composer-draft-u1-general/threads/m1", "<p>a reply</p>");
    // A room you've left, or that's gone, and markup with nothing written in it.
    localStorage.setItem("composer-draft-u1-gone", "<p>in a room I left</p>");
    localStorage.setItem("composer-draft-u1-random", "<p></p>");
    const { result, rerender } = renderHook(({ rooms }) => useDraftCount("u1", rooms), { initialProps: { rooms: [general, random] } });
    expect(result.current).toBe(2);

    // Removed from general: its drafts go from the count as they do from the page.
    rerender({ rooms: [random] });
    expect(result.current).toBe(0);
  });
});
