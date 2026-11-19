import { useEffect, useState } from "react";
import type { PersonMood } from "@ember/protocol";
import { currentMood } from "@/lib/mood";
import { cn } from "@/lib/utils";

/** The longest a delay may be, past which a browser fires a timer late or never: about 24.8 days. */
const TIMER_CAP_MS = 2_147_483_647;

/**
 * What someone wears beside their name now, which comes off by itself at its clear time: the workspace
 * sets no alarm for a mood, so the page wearing it arranges a render for when it's due, or it would
 * stay beside their name past the time it was saved to come off. A mood coming off further out than the
 * cap arms again at it until its time has come.
 */
export function useWornMood(mood: PersonMood | null | undefined): PersonMood | null {
  const worn = currentMood(mood);
  const [, comeOff] = useState(0);
  useEffect(() => {
    const clearAt = worn?.clearAt;
    if (!clearAt) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The longest a delay may be is about 24.8 days, past which a browser fires a timer late or never,
    // so a mood coming off further out arms again at that until its time has come.
    const arm = () => {
      const wait = Math.min(TIMER_CAP_MS, Math.max(0, Date.parse(clearAt) - Date.now()));
      timer = setTimeout(() => (Date.parse(clearAt) > Date.now() ? arm() : comeOff((wears) => wears + 1)), wait);
    };
    arm();
    return () => clearTimeout(timer);
  }, [worn]);
  return worn;
}

/**
 * What someone wears beside their name, where there's room for it: their emoji and words, muted, which
 * runs to an ellipsis rather than wrap. Nothing while they wear none, or while what they wear has come
 * off by its clear time.
 */
export function Mood({ mood, className }: { mood: PersonMood | null | undefined; className?: string }) {
  const worn = useWornMood(mood);
  if (!worn) return null;
  return (
    <span className={cn("min-w-0 truncate text-muted-foreground", className)}>
      {worn.emoji} {worn.text}
    </span>
  );
}
