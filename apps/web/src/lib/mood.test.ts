import { describe, expect, it } from "vitest";
import { choiceOf, clearAtOf, currentMood, type ClearChoice } from "./mood";

/** Noon on Thursday, October 15th, 2026, by the clock these tests run by. */
const now = new Date(2026, 9, 15, 12, 0);

/** `hours` from `now`, as a mood's clear time is given. */
const fromNow = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();

describe("Your mood", () => {
  it("counts a mood whose clear time has passed as none, and one without a time as worn until it's taken off", () => {
    const worn = { emoji: "😌", text: "Pairing on the compiler", clearAt: null };
    expect(currentMood(worn, now)).toEqual(worn);
    expect(currentMood({ ...worn, clearAt: fromNow(1) }, now)).toEqual({ ...worn, clearAt: fromNow(1) });
    expect(currentMood({ ...worn, clearAt: fromNow(-1) }, now)).toBeNull();
    expect(currentMood({ ...worn, clearAt: now.toISOString() }, now)).toBeNull();
    expect(currentMood(null, now)).toBeNull();
    expect(currentMood(undefined, now)).toBeNull();
  });

  it("says when a mood put on comes off by itself, by the choice picked", () => {
    expect(clearAtOf("never", now)).toBeNull();
    expect(new Date(clearAtOf("hour", now)!).getTime()).toBe(now.getTime() + 3_600_000);
    expect(new Date(clearAtOf("four", now)!).getTime()).toBe(now.getTime() + 4 * 3_600_000);
    // "Today" ends the day, and "This week" Saturday's end, by this clock.
    expect(new Date(clearAtOf("today", now)!).getTime()).toBe(new Date(2026, 9, 16, 0, 0, 0, 0).getTime());
    expect(new Date(clearAtOf("week", now)!).getTime()).toBe(new Date(2026, 9, 17, 23, 59, 59, 999).getTime());
  });

  it("picks the choice a worn mood's clear time was made by, by how far off it is", () => {
    for (const [hours, choice] of [[1, "hour"], [2, "hour"], [3, "four"], [8, "four"]] as Array<[number, ClearChoice]>) expect(choiceOf(fromNow(hours), now)).toBe(choice);
    expect(choiceOf(new Date(2026, 9, 15, 21, 0).toISOString(), now)).toBe("today");
    expect(choiceOf(new Date(2026, 9, 17, 12, 0).toISOString(), now)).toBe("week");
    expect(choiceOf(new Date(2026, 9, 20, 12, 0).toISOString(), now)).toBe("never");
  });

  it("reads a mood saved back as the choice it was made by, past midnight the day it was saved for too", () => {
    for (const choice of ["hour", "four", "today", "week"] as ClearChoice[]) expect(choiceOf(clearAtOf(choice, now)!, now)).toBe(choice);
    // Saved as Today just before midnight, it comes off at one, and reads back as Today after it.
    const late = new Date(2026, 9, 15, 23, 59, 30);
    expect(choiceOf(clearAtOf("today", late)!, new Date(2026, 9, 16, 0, 0, 30))).toBe("today");
  });

  it("wears an hour or four as time itself, so a change to or from daylight saving time doesn't take one", () => {
    const shift = nextShift(Date.UTC(2026, 0, 1));
    // Where the clock never changes (UTC), the hours it counts and time itself agree.
    if (shift === null) return;
    const before = new Date(shift - 30 * 60_000);
    expect(new Date(clearAtOf("hour", before)!).getTime()).toBe(before.getTime() + 3_600_000);
    expect(new Date(clearAtOf("four", before)!).getTime()).toBe(before.getTime() + 4 * 3_600_000);
  });
});

/** The first moment of the year after `from` that this clock sits differently from where it starts, or null where it never does. */
function nextShift(from: number): number | null {
  const offset = new Date(from).getTimezoneOffset();
  for (let at = from; at < from + 366 * 86_400_000; at += 1_800_000) if (new Date(at).getTimezoneOffset() !== offset) return at;
  return null;
}
