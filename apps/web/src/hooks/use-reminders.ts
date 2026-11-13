import { useCallback, useEffect, useState } from "react";
import type { Reminder } from "@ember/protocol";
import { dismissReminder, fetchReminders } from "@/lib/api";

/** Whether a reminder has come due: its time is the past, or this very moment is as good as the past. */
export const isDue = (reminder: Reminder) => new Date(reminder.remindAt).getTime() <= Date.now();

/**
 * The reminders of the person signed in, as this tab knows them: what the Worker keeps when the page
 * loads (and again whenever the tab is shown again, which is also when a disconnected socket comes
 * back), what the Workspace tells this tab as each one comes due or is dismissed in another tab, and
 * what this tab dismisses itself.
 */
export function useReminders() {
  const [reminders, setReminders] = useState<Reminder[] | null>(null);

  // What the Worker keeps now, folded into what this tab has heard since it asked, so a due frame that
  // arrived while the answer was on its way isn't lost, and an answer that fails leaves the tab as it is.
  const load = useCallback(() => {
    void fetchReminders().then(
      (loaded) =>
        setReminders((current) => {
          // Folded, not replaced: a due frame that arrived while this answer was on its way stays,
          // whatever a slightly older snapshot of the Worker's list knew of it.
          if (current === null) return loaded;
          return [...loaded, ...current.filter((reminder) => !loaded.some((other) => other.id === reminder.id))];
        }),
      // A page that can't ask keeps what it has; the next show or due frame catches it up.
      () => {},
    );
  }, []);

  useEffect(() => {
    load();
    // Shown again, or back online: a socket that died while a reminder came due catches up here.
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
    setReminders((current) => (current === null ? [reminder] : [...current.filter((other) => other.id !== reminder.id), reminder]));
  }, []);

  /** Another tab of theirs dismissed a reminder, which leaves this one's corner as well. */
  const cameGone = useCallback((id: string) => {
    setReminders((current) => current?.filter((reminder) => reminder.id !== id) ?? current);
  }, []);

  /**
   * Dismisses a reminder here and at the Worker: it leaves the page only once the Worker has taken it,
   * staying through a failure so what's scheduled never silently disappears.
   */
  const dismiss = useCallback(async (id: string) => {
    await dismissReminder(id);
    setReminders((current) => current?.filter((reminder) => reminder.id !== id) ?? current);
  }, []);

  return { reminders, cameDue, cameGone, dismiss };
}
