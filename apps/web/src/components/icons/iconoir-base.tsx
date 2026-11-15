import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

// What every Iconoir icon here is drawn with (iconoir.tsx, iconoir-more.tsx): its svg, and the attributes
// Iconoir's files give their shapes.

export type IconoirIconProps = SVGProps<SVGSVGElement>;

/**
 * Iconoir's 24px grid and 1.5 stroke, named `iconoir-<name>` as Iconoir's stylesheet names its icons. An icon
 * is hidden from screen readers unless it has an `aria-label`, as the setup help's pictures of buttons do.
 */
export function IconoirIcon({ name, className, ...props }: IconoirIconProps & { name: string }) {
  const named = props["aria-label"] !== undefined;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      strokeWidth="1.5"
      fill="none"
      role={named ? "img" : undefined}
      aria-hidden={named ? undefined : "true"}
      focusable="false"
      className={cn(`iconoir-${name}`, className)}
      {...props}
    />
  );
}

/** How Iconoir draws a line: in the text's color, with round ends and corners. */
export const LINE = { stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** A dot, which Iconoir fills as well as outlines. */
export const DOT = { fill: "currentColor", ...LINE } as const;

/** A line with round ends whose corners Iconoir leaves sharp. */
export const ROUND_ENDS = { stroke: "currentColor", strokeLinecap: "round" } as const;

/** An outline whose corners are curves already, so Iconoir gives it neither round ends nor round joins. */
export const OUTLINE = { stroke: "currentColor", strokeWidth: "1.5" } as const;
