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

/** Whether `a` and `b` are on the same day. */
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * When a scheduled message goes, as its notice says it: today, tomorrow, or on its date, at its time,
 * with the year only when it's not this one.
 */
export function sendTimeLabel(sendAt: number, now: Date): string {
  const at = new Date(sendAt);
  if (sameDay(at, now)) return `Today at ${clock(at)}`;
  if (sameDay(at, daysAfter(now, 1))) return `Tomorrow at ${clock(at)}`;
  const day = at.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(at.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
  return `${day} at ${clock(at)}`;
}

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
