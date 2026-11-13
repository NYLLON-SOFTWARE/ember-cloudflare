import { useCallback, useEffect, useState } from "react";
import type { Reminder } from "@ember/protocol";
import { dismissReminder, fetchReminders } from "@/lib/api";

/** Whether a reminder has come due: its time is the past, or this very moment is as good as the past. */
export const isDue = (reminder: Reminder) => new Date(reminder.remindAt).getTime() <= Date.now();

/**
 * The reminders of the person signed in, as this tab knows them: what the Worker keeps (which a page
 * that loads hears whole, due or waiting), what the Workspace tells it as each one comes due, and what
 * this tab dismisses, on this page or any other.
 */
export function useReminders() {
  const [reminders, setReminders] = useState<Reminder[] | null>(null);

  useEffect(() => {
    let closed = false;
    fetchReminders().then(
      (loaded) => !closed && setReminders(loaded),
      // A page with no reminders shows none; one that can't ask tries again when the socket brings a due one.
      () => !closed && setReminders([]),
    );
    return () => {
      closed = true;
    };
  }, []);

  /** The Workspace has told this tab that a reminder has come due, which this tab keeps for its banner. */
  const cameDue = useCallback((reminder: Reminder) => {
    setReminders((current) => (current === null ? [reminder] : [...current.filter((other) => other.id !== reminder.id), reminder]));
  }, []);

  /** Dismisses a reminder here and at the Worker, taking it off the page at once either way. */
  const dismiss = useCallback((id: string) => {
    setReminders((current) => current?.filter((reminder) => reminder.id !== id) ?? current);
    void dismissReminder(id).catch(() => {});
  }, []);

  return { reminders, cameDue, dismiss };
}
