import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cappedCount, useDraftCount } from "./draft-count";

afterEach(() => localStorage.clear());

describe("Counting your drafts", () => {
  it("counts your drafts with something in them, and again as the page is shown or another tab writes one", () => {
    localStorage.setItem("composer-draft-u1-general", "<p>Hello</p>");
    localStorage.setItem("composer-draft-u1-general/threads/7", "<p>Reply</p>");
    localStorage.setItem("composer-draft-u1-random", " ");
    localStorage.setItem("composer-draft-u2-general", "<p>Someone else's</p>");
    const { result } = renderHook(() => useDraftCount("u1"));
    expect(result.current).toBe(2);

    localStorage.setItem("composer-draft-u1-random", "<p>More</p>");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe(3);

    localStorage.removeItem("composer-draft-u1-general");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "composer-draft-u1-general" })));
    expect(result.current).toBe(2);
  });

  it("caps a count at 99+", () => {
    expect([1, 99, 100].map(cappedCount)).toEqual(["1", "99", "99+"]);
  });
});
