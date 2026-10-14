import type { RoomIconName } from "@ember/protocol";
import { cn } from "@/lib/utils";

// A room's icon, from ember-rust's catalog of Lucide icons in lucide/. vite.config.ts serves each one
// as an SVG of its own, so a page fetches only the icons its rooms have, where ember-rust draws them
// into its pages on the server.

/** Where icon `name` is served. */
export const roomIconUrl = (name: RoomIconName) => `/lucide/icons/${name}.svg`;

/**
 * What the picker calls an icon, as ember-rust's `channel_icon_label` does (helpers/icons.rs): the
 * catalog's label, which is the name's words capitalized, such as "Gamepad 2", or "Default hashtag".
 */
export function roomIconLabel(name: RoomIconName | null): string {
  if (!name) return "Default hashtag";
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface Props {
  icon: RoomIconName | null;
  /** The icon's width and height in pixels. `#` takes the font size `className` gives. */
  size: number;
  className?: string;
}

/**
 * ember-rust's `channel_icon` (helpers/icons.rs): the room's Lucide icon in the color of the text
 * around it, which an SVG drawn as a mask over that color takes, or `#` for a room without one.
 */
export function RoomIcon({ icon, size, className }: Props) {
  return (
    <span aria-hidden="true" className={cn(icon && "inline-flex items-center justify-center", className)}>
      {icon ? (
        <span
          data-icon={icon}
          className="block shrink-0 bg-current mask-contain mask-center mask-no-repeat"
          style={{ width: size, height: size, maskImage: `url(${roomIconUrl(icon)})` }}
        />
      ) : (
        "#"
      )}
    </span>
  );
}
