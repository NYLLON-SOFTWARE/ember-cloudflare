import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Download, Remove, Share } from "@/components/icons/campfire";
import { cn } from "@/lib/utils";

// ember-rust's image viewer (crates/views/templates/layouts/_lightbox.html), opened and cleared as
// Campfire's lightbox_controller.js does and styled by its lightbox.css. It keeps its buttons clear
// of a phone's notch, rounded corners and home indicator, which lightbox.css doesn't, and Download
// saves even a file that isn't served as an attachment, where ember-rust's leaves the app to show a
// QR code.

/** A circle `.btn` in a corner: 36px, as zz-ember.css sizes buttons, and 44px for fingers. */
const BUTTON = "grid size-9 cursor-pointer place-items-center rounded-full border bg-background [grid-area:1/1] touch:size-11";

interface LightboxProps {
  /** The image to show, or null while the viewer is closed. */
  src: string | null;
  /** The name Download saves it under, unless the server names it. */
  filename: string;
  /** Called when Escape or Close has closed the viewer. */
  onClose: () => void;
}

/**
 * Shows `src` over the blurred page, with its file to download and, where the browser can, to share.
 * It's rendered into the body, where ember-rust's layout keeps it, so it takes the page's text size
 * wherever it's opened from.
 */
export function Lightbox({ src, filename, onClose }: LightboxProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  // As ember-rust's web_share_controller.js decides, before it's ever asked to share.
  const canShare = "canShare" in navigator;

  useEffect(() => {
    if (src && !dialog.current?.open) dialog.current?.showModal();
  }, [src]);

  return createPortal(
    <dialog
      ref={dialog}
      aria-label="Image Viewer (Press escape to close)"
      onClose={onClose}
      className="inset-0 m-auto h-dvh max-h-none w-dvw max-w-none overflow-hidden bg-lightbox pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1ch,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1ch,env(safe-area-inset-left))] backdrop:backdrop-blur-[66px] open:grid open:grid-cols-1 open:grid-rows-1 open:place-items-center"
    >
      {src && <img src={src} alt="" className="max-h-full max-w-full [grid-area:1/1]" />}
      <button type="button" onClick={() => dialog.current?.close()} className={cn(BUTTON, "self-start justify-self-end")}>
        <Remove className="w-[1.3em]" />
        <span className="sr-only">Close image viewer</span>
      </button>
      <a href={src ?? undefined} download={filename} className={cn(BUTTON, "self-end justify-self-end ios-pwa:hidden")}>
        <Download className="w-[1.3em]" />
        <span className="sr-only">Download file</span>
      </a>
      {canShare && (
        <button type="button" onClick={() => src && void shareFile(src)} className={cn(BUTTON, "self-start justify-self-start")}>
          <Share className="w-[1.3em]" />
          <span className="sr-only">Share file</span>
        </button>
      )}
    </dialog>,
    document.body,
  );
}

/**
 * Offers the file at `url` to the system's share sheet as ember-rust's web_share_controller.js does,
 * named `Ember_<random>` with an empty title and text. Closing the sheet rejects, which needs no answer.
 */
async function shareFile(url: string) {
  try {
    const blob = await (await fetch(url)).blob();
    const name = `Ember_${Math.random().toString(36).slice(2)}.${extensionOf(blob.type)}`;
    await navigator.share({ title: "", text: "", files: [new File([blob], name, { type: blob.type })] });
  } catch {
    // Nothing to show.
  }
}

/**
 * The extension for a file of `type`: "svg" for a QR code's `image/svg+xml; charset=utf-8`. ember-rust
 * keeps all of the type after its "/", so its QR codes end ".svg+xml; charset=utf-8".
 */
const extensionOf = (type: string) => type.replace(/^[^/]*\/|[+;].*$/g, "");
