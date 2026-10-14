import type { ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import add from "./campfire/add.svg";
import alert from "./campfire/alert.svg";
import arrowDown from "./campfire/arrow-down.svg";
import arrowLeft from "./campfire/arrow-left.svg";
import arrowUp from "./campfire/arrow-up.svg";
import check from "./campfire/check.svg";
import copyPaste from "./campfire/copy-paste.svg";
import download from "./campfire/download.svg";
import everyone from "./campfire/everyone.svg";
import lifebuoy from "./campfire/lifebuoy.svg";
import logout from "./campfire/logout.svg";
import menuDotsHorizontal from "./campfire/menu-dots-horizontal.svg";
import messagesAdd from "./campfire/messages-add.svg";
import qrCode from "./campfire/qr-code.svg";
import remove from "./campfire/remove.svg";
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

export function Add(props: CampfireIconProps) {
  return <CampfireIcon src={add} {...props} />;
}

export function Alert(props: CampfireIconProps) {
  return <CampfireIcon src={alert} {...props} />;
}

export function ArrowDown(props: CampfireIconProps) {
  return <CampfireIcon src={arrowDown} {...props} />;
}

export function ArrowLeft(props: CampfireIconProps) {
  return <CampfireIcon src={arrowLeft} {...props} />;
}

export function ArrowUp(props: CampfireIconProps) {
  return <CampfireIcon src={arrowUp} {...props} />;
}

export function Check(props: CampfireIconProps) {
  return <CampfireIcon src={check} {...props} />;
}

export function CopyPaste(props: CampfireIconProps) {
  return <CampfireIcon src={copyPaste} {...props} />;
}

export function Download(props: CampfireIconProps) {
  return <CampfireIcon src={download} {...props} />;
}

export function Everyone(props: CampfireIconProps) {
  return <CampfireIcon src={everyone} {...props} />;
}

export function Lifebuoy(props: CampfireIconProps) {
  return <CampfireIcon src={lifebuoy} {...props} />;
}

export function Logout(props: CampfireIconProps) {
  return <CampfireIcon src={logout} {...props} />;
}

export function MenuDotsHorizontal(props: CampfireIconProps) {
  return <CampfireIcon src={menuDotsHorizontal} {...props} />;
}

export function MessagesAdd(props: CampfireIconProps) {
  return <CampfireIcon src={messagesAdd} {...props} />;
}

export function QrCode(props: CampfireIconProps) {
  return <CampfireIcon src={qrCode} {...props} />;
}

export function Remove(props: CampfireIconProps) {
  return <CampfireIcon src={remove} {...props} />;
}

export function Share(props: CampfireIconProps) {
  return <CampfireIcon src={share} {...props} />;
}

export function Trash(props: CampfireIconProps) {
  return <CampfireIcon src={trash} {...props} />;
}
