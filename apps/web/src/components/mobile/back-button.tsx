import type { MouseEvent } from "react";
import { ArrowLeft } from "@/components/icons/iconoir";
import { goBack } from "@/hooks/use-route";
import { cn } from "@/lib/utils";

/** A round 44px button in a phone page's top bar. */
export const ROUND_BUTTON = "grid size-11 shrink-0 place-items-center rounded-full border bg-surface text-foreground hover:bg-hover";

interface Props {
  /** The page this one sits under, which Back goes up to when the app didn't open this page, or opened it from a page under it. */
  fallback: string;
  /** What it's called, "Back" unless it says where to. */
  label?: string;
  className?: string;
}

/**
 * Back, at the top left of a page that opens over another on a phone: it goes back the way the person
 * came, as the browser's Back and a phone's back gesture do, or up to `fallback` when the app didn't open
 * the page, or opened it from a page under it, as `goBack` says. Opened in a new tab, it's a link to `fallback`.
 */
export function BackButton({ fallback, label = "Back", className }: Props) {
  const back = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goBack(fallback);
  };
  return (
    <a href={fallback} aria-label={label} title={label} onClick={back} className={cn(ROUND_BUTTON, className)}>
      <ArrowLeft className="size-[22px]" />
    </a>
  );
}
