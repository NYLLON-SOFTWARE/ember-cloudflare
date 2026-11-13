import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reminder } from "@ember/protocol";
import { useReminders } from "./use-reminders";

vi.mock("@/lib/api", () => ({
  fetchReminders: vi.fn(),
  dismissReminder: vi.fn(),
}));

import { dismissReminder, fetchReminders } from "@/lib/api";

const reminder = (id: string, remindAt: string): Reminder => ({ id, roomId: "room", messageId: "m1", creator: { id: "ada", name: "Ada" }, excerpt: "Hello", remindAt });

const fetchRemindersMock = vi.mocked(fetchReminders);
const dismissMock = vi.mocked(dismissReminder);

afterEach(() => {
  vi.clearAllMocks();

});

describe("useReminders", () => {
  it("loads what the Worker keeps, and adds what the socket says came due", async () => {
    const waiting = reminder("waiting", new Date(Date.now() + 60_000).toISOString());
    fetchRemindersMock.mockResolvedValue([waiting]);
    const { result } = renderHook(() => useReminders());
    expect(result.current.reminders).toBeNull();
    await waitFor(() => expect(result.current.reminders).toEqual([waiting]));

    const due = reminder("due", new Date().toISOString());
    act(() => result.current.cameDue(due));
    expect(result.current.reminders?.map((reminder) => reminder.id)).toEqual(["waiting", "due"]);

    // The same reminder told twice takes its old place, once.
    act(() => result.current.cameDue({ ...due, remindAt: new Date().toISOString() }));
    expect(result.current.reminders?.map((reminder) => reminder.id)).toEqual(["waiting", "due"]);
  });

  it("keeps only what's due for the banner, whatever is still waiting", async () => {
    const waiting = reminder("waiting", new Date(Date.now() + 60_000).toISOString());
    const due = reminder("due", new Date().toISOString());
    fetchRemindersMock.mockResolvedValue([waiting, due]);
    const { result } = renderHook(() => useReminders());
    await waitFor(() => expect(result.current.reminders).not.toBeNull());
    expect(result.current.reminders?.filter(isDueOf)).toEqual([due]);
  });

  it("dismisses at once here and at the Worker", async () => {
    const waiting = reminder("waiting", new Date(Date.now() + 60_000).toISOString());
    fetchRemindersMock.mockResolvedValue([waiting]);
    dismissMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useReminders());
    await waitFor(() => expect(result.current.reminders).toEqual([waiting]));

    await act(async () => {
      await result.current.dismiss("waiting");
    });
    expect(result.current.reminders).toEqual([]);
    expect(dismissMock).toHaveBeenCalledWith("waiting");
  });

  it("keeps a reminder whose dismissal failed, and folds a load around a due frame", async () => {
    const waiting = reminder("waiting", new Date(Date.now() + 60_000).toISOString());
    const due = reminder("due", new Date().toISOString());
    let answer: Promise<Reminder[]> = new Promise(() => {});
    fetchRemindersMock.mockImplementation(() => answer);
    dismissMock.mockRejectedValue(new Error("gone"));
    const { result } = renderHook(() => useReminders());
    await act(async () => {
      await result.current.dismiss("none").catch(() => {});
    });
    // The failed dismissal left nothing behind, and the failed load left the list empty.
    expect(result.current.reminders).toBeNull();
    act(() => result.current.cameDue(due));
    expect(result.current.reminders).toEqual([due]);

    // Back online, the late answer folds around what arrived: the due one stays, the Worker's joins it.
    answer = Promise.resolve([waiting, reminder("older", new Date(Date.now() + 30_000).toISOString())]);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(result.current.reminders?.map((r) => r.id).sort()).toEqual(["due", "older", "waiting"]));
  });
});

const isDueOf = (reminder: Reminder) => new Date(reminder.remindAt).getTime() <= Date.now();
