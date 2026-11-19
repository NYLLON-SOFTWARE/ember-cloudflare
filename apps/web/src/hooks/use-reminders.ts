import { createContext, useCallback, useEffect, useRef, useState } from "react";
import type { Reminder } from "@ember/protocol";
import { dismissReminder, fetchReminders } from "@/lib/api";

/** Whether a reminder has come due: its time is the past, or this very moment is as good as the past. */
export const isDue = (reminder: Reminder) => new Date(reminder.remindAt).getTime() <= Date.now();

/** Dismissing a reminder as this hook does, which every tab of theirs hears of: what Remind me takes one back with. */
export const DismissReminder = createContext<(id: string) => Promise<void>>(async () => {});

/**
 * The reminders of the person signed in, as this tab knows them: what the Worker keeps when the page
 * loads — and again whenever the tab is shown again or comes back online, as the sidebar has this load
 * again whenever the socket connects too, so whatever came due while away is caught up — what the
 * Workspace tells this tab as each one comes due or is dismissed in another tab, and what this tab
 * dismisses itself.
 */
export function useReminders() {
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  // Reminders this tab heard of by frame, with when each arrived. A load that started after one arrived
  // carries it (its snapshot couldn't have known it); one the frame predates is the Worker's truth,
  // dismissed elsewhere included, and the frame leaves.
  const frameArrived = useRef(new Map<string, { reminder: Reminder; at: number }>());
  // Reminders heard gone, by frame or dismissed here, with when each left. An answer taken before one
  // left doesn't know it has, and mustn't bring it back; one taken after has it gone already.
  const goneAt = useRef(new Map<string, number>());
  // When the newest answer this tab took went out. An older one that lands after it is out of order, and
  // leaves what's shown as it is, since what's newer has spoken since.
  const askedNewest = useRef(0);

  const load = useCallback(() => {
    const askedAt = Date.now();
    void fetchReminders().then((loaded) => {
      if (askedAt < askedNewest.current) return;
      askedNewest.current = askedAt;
      const known = loaded.filter(({ id }) => (goneAt.current.get(id) ?? 0) < askedAt);
      const arrived = [...frameArrived.current].filter(([, { at }]) => at >= askedAt);
      const kept = arrived
        .filter(([id]) => !known.some((r) => r.id === id))
        .map(([, { reminder }]) => reminder);
      frameArrived.current = new Map(arrived.filter(([id]) => kept.some((r) => r.id === id)));
      // What left before this answer went out the Worker has gone already; this tab needn't remember those.
      goneAt.current = new Map([...goneAt.current].filter(([, at]) => at >= askedAt));
      setReminders(kept.length > 0 ? [...known, ...kept] : known);
    }, () => {});
  }, []);

  useEffect(() => {
    load();
    const shown = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", shown);
    window.addEventListener("online", load);
    return () => {
      document.removeEventListener("visibilitychange", shown);
      window.removeEventListener("online", load);
    };
  }, [load]);

  /** The Workspace has told this tab that a reminder has come due, which this tab keeps for its banner. */
  const cameDue = useCallback((reminder: Reminder) => {
    frameArrived.current.set(reminder.id, { reminder, at: Date.now() });
    setReminders((current) => (current === null ? [reminder] : [...current.filter((other) => other.id !== reminder.id), reminder]));
  }, []);

  /** Another tab of theirs dismissed a reminder, which leaves this one's corner as well. */
  const cameGone = useCallback((id: string) => {
    goneAt.current.set(id, Date.now());
    frameArrived.current.delete(id);
    setReminders((current) => current?.filter((reminder) => reminder.id !== id) ?? current);
  }, []);

  /**
   * Dismisses a reminder here and at the Worker: it leaves the page only once the Worker has taken it,
   * staying through a failure so what's scheduled never silently disappears.
   */
  const dismiss = useCallback(async (id: string) => {
    await dismissReminder(id);
    goneAt.current.set(id, Date.now());
    frameArrived.current.delete(id);
    setReminders((current) => current?.filter((reminder) => reminder.id !== id) ?? current);
  }, []);

  return { reminders, cameDue, cameGone, dismiss, load };
}
