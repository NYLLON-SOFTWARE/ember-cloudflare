import type { MouseEvent } from "react";
import { CopyPaste, QrCode, Share } from "@/components/icons/campfire";
import { QrCodeLink } from "@/components/qr-code-link";

// The join link's buttons, which ember-rust's invite block on workspace settings
// (crates/views/templates/accounts/_invite.html) and the welcome card (rooms/show/_invitation.html) both
// have: its QR code link, and its copy and share controllers.

/** Campfire's `btn--success` (buttons.css), which the copy button plays each time it copies. */
const COPIED = ["motion-safe:animate-success", "motion-safe:[&>img]:animate-zoom-fade"];

/** The join link for `joinCode`, absolute, as ember-rust writes it (`ctx.url`). */
export const joinUrl = (joinCode: string) => new URL(`/join/${joinCode}`, location.origin).href;

/** The join link's QR code, copy and share buttons, each styled with `className`. */
export function JoinLinkButtons({ url, className }: { url: string; className: string }) {
  // As ember-rust's web_share_controller.js decides, before it's ever asked to share.
  const canShare = "canShare" in navigator;

  return (
    <>
      <QrCodeLink url={url} className={className}>
        <span className="sr-only">Show join link QR code</span>
        <QrCode className="size-[1.3em]" />
      </QrCodeLink>
      <button type="button" onClick={(event) => void copy(event, url)} className={className}>
        <span className="sr-only">Copy join link</span>
        <CopyPaste className="size-[1.3em]" />
      </button>
      {canShare && (
        <button type="button" onClick={() => void share(url)} className={className}>
          <span className="sr-only">Share join link</span>
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
async function share(url: string) {
  await navigator.share({ title: "Link to join Ember", text: "Hit this link to join me in Ember and start chatting.", url }).catch(() => undefined);
}
