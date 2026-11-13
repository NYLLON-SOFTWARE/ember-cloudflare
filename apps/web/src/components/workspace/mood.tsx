import type { PersonMood } from "@ember/protocol";
import { currentMood } from "@/lib/mood";
import { cn } from "@/lib/utils";

/**
 * What someone wears beside their name, where there's room for it: their emoji and words, muted, which
 * runs to an ellipsis rather than wrap. Nothing while they wear none, or while what they wear has come
 * off by its clear time.
 */
export function Mood({ mood, className }: { mood: PersonMood | null | undefined; className?: string }) {
  const worn = currentMood(mood);
  if (!worn) return null;
  return (
    <span className={cn("min-w-0 truncate text-muted-foreground", className)}>
      {worn.emoji} {worn.text}
    </span>
  );
}
