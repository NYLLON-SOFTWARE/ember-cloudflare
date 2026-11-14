import { MAX_SCHEDULE_AHEAD_MS } from "@ember/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  customTime,
  dateValue,
  latestSendTime,
  mondayMorning,
  schedulePresets,
  sendTimeInSentence,
  sendTimeLabel,
  shortSendTime,
  timeValue,
  tomorrowMorning,
} from "./schedule-times";

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

  it("says when a message goes: today, tomorrow, its weekday within the week, or its date, with the year when it isn't this one", () => {
    expect(sendTimeLabel(new Date(2026, 10, 11, 23).getTime(), wednesdayNight)).toMatch(/^Today at 11:00/);
    expect(sendTimeLabel(new Date(2026, 10, 12, 9).getTime(), wednesdayNight)).toMatch(/^Tomorrow at 9:00/);
    expect(sendTimeLabel(new Date(2026, 10, 16, 9).getTime(), wednesdayNight)).toMatch(/^Monday at 9:00/);
    expect(sendTimeLabel(new Date(2026, 10, 18, 9).getTime(), wednesdayNight)).toMatch(/^Wednesday, November 18 at 9:00/);
    expect(sendTimeLabel(new Date(2027, 0, 4, 9).getTime(), wednesdayNight)).toMatch(/2027/);
  });

  it("names only today and tomorrow in lower case within a sentence, and says the time short for a phone", () => {
    expect(sendTimeInSentence(new Date(2026, 10, 12, 9).getTime(), wednesdayNight)).toMatch(/^tomorrow at 9:00/);
    expect(sendTimeInSentence(new Date(2026, 10, 16, 9).getTime(), wednesdayNight)).toMatch(/^Monday at 9:00/);
    expect(sendTimeInSentence(new Date(2026, 10, 25, 9).getTime(), wednesdayNight)).toMatch(/^Wednesday, November 25/);
    expect(shortSendTime(new Date(2026, 10, 16, 9).getTime(), wednesdayNight)).toMatch(/^Mon, Nov 16, 9:00\sAM$/);
    expect(shortSendTime(new Date(2027, 0, 4, 9).getTime(), wednesdayNight)).toMatch(/^Mon, Jan 4, 2027, 9:00\sAM$/);
  });

  it("schedules no further ahead than the room allows", () => {
    // To any time on the last day, as the picker offers it.
    const last = new Date(wednesdayNight.getTime() + MAX_SCHEDULE_AHEAD_MS);
    expect(latestSendTime(wednesdayNight)).toEqual(new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999));
  });

  it("reads a custom time from a date field and a time field, refusing a date that doesn't exist", () => {
    expect(customTime("2026-11-12", "14:05")).toEqual(new Date(2026, 10, 12, 14, 5));
    expect(customTime(dateValue(wednesdayNight), timeValue(wednesdayNight))).toEqual(wednesdayNight);
    for (const [date, time] of [["2026-02-30", "09:00"], ["", "09:00"], ["2026-11-12", ""], ["12/11/2026", "09:00"]]) {
      expect(customTime(date!, time!), `${date} ${time}`).toBeNull();
    }
  });
});

describe("Scheduling across a clock change", () => {
  const zone = process.env.TZ;
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it("keeps tomorrow at 9:00 AM at 9:00 on the clock as New York springs forward and falls back", () => {
    process.env.TZ = "America/New_York";
    // Saturday 13 March 2027, 10:00 AM EST: clocks go forward overnight, so 9:00 AM EDT is 22 hours on.
    const springSaturday = new Date(Date.UTC(2027, 2, 13, 15));
    expect(tomorrowMorning(springSaturday).toISOString()).toBe("2027-03-14T13:00:00.000Z");
    expect(sendTimeLabel(tomorrowMorning(springSaturday).getTime(), springSaturday)).toMatch(/^Tomorrow at 9:00/);
    expect(mondayMorning(springSaturday).toISOString()).toBe("2027-03-15T13:00:00.000Z");
    // A time the change skips reads as the hour after it.
    expect(customTime("2027-03-14", "02:30")?.toISOString()).toBe("2027-03-14T07:30:00.000Z");

    // Saturday 31 October 2026, 10:00 PM EDT: clocks go back overnight, so 9:00 AM EST is 12 hours on.
    const fallSaturday = new Date(Date.UTC(2026, 10, 1, 2));
    expect(tomorrowMorning(fallSaturday).toISOString()).toBe("2026-11-01T14:00:00.000Z");
    expect(sendTimeLabel(tomorrowMorning(fallSaturday).getTime(), fallSaturday)).toMatch(/^Tomorrow at 9:00/);
    expect(dateValue(tomorrowMorning(fallSaturday))).toBe("2026-11-01");
  });
});
