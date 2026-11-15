import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { tellDraftsChanged } from "@/lib/draft-keys";
import { useDraftCount } from "./use-draft-count";

beforeEach(() => localStorage.clear());

describe("useDraftCount", () => {
  it("counts someone's drafts, again as soon as this tab keeps or forgets one, or another tab changes one", () => {
    localStorage.setItem("composer-draft-u1-general", "<p>half a thought</p>");
    localStorage.setItem("composer-draft-u2-general", "<p>someone else's</p>");
    const { result } = renderHook(() => useDraftCount("u1"));
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
});
