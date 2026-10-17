// Sharing a file through the system's share sheet, as ember-rust's web_share_controller.js does
// (crates/assets/overrides/controllers/web_share_controller.js), from the image viewer, a file's card and
// a file message's action bar.

/** Whether this browser can share, as ember-rust decides before it's ever asked to: it has `navigator.canShare`. */
export const canShare = () => "canShare" in navigator;

/**
 * Offers the file at `url` to the system's share sheet, titled `title`, with an empty text, and named
 * `Ember_<random>` with its type's extension. Closing the sheet rejects, which needs no answer.
 */
export async function shareFile(url: string, title = "") {
  try {
    const blob = await (await fetch(url)).blob();
    const name = `Ember_${Math.random().toString(36).slice(2)}.${extensionOf(blob.type)}`;
    await navigator.share({ title, text: "", files: [new File([blob], name, { type: blob.type })] });
  } catch {
    // Nothing to show.
  }
}

/**
 * The extension for a file of `type`: "svg" for a QR code's `image/svg+xml; charset=utf-8`. ember-rust
 * keeps all of the type after its "/", so its QR codes end ".svg+xml; charset=utf-8".
 */
const extensionOf = (type: string) => type.replace(/^[^/]*\/|[+;].*$/g, "");
