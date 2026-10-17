// Sharing a file through the system's share sheet, as ember-rust's web_share_controller.js does
// (crates/assets/overrides/controllers/web_share_controller.js), from the image viewer, a file's card and
// a file message's action bar.

/** Whether this browser can share, as ember-rust decides before it's ever asked to: it has `navigator.canShare`. */
export const canShare = () => "canShare" in navigator;

/**
 * How sharing a file went: the sheet opened, or was asked to; the file came too late for the click that
 * asked for it, so the next Share of it opens the sheet at once; or the file couldn't be had.
 */
export type Shared = "opened" | "ready" | "failed";

/** How long a file that came too late for its click is kept for the next Share of it. */
const KEPT_MS = 60_000;

/** The file that came too late for its click, with the address it came from. */
let ready: { url: string; file: File } | null = null;

/**
 * Offers the file at `url` to the system's share sheet, titled `title`, with an empty text, and named
 * `Ember_<random>` with its type's extension. Closing the sheet rejects, which needs no answer. A browser
 * opens the sheet only for a few seconds after a click, which downloading a large file can outlast, so a
 * file that comes too late is kept for the next Share of it, where ember-rust's tries again from the start
 * each time. An error page isn't shared as the file, as ember-rust's would.
 */
export async function shareFile(url: string, title = ""): Promise<Shared> {
  const file = ready?.url === url ? ready.file : await download(url);
  ready = null;
  if (!file) return "failed";
  try {
    await navigator.share({ title, text: "", files: [file] });
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") return keep(url, file);
  }
  return "opened";
}

/** Keeps `file` for the next Share of `url`, for a minute. */
function keep(url: string, file: File): Shared {
  const kept = { url, file };
  ready = kept;
  setTimeout(() => {
    if (ready === kept) ready = null;
  }, KEPT_MS);
  return "ready";
}

/** The file at `url`, named as it's shared, or null if it couldn't be had. */
async function download(url: string): Promise<File | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new File([blob], `Ember_${Math.random().toString(36).slice(2)}.${extensionOf(blob.type)}`, { type: blob.type });
  } catch {
    return null;
  }
}

/**
 * The extension for a file of `type`: "svg" for a QR code's `image/svg+xml; charset=utf-8`. ember-rust
 * keeps all of the type after its "/", so its QR codes end ".svg+xml; charset=utf-8".
 */
const extensionOf = (type: string) => type.replace(/^[^/]*\/|[+;].*$/g, "");
