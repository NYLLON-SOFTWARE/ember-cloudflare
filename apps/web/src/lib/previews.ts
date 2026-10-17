import { isPreviewed, PREVIEW_MAX_HEIGHT, PREVIEW_MAX_WIDTH } from "@ember/protocol";

// Previews of files, which the uploader's browser makes and the app sends before a file's last part, where
// ember-rust makes them on the server: a picture's thumbnail, as Active Storage's `:thumb` variant resizes
// it to fit 1200×800 (crates/ember/src/controllers/presenters.rs), and a video's poster, which ember-rust's
// ffmpeg takes from its first frame and Ember from a tenth of a second in, past the blank frame some
// browsers draw at the start. Both are still, so an animated picture's is its first frame.

/** A picture's or video's width and height, in pixels. */
export interface Size {
  width: number;
  height: number;
}

/** How long a preview may take, after which the file goes without one. */
const PREVIEW_TIMEOUT = 5_000;

/** The quality previews are encoded at, from 0 to 1. */
const QUALITY = 0.85;

/** How far into a video its poster is taken from, in seconds, or halfway through a shorter one. */
const POSTER_TIME = 0.1;

/** `width` by `height` scaled down, never up, to fit 1200×800, as `resize_to_limit` scales a picture. */
export function fitted({ width, height }: Size): Size {
  const scale = Math.min(1, PREVIEW_MAX_WIDTH / width, PREVIEW_MAX_HEIGHT / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The preview of `file` that the app sends with it: a picture's thumbnail or a video's poster within
 * 1200×800, or null for any other file, and where this browser can't decode it, as Chrome can't decode
 * HEIC or TIFF, or doesn't within five seconds, when it stops making it.
 */
export async function previewOf(file: File): Promise<Blob | null> {
  if (!isPreviewed(file.type)) return null;
  const url = URL.createObjectURL(file);
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), PREVIEW_TIMEOUT);
  try {
    const making = file.type.startsWith("video") ? posterOf(url, timeout.signal) : thumbnailOf(url, file.type !== "image/jpeg", timeout.signal);
    // Encoding can't be stopped, so the preview is given up on while it's under way too.
    return await Promise.race([making, abortOf(timeout.signal)]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    URL.revokeObjectURL(url);
  }
}

/** The thumbnail of the picture at `url`, which may be see-through unless it's a JPEG, unless `signal` aborts before it decodes. */
async function thumbnailOf(url: string, seeThrough: boolean, signal: AbortSignal): Promise<Blob | null> {
  const picture = new Image();
  picture.src = url;
  await Promise.race([picture.decode(), abortOf(signal)]);
  return encoded(picture, { width: picture.naturalWidth, height: picture.naturalHeight }, seeThrough);
}

/**
 * The poster of the video at `url`, or null for one with no picture, such as a recording of sound alone,
 * unless `signal` aborts before it has loaded and sought, when it lets go of the video at once.
 */
async function posterOf(url: string, signal: AbortSignal): Promise<Blob | null> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    video.src = url;
    await nextEvent(video, "loadedmetadata", signal);
    video.currentTime = Number.isFinite(video.duration) ? Math.min(POSTER_TIME, video.duration / 2) : POSTER_TIME;
    await nextEvent(video, "seeked", signal);
    const size = { width: video.videoWidth, height: video.videoHeight };
    return size.width && size.height ? await encoded(video, size, false) : null;
  } finally {
    // Lets go of the decoder.
    video.removeAttribute("src");
    video.load();
  }
}

/** Resolves on `media`'s next `type` event, or rejects on its next error, or once `signal` aborts. */
const nextEvent = (media: HTMLMediaElement, type: string, signal: AbortSignal) =>
  Promise.race([
    new Promise<void>((resolve, reject) => {
      media.addEventListener(type, () => resolve(), { once: true, signal });
      media.addEventListener("error", () => reject(media.error), { once: true, signal });
    }),
    abortOf(signal),
  ]);

/** Rejects once `signal` aborts, or at once if it has. */
const abortOf = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

/**
 * `source`, `size` big, scaled to fit 1200×800 and encoded as WebP, or where this browser can't encode
 * WebP, as Safari can't, as a PNG if it may be see-through, which a JPEG can't be, and a JPEG if not.
 */
async function encoded(source: CanvasImageSource, size: Size, seeThrough: boolean): Promise<Blob | null> {
  const { width, height } = fitted(size);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, width, height);
  // A browser that can't encode a type encodes a PNG instead.
  const webp = await blobOf(canvas, "image/webp");
  return webp?.type === "image/webp" || seeThrough ? webp : blobOf(canvas, "image/jpeg");
}

const blobOf = (canvas: HTMLCanvasElement, type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));
