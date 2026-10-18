import { qrCodeSvg } from "@ember/protocol/qr-code";
import { urlsafeDecode64 } from "./encoding";
import { notFound } from "./error-pages";

// ember-rust's QR codes (crates/ember/src/controllers/qr_code.rs), drawn as rqrcode draws them
// (packages/protocol/src/qr-code.ts).

/** The cache ember-rust's `expires_in 1.year, public: true` asks for. */
const CACHE_CONTROL = "max-age=31556952, public";

/** Rails' `/qr_code/:id(.:format)`, whose id can't hold "/", "." or "?". */
const ROUTE = /^\/qr_code\/([^/.?]+)(?:\.[^/.?]+)?$/;

/**
 * `GET /qr_code/<id>`: the QR code of whatever text the id holds as URL-safe base64, for anyone to
 * see. Malformed base64 answers 400 where ember-rust answers 500, since the mistake is the client's,
 * and text that doesn't fit the largest QR code answers 422, as there.
 */
export function showQrCode(request: Request): Response {
  const id = new URL(request.url).pathname.match(ROUTE)?.[1];
  if (!id || (request.method !== "GET" && request.method !== "HEAD")) return notFound(request);
  const segment = percentDecoded(id);
  const text = segment === null ? null : urlsafeDecode64(segment);
  if (!text) return new Response(null, { status: 400 });
  const svg = qrCodeSvg(text);
  if (svg === null) return new Response(null, { status: 422 });
  return new Response(request.method === "HEAD" ? null : svg, {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": CACHE_CONTROL },
  });
}

/** A path segment as Rails reads it, or null if its percent-encoding is malformed. */
function percentDecoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
