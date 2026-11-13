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

    act(() => result.current.dismiss("waiting"));
    expect(result.current.reminders).toEqual([]);
    expect(dismissMock).toHaveBeenCalledWith("waiting");
  });
});

const isDueOf = (reminder: Reminder) => new Date(reminder.remindAt).getTime() <= Date.now();
