import type { ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import alert from "./campfire/alert.svg";
import arrowDown from "./campfire/arrow-down.svg";
import arrowUp from "./campfire/arrow-up.svg";
import copyPaste from "./campfire/copy-paste.svg";
import lifebuoy from "./campfire/lifebuoy.svg";
import logout from "./campfire/logout.svg";
import messagesAdd from "./campfire/messages-add.svg";
import share from "./campfire/share.svg";
import trash from "./campfire/trash.svg";

// Campfire's filled icons. ember-rust serves these files unchanged from its reference app
// (once-campfire app/assets/images/) and draws them as black <img>s, inverted where the
// background is dark, so they're copied here byte for byte and drawn the same way.

const tones = {
  /** `colorize--black`, or a plain `.btn` icon: black, white in dark mode. */
  black: "dark:invert",
  /** `colorize--white` or `.btn--reversed`: white on the ink-colored button, black in dark mode. */
  reversed: "invert dark:invert-0",
  /** In a flash or a `.btn--negative` button: white on red in both modes. */
  white: "invert",
};

export type CampfireIconProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & { tone?: keyof typeof tones };

function CampfireIcon({ src, tone = "black", className, ...props }: CampfireIconProps & { src: string }) {
  return <img src={src} alt="" aria-hidden="true" draggable={false} className={cn("select-none", tones[tone], className)} {...props} />;
}

export function Alert(props: CampfireIconProps) {
  return <CampfireIcon src={alert} {...props} />;
}

export function ArrowDown(props: CampfireIconProps) {
  return <CampfireIcon src={arrowDown} {...props} />;
}

export function ArrowUp(props: CampfireIconProps) {
  return <CampfireIcon src={arrowUp} {...props} />;
}

export function CopyPaste(props: CampfireIconProps) {
  return <CampfireIcon src={copyPaste} {...props} />;
}

export function Lifebuoy(props: CampfireIconProps) {
  return <CampfireIcon src={lifebuoy} {...props} />;
}

export function Logout(props: CampfireIconProps) {
  return <CampfireIcon src={logout} {...props} />;
}

export function MessagesAdd(props: CampfireIconProps) {
  return <CampfireIcon src={messagesAdd} {...props} />;
}

export function Share(props: CampfireIconProps) {
  return <CampfireIcon src={share} {...props} />;
}

export function Trash(props: CampfireIconProps) {
  return <CampfireIcon src={trash} {...props} />;
}
