import type { ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import add from "./campfire/add.svg";
import alert from "./campfire/alert.svg";
import arrowDown from "./campfire/arrow-down.svg";
import arrowLeft from "./campfire/arrow-left.svg";
import arrowUp from "./campfire/arrow-up.svg";
import art from "./campfire/art.svg";
import boost from "./campfire/boost.svg";
import cancel from "./campfire/cancel.svg";
import check from "./campfire/check.svg";
import copyPaste from "./campfire/copy-paste.svg";
import crown from "./campfire/crown.svg";
import download from "./campfire/download.svg";
import everyone from "./campfire/everyone.svg";
import globe from "./campfire/globe.svg";
import laptop from "./campfire/laptop.svg";
import lifebuoy from "./campfire/lifebuoy.svg";
import logout from "./campfire/logout.svg";
import menuDotsHorizontal from "./campfire/menu-dots-horizontal.svg";
import messages from "./campfire/messages.svg";
import messagesAdd from "./campfire/messages-add.svg";
import messagesEmpty from "./campfire/messages-empty.svg";
import messagesOutlined from "./campfire/messages-outlined.svg";
import minus from "./campfire/minus.svg";
import mobilePhone from "./campfire/mobile-phone.svg";
import pencil from "./campfire/pencil.svg";
import personAdd from "./campfire/person-add.svg";
import qrCode from "./campfire/qr-code.svg";
import refresh from "./campfire/refresh.svg";
import remove from "./campfire/remove.svg";
import share from "./campfire/share.svg";
import textOptions from "./campfire/text-options.svg";
import transfer from "./campfire/transfer.svg";
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
  /** `color-icon`, as the translation buttons' globe is: in its own colors in both modes. */
  color: "",
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

export function Art(props: CampfireIconProps) {
  return <CampfireIcon src={art} {...props} />;
}

export function Boost(props: CampfireIconProps) {
  return <CampfireIcon src={boost} {...props} />;
}

export function Cancel(props: CampfireIconProps) {
  return <CampfireIcon src={cancel} {...props} />;
}

export function Check(props: CampfireIconProps) {
  return <CampfireIcon src={check} {...props} />;
}

export function CopyPaste(props: CampfireIconProps) {
  return <CampfireIcon src={copyPaste} {...props} />;
}

export function Crown(props: CampfireIconProps) {
  return <CampfireIcon src={crown} {...props} />;
}

export function Download(props: CampfireIconProps) {
  return <CampfireIcon src={download} {...props} />;
}

export function Everyone(props: CampfireIconProps) {
  return <CampfireIcon src={everyone} {...props} />;
}

export function Globe(props: CampfireIconProps) {
  return <CampfireIcon src={globe} {...props} />;
}

export function Laptop(props: CampfireIconProps) {
  return <CampfireIcon src={laptop} {...props} />;
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

export function Messages(props: CampfireIconProps) {
  return <CampfireIcon src={messages} {...props} />;
}

export function MessagesAdd(props: CampfireIconProps) {
  return <CampfireIcon src={messagesAdd} {...props} />;
}

export function MessagesEmpty(props: CampfireIconProps) {
  return <CampfireIcon src={messagesEmpty} {...props} />;
}

export function MessagesOutlined(props: CampfireIconProps) {
  return <CampfireIcon src={messagesOutlined} {...props} />;
}

export function Minus(props: CampfireIconProps) {
  return <CampfireIcon src={minus} {...props} />;
}

export function MobilePhone(props: CampfireIconProps) {
  return <CampfireIcon src={mobilePhone} {...props} />;
}

export function Pencil(props: CampfireIconProps) {
  return <CampfireIcon src={pencil} {...props} />;
}

export function PersonAdd(props: CampfireIconProps) {
  return <CampfireIcon src={personAdd} {...props} />;
}

export function QrCode(props: CampfireIconProps) {
  return <CampfireIcon src={qrCode} {...props} />;
}

export function Refresh(props: CampfireIconProps) {
  return <CampfireIcon src={refresh} {...props} />;
}

export function Remove(props: CampfireIconProps) {
  return <CampfireIcon src={remove} {...props} />;
}

export function Share(props: CampfireIconProps) {
  return <CampfireIcon src={share} {...props} />;
}

export function TextOptions(props: CampfireIconProps) {
  return <CampfireIcon src={textOptions} {...props} />;
}

export function Transfer(props: CampfireIconProps) {
  return <CampfireIcon src={transfer} {...props} />;
}

export function Trash(props: CampfireIconProps) {
  return <CampfireIcon src={trash} {...props} />;
}
