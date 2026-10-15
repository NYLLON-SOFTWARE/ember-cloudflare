import type { MouseEvent } from "react";
import { CopyPaste, QrCode, Share } from "@/components/icons/campfire";
import { QrCodeLink } from "@/components/qr-code-link";

// The buttons ember-rust puts beside a link to hand on, the join link and the sign-in link: its QR code,
// and its copy and share controllers (`link_to_zoom_qr_code`, `button_to_copy_to_clipboard` and
// `web_share_session_button`, crates/views/src/helpers/application.rs).

/** What a link's buttons are called, and what sharing it sends with it. */
export interface LinkSharing {
  qrCodeLabel: string;
  copyLabel: string;
  shareLabel: string;
  /** The title and text the system's share sheet gets with the link. */
  title: string;
  text: string;
}

/** Campfire's round `.btn` showing only an icon, as zz-ember.css sizes it in a panel: 36px, and 44px for fingers. */
export const ROUND_BUTTON =
  "grid size-9 flex-none cursor-pointer place-items-center rounded-full border bg-background touch:size-11 disabled:pointer-events-none disabled:opacity-50";

/** Campfire's `btn--success` (buttons.css), which the copy button plays each time it copies. */
const COPIED = ["motion-safe:animate-success", "motion-safe:[&>img]:animate-zoom-fade"];

/** `url`'s QR code, copy and share buttons, each styled with `className`. */
export function LinkButtons({ url, sharing, className }: { url: string; sharing: LinkSharing; className: string }) {
  // As ember-rust's web_share_controller.js decides, before it's ever asked to share.
  const canShare = "canShare" in navigator;

  return (
    <>
      <QrCodeLink url={url} className={className}>
        <span className="sr-only">{sharing.qrCodeLabel}</span>
        <QrCode className="size-[1.3em]" />
      </QrCodeLink>
      <button type="button" onClick={(event) => void copy(event, url)} className={className}>
        <span className="sr-only">{sharing.copyLabel}</span>
        <CopyPaste className="size-[1.3em]" />
      </button>
      {canShare && (
        <button type="button" onClick={() => void share(url, sharing)} className={className}>
          <span className="sr-only">{sharing.shareLabel}</span>
          <Share className="size-[1.3em]" />
        </button>
      )}
    </>
  );
}

/**
 * Copies `url`, then plays the button's success animation from the start, as ember-rust's
 * copy_to_clipboard_controller.js does. A clipboard that refuses, as on a page that isn't served
 * securely, leaves the button as it was.
 */
async function copy({ currentTarget: button }: MouseEvent<HTMLButtonElement>, url: string) {
  button.classList.remove(...COPIED);
  // Reading the layout ends the last run of the animation, so adding the classes starts it again.
  void button.offsetWidth;
  try {
    await navigator.clipboard.writeText(url);
    button.classList.add(...COPIED);
  } catch {
    // Nothing to show.
  }
}

/** Offers `url` to the system's share sheet. Closing the sheet rejects, which needs no answer. */
async function share(url: string, { title, text }: LinkSharing) {
  await navigator.share({ title, text, url }).catch(() => undefined);
}
