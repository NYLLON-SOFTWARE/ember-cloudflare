import type { PersonMood } from "@ember/protocol";

/** Someone's mood as the pages show it: what they wear until it comes off by itself, or none once its clear time has passed. */
export function currentMood(mood: PersonMood | null | undefined, now = new Date()): PersonMood | null {
  return mood !== undefined && mood !== null && (mood.clearAt === null || Date.parse(mood.clearAt) > now.getTime()) ? mood : null;
}

/** What the Clear-at menu says: when a mood put on comes off by itself, or never. */
export type ClearChoice = "hour" | "four" | "today" | "week" | "never";

/** The Clear-at menu, in the order it lists them. */
export const CLEAR_CHOICES: ReadonlyArray<{ value: ClearChoice; label: string }> = [
  { value: "hour", label: "In an hour" },
  { value: "four", label: "In 4 hours" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "never", label: "Never" },
];

/** When a mood put on `now` comes off by itself, by the choice picked, as an ISO time, or null for never. */
export function clearAtOf(choice: ClearChoice, now = new Date()): string | null {
  const at = new Date(now);
  switch (choice) {
    // An hour or four wears as time itself, not as the clock counts it, so a mood comes off on time
    // across a change to or from daylight saving time too.
    case "hour":
      at.setTime(at.getTime() + 3_600_000);
      break;
    case "four":
      at.setTime(at.getTime() + 4 * 3_600_000);
      break;
    case "today":
      at.setDate(at.getDate() + 1);
      at.setHours(0, 0, 0, 0);
      break;
    case "week":
      // Saturday's end, whatever day it is today.
      at.setDate(at.getDate() + ((6 - at.getDay() + 7) % 7));
      at.setHours(23, 59, 59, 999);
      break;
    case "never":
      return null;
  }
  return at.toISOString();
}

/** The instant of the midnight `at` falls in, by this clock. */
const midnightOf = (at: number): number => {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

/** The Clear-at choice a worn mood's clear time was made by, by how far off it is. */
export function choiceOf(clearAt: string, now = new Date()): ClearChoice {
  const until = Date.parse(clearAt);
  // Today is the choice a mood that comes off at a midnight was made by, whatever the hours left since
  // it was saved, so it reads back as Today past midnight the day it was saved for too.
  if (until === midnightOf(until)) return "today";
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);
  const weekEnd = new Date(dayEnd);
  weekEnd.setDate(weekEnd.getDate() + ((6 - weekEnd.getDay() + 7) % 7));
  // "This week" comes off at Saturday's end and Today at the day's, by this clock, as clearAtOf makes
  // them. They're told by the instant they name before the hours left to it, which a Saturday evening's
  // week counts a few of; Saturday's end is told first, since on that day it is the day's end too.
  if (until === weekEnd.getTime()) return "week";
  if (until === dayEnd.getTime()) return "today";
  const hours = (until - now.getTime()) / 3_600_000;
  if (hours <= 2) return "hour";
  if (hours <= 8) return "four";
  // Whatever else comes off by the day's end was made by Today, and anything on through Saturday's
  // end, by This week.
  if (until <= dayEnd.getTime()) return "today";
  if (until <= weekEnd.getTime()) return "week";
  return "never";
}
