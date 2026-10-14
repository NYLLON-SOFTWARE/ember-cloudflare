/**
 * Where the Worker draws `url` as a QR code: `/qr_code/` and the URL's UTF-8 as padded URL-safe
 * base64, as ember-rust's `link_to_zoom_qr_code` writes it (crates/views/src/helpers/application.rs).
 */
export function qrCodePath(url: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(url)) binary += String.fromCharCode(byte);
  return `/qr_code/${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_")}`;
}
