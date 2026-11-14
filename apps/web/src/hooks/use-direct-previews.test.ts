import type { SidebarRoom } from "@ember/protocol";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tellRoomMessagesChanged } from "@/lib/room-changes";
import { PREVIEW_DELAY_MS, PREVIEW_REFRESH_MS, useDirectPreviews } from "./use-direct-previews";

const rooms: SidebarRoom[] = [
  { id: "d1", kind: "direct", members: [{ id: "u1", name: "Ada" }], activeAt: "2026-11-12T10:00:00.000Z", unread: false, involvement: "everything" },
  { id: "general", kind: "open", name: "general", icon: null, unread: false, involvement: "mentions" },
];

/** How many times the previews have been asked for. */
const asked = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === "/api/directs").length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ previews: [] }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useDirectPreviews", () => {
  it("asks again a moment after the DM open here has a message edited or deleted, but not another room", async () => {
    renderHook(() => useDirectPreviews(rooms, true, () => {}));
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS));
    expect(asked()).toBe(1);

    act(() => tellRoomMessagesChanged("general"));
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS));
    expect(asked()).toBe(1);

    act(() => tellRoomMessagesChanged("d1"));
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS));
    expect(asked()).toBe(2);
  });

  it("asks again every so often while the tab is shown, for the DMs not open here, and as it's shown again", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    renderHook(() => useDirectPreviews(rooms, true, () => {}));
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS));
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_REFRESH_MS));
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS));
    expect(asked()).toBe(2);

    // Not while it's hidden.
    visibility.mockReturnValue("hidden");
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_REFRESH_MS));
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS));
    expect(asked()).toBe(2);
    visibility.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS));
    expect(asked()).toBe(3);
  });

  it("asks nothing while it isn't enabled", async () => {
    renderHook(() => useDirectPreviews(rooms, false, () => {}));
    act(() => tellRoomMessagesChanged("d1"));
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_REFRESH_MS));
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS));
    expect(asked()).toBe(0);
  });
});
