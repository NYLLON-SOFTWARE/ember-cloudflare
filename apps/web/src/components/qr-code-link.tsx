import { useEffect, useState, type ReactNode } from "react";
import { Lightbox } from "@/components/lightbox";
import { drawnQrCode, qrCodePath } from "@/lib/qr-code";

interface QrCodeLinkProps {
  url: string;
  /**
   * Whether the page draws the QR code itself, for a link whose address mustn't reach the Worker, as a
   * sign-in link's mustn't: then it's a button, where it's otherwise a link to the Worker's drawing.
   */
  drawn?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A link to `url`'s QR code that opens it in the image viewer, as ember-rust's `link_to_zoom_qr_code`
 * does (crates/views/src/helpers/application.rs).
 */
export function QrCodeLink({ url, drawn = false, className, children }: QrCodeLinkProps) {
  const [shown, setShown] = useState<string | null>(null);
  // A drawing is kept only while it's shown.
  useEffect(() => () => void (drawn && shown && URL.revokeObjectURL(shown)), [drawn, shown]);
  const viewer = <Lightbox src={shown} filename="QR code.svg" onClose={() => setShown(null)} />;

  if (drawn) {
    return (
      <>
        {/* Where the drawing's code can't load, there's nothing to show. */}
        <button type="button" onClick={() => void drawnQrCode(url).then(setShown, () => undefined)} className={className}>
          {children}
        </button>
        {viewer}
      </>
    );
  }
  const path = qrCodePath(url);
  return (
    <>
      <a
        href={path}
        onClick={(event) => {
          event.preventDefault();
          setShown(path);
        }}
        className={className}
      >
        {children}
      </a>
      {viewer}
    </>
  );
}
