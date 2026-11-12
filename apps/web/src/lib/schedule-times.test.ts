import { describe, expect, it } from "vitest";
import { customTime, dateValue, mondayMorning, schedulePresets, sendTimeLabel, timeValue, tomorrowMorning } from "./schedule-times";

// Wednesday 11 November 2026, at 10:30 PM.
const wednesdayNight = new Date(2026, 10, 11, 22, 30);

describe("Scheduling times", () => {
  it("offers tomorrow and next Monday, at 9:00 AM", () => {
    expect(tomorrowMorning(wednesdayNight)).toEqual(new Date(2026, 10, 12, 9));
    expect(mondayMorning(wednesdayNight)).toEqual(new Date(2026, 10, 16, 9));
    expect(schedulePresets(wednesdayNight).map(({ at }) => at)).toEqual([new Date(2026, 10, 12, 9), new Date(2026, 10, 16, 9)]);
    expect(schedulePresets(wednesdayNight)[0]!.label).toMatch(/^Tomorrow at 9:00/);
    expect(schedulePresets(wednesdayNight)[1]!.label).toMatch(/^Monday at 9:00/);
  });

  it("offers next week's Monday on a Monday, and only tomorrow on a Sunday", () => {
    expect(mondayMorning(new Date(2026, 10, 16, 8))).toEqual(new Date(2026, 10, 23, 9));
    expect(schedulePresets(new Date(2026, 10, 15, 12)).map(({ at }) => at)).toEqual([new Date(2026, 10, 16, 9)]);
    // Across a month's end.
    expect(tomorrowMorning(new Date(2026, 10, 30, 12))).toEqual(new Date(2026, 11, 1, 9));
  });

  it("says when a message goes: today, tomorrow, or on its day, with the year when it isn't this one", () => {
    expect(sendTimeLabel(new Date(2026, 10, 11, 23).getTime(), wednesdayNight)).toMatch(/^Today at 11:00/);
    expect(sendTimeLabel(new Date(2026, 10, 12, 9).getTime(), wednesdayNight)).toMatch(/^Tomorrow at 9:00/);
    expect(sendTimeLabel(new Date(2026, 10, 16, 9).getTime(), wednesdayNight)).toMatch(/Monday.*November.*16.* at 9:00/);
    expect(sendTimeLabel(new Date(2027, 0, 4, 9).getTime(), wednesdayNight)).toMatch(/2027/);
  });

  it("reads a custom time from a date field and a time field, refusing a date that doesn't exist", () => {
    expect(customTime("2026-11-12", "14:05")).toEqual(new Date(2026, 10, 12, 14, 5));
    expect(customTime(dateValue(wednesdayNight), timeValue(wednesdayNight))).toEqual(wednesdayNight);
    for (const [date, time] of [["2026-02-30", "09:00"], ["", "09:00"], ["2026-11-12", ""], ["12/11/2026", "09:00"]]) {
      expect(customTime(date!, time!), `${date} ${time}`).toBeNull();
    }
  });
});
