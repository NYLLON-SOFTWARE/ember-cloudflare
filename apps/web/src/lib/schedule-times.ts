import { MAX_SCHEDULE_AHEAD_MS } from "@ember/protocol";

// When a message can be scheduled for, as Slack's Schedule message menu offers it, and how its times read.

/** A time the Schedule message menu offers, with what it says. */
export interface SchedulePreset {
  label: string;
  at: Date;
}

/** `day` at 9:00 AM, in this browser's time zone. */
function nineOn(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0);
}

/** The day `days` after `now`'s. */
function daysAfter(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

/** 9:00 AM tomorrow. */
export const tomorrowMorning = (now: Date) => nineOn(daysAfter(now, 1));

/** 9:00 AM next Monday: the first Monday after today, a week on when today is one. */
export const mondayMorning = (now: Date) => nineOn(daysAfter(now, ((8 - now.getDay()) % 7) || 7));

/**
 * The menu's times, as Slack offers them: tomorrow at 9:00 AM, and Monday at 9:00 AM, unless that's
 * tomorrow, as it is on a Sunday.
 */
export function schedulePresets(now: Date): SchedulePreset[] {
  const tomorrow = tomorrowMorning(now);
  const monday = mondayMorning(now);
  const presets = [{ label: `Tomorrow at ${clock(tomorrow)}`, at: tomorrow }];
  if (monday.getTime() !== tomorrow.getTime()) presets.push({ label: `Monday at ${clock(monday)}`, at: monday });
  return presets;
}

/** A time of day as this browser writes it, such as 9:00 AM. */
export const clock = (at: Date) => at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** How many days `at`'s day is after `now`'s, counting a day that a clock change shortens or lengthens as one. */
const daysAhead = (at: Date, now: Date) => Math.round((daysAfter(at, 0).getTime() - daysAfter(now, 0).getTime()) / (24 * 60 * 60 * 1000));

/**
 * When a scheduled message goes, as the menu and the list say it: today, tomorrow, or its weekday within
 * the week, as Monday at 9:00 AM, or else its date, with the year only when it's not this one, at its time.
 */
export function sendTimeLabel(sendAt: number, now: Date): string {
  const at = new Date(sendAt);
  const days = daysAhead(at, now);
  if (days === 0) return `Today at ${clock(at)}`;
  if (days === 1) return `Tomorrow at ${clock(at)}`;
  const day = at.toLocaleDateString(undefined, {
    weekday: "long",
    ...((days < 0 || days >= 7) && { month: "long", day: "numeric" }),
    ...(at.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
  return `${day} at ${clock(at)}`;
}

/** `sendTimeLabel` within a sentence, as "1 scheduled message, tomorrow at 9:00 AM": only today and tomorrow aren't names. */
export const sendTimeInSentence = (sendAt: number, now: Date) => sendTimeLabel(sendAt, now).replace(/^(Today|Tomorrow)\b/, (word) => word.toLowerCase());

/**
 * When a scheduled message goes, as a phone's notice says it, short enough to fit: Today or Tomorrow at
 * 9:00 AM, as the list says them, or Mon, Nov 16, 9:00 AM.
 */
export function shortSendTime(sendAt: number, now: Date): string {
  const at = new Date(sendAt);
  if (daysAhead(at, now) <= 1 && daysAhead(at, now) >= 0) return sendTimeLabel(sendAt, now);
  // The day and the time apart, joined as every engine is to read it: WebKit writes them as one with "at".
  const day = at.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(at.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
  return `${day}, ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** How many days ahead a message can be scheduled, as the room allows. */
export const SCHEDULE_AHEAD_DAYS = MAX_SCHEDULE_AHEAD_MS / (24 * 60 * 60 * 1000);

/** The last moment a message can be scheduled for from `now`, as the room allows. */
export const latestSendTime = (now: Date) => new Date(now.getTime() + MAX_SCHEDULE_AHEAD_MS);

/** A date as a date field takes it: YYYY-MM-DD, in this browser's time zone. */
export const dateValue = (at: Date) => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

/** A time of day as a time field takes it: HH:MM, on a 24-hour clock. */
export const timeValue = (at: Date) => `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;

/** The moment a date field's and a time field's values name, in this browser's time zone, or null when they name none. */
export function customTime(date: string, time: string): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const hour = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !hour) return null;
  const [year, month, dayOfMonth] = [Number(day[1]), Number(day[2]), Number(day[3])];
  const at = new Date(year, month - 1, dayOfMonth, Number(hour[1]), Number(hour[2]));
  return at.getMonth() === month - 1 && at.getDate() === dayOfMonth ? at : null;
}
