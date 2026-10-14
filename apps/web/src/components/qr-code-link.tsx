import { useState, type ReactNode } from "react";
import { Lightbox } from "@/components/lightbox";
import { qrCodePath } from "@/lib/qr-code";

/**
 * A link to `url`'s QR code that opens it in the image viewer, as ember-rust's `link_to_zoom_qr_code`
 * does (crates/views/src/helpers/application.rs).
 */
export function QrCodeLink({ url, className, children }: { url: string; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = qrCodePath(url);

  return (
    <>
      <a
        href={path}
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
        className={className}
      >
        {children}
      </a>
      <Lightbox src={open ? path : null} onClose={() => setOpen(false)} />
    </>
  );
}
