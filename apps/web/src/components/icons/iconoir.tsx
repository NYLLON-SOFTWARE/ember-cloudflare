import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

// Iconoir's regular icons (iconoir.com), from the release pinned here: iconoir 7.12.1. They're the
// rail's, which the project's owner chose over ember-rust's. iconoir/ holds their files from the
// package's icons/regular/, byte for byte, and icons.test.tsx checks each icon here against its file.

export type IconoirIconProps = SVGProps<SVGSVGElement>;

/** Iconoir's 24px grid and 1.5 stroke, named `iconoir-<name>` as lucide-react names its icons. */
function IconoirIcon({ name, className, ...props }: IconoirIconProps & { name: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      strokeWidth="1.5"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn(`iconoir-${name}`, className)}
      {...props}
    />
  );
}

/** How Iconoir draws a line: in the text's color, with round ends and corners. */
const LINE = { stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function Home(props: IconoirIconProps) {
  return (
    <IconoirIcon name="home" {...props}>
      <path d="M2 8L11.7317 3.13416C11.9006 3.04971 12.0994 3.0497 12.2683 3.13416L22 8" {...LINE} />
      <path d="M20 11V19C20 20.1046 19.1046 21 18 21H6C4.89543 21 4 20.1046 4 19V11" {...LINE} />
    </IconoirIcon>
  );
}

export function MultiBubble(props: IconoirIconProps) {
  return (
    <IconoirIcon name="multi-bubble" {...props}>
      <path
        d="M7.5 22C10.5376 22 13 19.5376 13 16.5C13 13.4624 10.5376 11 7.5 11C4.46243 11 2 13.4624 2 16.5C2 17.5018 2.26783 18.441 2.7358 19.25L2.275 21.725L4.75 21.2642C5.55898 21.7322 6.49821 22 7.5 22Z"
        {...LINE}
      />
      <path
        d="M15.2824 17.8978C16.2587 17.7405 17.1758 17.4065 18 16.9297L21.6 17.6L20.9297 14C21.6104 12.8233 22 11.4571 22 10C22 5.58172 18.4183 2 14 2C9.97262 2 6.64032 4.97598 6.08221 8.84884"
        {...LINE}
      />
    </IconoirIcon>
  );
}

export function Bell(props: IconoirIconProps) {
  return (
    <IconoirIcon name="bell" {...props}>
      <path
        d="M18 8.4C18 6.70261 17.3679 5.07475 16.2426 3.87452C15.1174 2.67428 13.5913 2 12 2C10.4087 2 8.88258 2.67428 7.75736 3.87452C6.63214 5.07475 6 6.70261 6 8.4C6 15.8667 3 18 3 18H21C21 18 18 15.8667 18 8.4Z"
        {...LINE}
      />
      <path
        d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21"
        {...LINE}
      />
    </IconoirIcon>
  );
}

export function Search(props: IconoirIconProps) {
  return (
    <IconoirIcon name="search" {...props}>
      <path d="M17 17L21 21" {...LINE} />
      <path
        d="M3 11C3 15.4183 6.58172 19 11 19C13.213 19 15.2161 18.1015 16.6644 16.6493C18.1077 15.2022 19 13.2053 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11Z"
        {...LINE}
      />
    </IconoirIcon>
  );
}

export function Box(props: IconoirIconProps) {
  return (
    <IconoirIcon name="box" {...props}>
      <path d="M10 12L14 12" {...LINE} />
      <path d="M3 3L21 3" {...LINE} />
      <path d="M21 7V20.4C21 20.7314 20.7314 21 20.4 21H3.6C3.26863 21 3 20.7314 3 20.4V7" {...LINE} />
    </IconoirIcon>
  );
}

export function SunLight(props: IconoirIconProps) {
  return (
    <IconoirIcon name="sun-light" {...props}>
      <path d="M12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18Z" {...LINE} />
      <path d="M22 12L23 12" {...LINE} />
      <path d="M12 2V1" {...LINE} />
      <path d="M12 23V22" {...LINE} />
      <path d="M20 20L19 19" {...LINE} />
      <path d="M20 4L19 5" {...LINE} />
      <path d="M4 20L5 19" {...LINE} />
      <path d="M4 4L5 5" {...LINE} />
      <path d="M1 12L2 12" {...LINE} />
    </IconoirIcon>
  );
}

export function HalfMoon(props: IconoirIconProps) {
  return (
    <IconoirIcon name="half-moon" {...props}>
      <path
        d="M3 11.5066C3 16.7497 7.25034 21 12.4934 21C16.2209 21 19.4466 18.8518 21 15.7259C12.4934 15.7259 8.27411 11.5066 8.27411 3C5.14821 4.55344 3 7.77915 3 11.5066Z"
        {...LINE}
      />
    </IconoirIcon>
  );
}

export function Computer(props: IconoirIconProps) {
  return (
    <IconoirIcon name="computer" {...props}>
      <path d="M2 21L17 21" {...LINE} />
      <path d="M21 21L22 21" {...LINE} />
      {/* As in Iconoir's file, the screen's outline has no round joins: its corners are curves already. */}
      <path
        d="M2 16.4V3.6C2 3.26863 2.26863 3 2.6 3H21.4C21.7314 3 22 3.26863 22 3.6V16.4C22 16.7314 21.7314 17 21.4 17H2.6C2.26863 17 2 16.7314 2 16.4Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </IconoirIcon>
  );
}
