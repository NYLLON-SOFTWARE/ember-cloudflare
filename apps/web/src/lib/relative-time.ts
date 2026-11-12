const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago `at` was, in a list's few characters, as Slack's phone app says it: "now", "5m ago",
 * "7h ago" and "3d ago" within a week, then the date, with the year once it's another year's.
 */
export function relativeTime(at: string | Date, now: Date = new Date()): string {
  const then = new Date(at);
  const ago = now.getTime() - then.getTime();
  if (ago < MINUTE) return "now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h ago`;
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)}d ago`;
  const year = then.getFullYear() === now.getFullYear() ? undefined : "numeric";
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric", year });
}
