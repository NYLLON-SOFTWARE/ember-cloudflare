import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDraftCount } from "./use-draft-count";
import { navigate } from "./use-route";

beforeEach(() => localStorage.clear());

describe("useDraftCount", () => {
  it("counts someone's drafts, again whenever the app goes to a page or another tab changes one", () => {
    localStorage.setItem("composer-draft-u1-general", "<p>half a thought</p>");
    localStorage.setItem("composer-draft-u2-general", "<p>someone else's</p>");
    const { result } = renderHook(() => useDraftCount("u1"));
    expect(result.current).toBe(1);

    localStorage.setItem("composer-draft-u1-random/threads/m1", "<p>a reply</p>");
    act(() => navigate("/drafts"));
    expect(result.current).toBe(2);

    localStorage.removeItem("composer-draft-u1-general");
    act(() => void window.dispatchEvent(new StorageEvent("storage")));
    expect(result.current).toBe(1);
  });
});
