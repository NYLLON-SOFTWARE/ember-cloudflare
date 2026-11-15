import { useEffect, useState } from "react";

/**
 * The time in `timeZone`, as "2:51 AM", kept current to the minute, or null without a time zone or with
 * one this browser doesn't know.
 */
export function useLocalTime(timeZone: string | null | undefined): string | null {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!timeZone) return;
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [timeZone]);
  if (!timeZone) return null;
  try {
    return now.toLocaleTimeString(undefined, { timeZone, hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}
