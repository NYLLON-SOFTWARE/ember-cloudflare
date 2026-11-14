import { useEffect, useState } from "react";
import type { PersonMood } from "@ember/protocol";
import { currentMood } from "@/lib/mood";
import { cn } from "@/lib/utils";

/**
 * What someone wears beside their name now, which comes off by itself at its clear time: the workspace
 * sets no alarm for a mood, so the page wearing it arranges a render for when it's due, or it would
 * stay beside their name past the time it was saved to come off.
 */
export function useWornMood(mood: PersonMood | null | undefined): PersonMood | null {
  const worn = currentMood(mood);
  const [, comeOff] = useState(0);
  useEffect(() => {
    if (!worn?.clearAt) return;
    const timer = setTimeout(() => comeOff((wears) => wears + 1), Date.parse(worn.clearAt) - Date.now());
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
