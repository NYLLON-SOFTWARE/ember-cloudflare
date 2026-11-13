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
    case "hour":
      at.setHours(at.getHours() + 1);
      break;
    case "four":
      at.setHours(at.getHours() + 4);
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

/** The Clear-at choice a worn mood's clear time was made by, by how far off it is. */
export function choiceOf(clearAt: string, now = new Date()): ClearChoice {
  const until = Date.parse(clearAt);
  const hours = (until - now.getTime()) / 3_600_000;
  if (hours <= 2) return "hour";
  if (hours <= 8) return "four";
  // "Today" ends the day, and "This week" Saturday's end, by this clock, as clearAtOf makes them.
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  if (until <= end.getTime()) return "today";
  end.setDate(end.getDate() + ((6 - end.getDay() + 7) % 7));
  if (until <= end.getTime()) return "week";
  return "never";
}
