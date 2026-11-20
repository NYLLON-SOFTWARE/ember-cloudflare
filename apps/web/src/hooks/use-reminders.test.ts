import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reminder } from "@ember/protocol";
import { dueReminderOf, useReminders } from "./use-reminders";

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

  it("keeps a reminder whose dismissal failed", async () => {
    const waiting = reminder("waiting", new Date(Date.now() + 60_000).toISOString());
    fetchRemindersMock.mockResolvedValue([waiting]);
    dismissMock.mockRejectedValue(new Error("gone"));
    const { result } = renderHook(() => useReminders());
    await waitFor(() => expect(result.current.reminders).toEqual([waiting]));

    await act(async () => {
      await result.current.dismiss("waiting").catch(() => {});
    });
    // The Worker didn't take it, so it stays: what's scheduled never silently disappears.
    expect(result.current.reminders).toEqual([waiting]);
    expect(dismissMock).toHaveBeenCalledWith("waiting");
  });

  it("keeps a due frame that arrived while a load was on its way, and believes a later answer over an older frame", async () => {
    const waiting = reminder("waiting", new Date(Date.now() + 90_000).toISOString());
    const older = reminder("older", new Date(Date.now() + 30_000).toISOString());
    const due = reminder("due", new Date().toISOString());
    let resolveAnswer: (reminders: Reminder[]) => void = () => {};
    fetchRemindersMock.mockImplementation(() => new Promise((resolve) => { resolveAnswer = resolve; }));

    // The load goes out and hangs, and the due frame arrives while it's out.
    const { result } = renderHook(() => useReminders());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => result.current.cameDue(due));

    // When the load finally answers, it couldn't have known of the frame, so the frame survives it.
    await act(async () => {
      resolveAnswer([waiting, older]);
    });
    await waitFor(() => expect(result.current.reminders?.map((r) => r.id)).toEqual([waiting.id, older.id, due.id]));

    // A later answer is believed over a frame it predates: dismissed elsewhere, or taken, it leaves.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      resolveAnswer([waiting]);
    });
    await waitFor(() => expect(result.current.reminders?.map((r) => r.id)).toEqual([waiting.id]));
  });

  it("doesn't let an answer taken before a dismissal bring what left back", async () => {
    const waiting = reminder("waiting", new Date(Date.now() + 60_000).toISOString());
    let resolveAnswer: (reminders: Reminder[]) => void = () => {};
    fetchRemindersMock.mockImplementation(() => new Promise((resolve) => { resolveAnswer = resolve; }));
    const { result } = renderHook(() => useReminders());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      resolveAnswer([waiting]);
    });
    await waitFor(() => expect(result.current.reminders).toEqual([waiting]));

    // Another load goes out, and the dismissal another tab made arrives while it's out.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => result.current.cameGone("waiting"));

    // Its answer was taken before the dismissal and would have the reminder still waiting; the tab knows better.
    await act(async () => {
      resolveAnswer([waiting]);
    });
    await waitFor(() => expect(result.current.reminders).toEqual([]));
  });

  it("ignores an older answer that lands after a newer one", async () => {
    const waiting = reminder("waiting", new Date(Date.now() + 60_000).toISOString());
    const due = reminder("due", new Date().toISOString());
    const answers: Array<(reminders: Reminder[]) => void> = [];
    fetchRemindersMock.mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }));
    const { result } = renderHook(() => useReminders());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => result.current.cameDue(due));

    // A second load goes out, so two hang at once; the newer one answers first, and the older one lands after it.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const [older = () => {}, newer = () => {}] = answers;
    await act(async () => {
      newer([waiting, due]);
    });
    await waitFor(() => expect(result.current.reminders?.map((r) => r.id)).toEqual(["waiting", "due"]));

    // The older answer was taken before the notice came due, and has no `due` in it.
    await act(async () => {
      older([waiting]);
    });
    // The older answer's list is stale, and the notice the newer one brought stays.
    expect(result.current.reminders?.map((r) => r.id)).toEqual(["waiting", "due"]);
  });

  it("trusts the Worker's telling that a reminder came due, whatever this clock says of its time", async () => {
    const later = reminder("later", new Date(Date.now() + 60_000).toISOString());
    fetchRemindersMock.mockResolvedValue([later]);
    dismissMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useReminders());
    await waitFor(() => expect(result.current.reminders).toEqual([later]));
    // Its time is still to come by this clock, so nothing finds it yet.
    expect(dueReminderOf(result.current.reminders, result.current.announcedDue)).toBeNull();

    // The Worker tells of it coming due while this tab's clock still has its time to come, and the
    // notice it brings is found by that telling, not by this clock, however far behind it runs.
    act(() => result.current.cameDue(later));
    expect(result.current.announcedDue).toEqual(new Set(["later"]));
    expect(dueReminderOf(result.current.reminders, result.current.announcedDue)).toEqual(later);

    // A load that answers with the reminder still there keeps the telling: it came due all the same.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(result.current.announcedDue).toEqual(new Set(["later"])));
    expect(dueReminderOf(result.current.reminders, result.current.announcedDue)).toEqual(later);

    // Done with it, the telling is forgotten with the reminder.
    await act(async () => {
      await result.current.dismiss("later");
    });
    expect(result.current.announcedDue).toEqual(new Set());
    expect(dueReminderOf(result.current.reminders, result.current.announcedDue)).toBeNull();
  });

  it("lets an answer that has a reminder gone take the Worker's telling of it with it", async () => {
    const later = reminder("later", new Date(Date.now() + 60_000).toISOString());
    let resolveAnswer: (reminders: Reminder[]) => void = () => {};
    fetchRemindersMock.mockImplementation(() => new Promise((resolve) => { resolveAnswer = resolve; }));
    const { result } = renderHook(() => useReminders());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => result.current.cameDue(later));
    expect(result.current.announcedDue).toEqual(new Set(["later"]));

    // Another load goes out, and its answer, taken after the telling, knows the reminder no more.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      resolveAnswer([]);
    });
    await waitFor(() => expect(result.current.reminders).toEqual([]));
    expect(result.current.announcedDue).toEqual(new Set());
    expect(dueReminderOf(result.current.reminders, result.current.announcedDue)).toBeNull();
  });

  it("doesn't let an answer taken before a dismissal here bring it back either", async () => {
    const waiting = reminder("waiting", new Date(Date.now() + 60_000).toISOString());
    let resolveAnswer: (reminders: Reminder[]) => void = () => {};
    fetchRemindersMock.mockImplementation(() => new Promise((resolve) => { resolveAnswer = resolve; }));
    dismissMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useReminders());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      resolveAnswer([waiting]);
    });
    await waitFor(() => expect(result.current.reminders).toEqual([waiting]));

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await result.current.dismiss("waiting");
    });

    await act(async () => {
      resolveAnswer([waiting]);
    });
    await waitFor(() => expect(result.current.reminders).toEqual([]));
  });
});

const isDueOf = (reminder: Reminder) => new Date(reminder.remindAt).getTime() <= Date.now();
