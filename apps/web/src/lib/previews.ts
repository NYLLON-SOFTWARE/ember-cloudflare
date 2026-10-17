import { AVATAR_BOX, isPreviewed, isVariable, PREVIEW_MAX_HEIGHT, PREVIEW_MAX_WIDTH } from "@ember/protocol";

// Previews of files, which the uploader's browser makes and the app sends before a file's last part, where
// ember-rust makes them on the server: a picture's thumbnail, as Active Storage's `:thumb` variant resizes
// it to fit 1200×800 (crates/ember/src/controllers/presenters.rs), and a video's poster, which ember-rust's
// ffmpeg takes from its first frame and Ember from a tenth of a second in, past the blank frame some
// browsers draw at the start. Both are still, so an animated picture's is its first frame. An avatar's
// variant is made as a picture's thumbnail is, to fit 512×512, as ember-rust's `:square` variant
// resizes it (crates/ember/src/controllers/users/avatars.rs).

/** A picture's or video's width and height, in pixels. */
export interface Size {
  width: number;
  height: number;
}

/** How long a preview or a variant may take, after which the file goes without one. */
const PREVIEW_TIMEOUT = 5_000;

/** The quality previews are encoded at, from 0 to 1. */
const QUALITY = 0.85;

/** How far into a video its poster is taken from, in seconds, or halfway through a shorter one. */
const POSTER_TIME = 0.1;

/** The box a preview fits within, as Active Storage's `:thumb` variant. */
const PREVIEW_LIMIT: Size = { width: PREVIEW_MAX_WIDTH, height: PREVIEW_MAX_HEIGHT };

/** The box an avatar's variant fits within. */
const AVATAR_LIMIT: Size = { width: AVATAR_BOX, height: AVATAR_BOX };

/** `width` by `height` scaled down, never up, to fit `limit`, 1200×800 unless it's given, as `resize_to_limit` scales a picture. */
export function fitted({ width, height }: Size, limit = PREVIEW_LIMIT): Size {
  const scale = Math.min(1, limit.width / width, limit.height / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The preview of `file` that the app sends with it: a picture's thumbnail or a video's poster within
 * 1200×800, or null for any other file, and where this browser can't decode it, as Chrome can't decode
 * HEIC or TIFF, or doesn't within five seconds, when it stops making it.
 */
export async function previewOf(file: File): Promise<Blob | null> {
  if (!isPreviewed(file.type)) return null;
  return madeOf(file, (url, signal) =>
    file.type.startsWith("video") ? posterOf(url, signal) : thumbnailOf(url, file.type !== "image/jpeg", PREVIEW_LIMIT, signal),
  );
}

/**
 * The variant of `file` that the app sends with it as someone's avatar: the picture within 512×512, or
 * null for a file ember-rust doesn't resize, and where this browser can't decode it or doesn't within
 * five seconds, as for a preview.
 */
export async function avatarVariantOf(file: File): Promise<Blob | null> {
  if (!isVariable(file.type)) return null;
  return madeOf(file, (url, signal) => thumbnailOf(url, file.type !== "image/jpeg", AVATAR_LIMIT, signal));
}

/**
 * What `make` makes of `file` from its address, or null if it fails, or doesn't within five seconds, when
 * `signal` aborts so it stops. The address is let go of either way.
 */
async function madeOf(file: File, make: (url: string, signal: AbortSignal) => Promise<Blob | null>): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), PREVIEW_TIMEOUT);
  try {
    // Encoding can't be stopped, so it's given up on while it's under way too.
    return await Promise.race([make(url, timeout.signal), abortOf(timeout.signal)]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    URL.revokeObjectURL(url);
  }
}

/**
 * The picture at `url` scaled to fit `limit`, which may be see-through unless it's a JPEG, unless
 * `signal` aborts before it decodes.
 */
async function thumbnailOf(url: string, seeThrough: boolean, limit: Size, signal: AbortSignal): Promise<Blob | null> {
  const picture = new Image();
  picture.src = url;
  await Promise.race([picture.decode(), abortOf(signal)]);
  return encoded(picture, fitted({ width: picture.naturalWidth, height: picture.naturalHeight }, limit), seeThrough);
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
    return size.width && size.height ? await encoded(video, fitted(size), false) : null;
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
 * `source` drawn `width` by `height` and encoded as WebP, or where this browser can't encode WebP, as
 * Safari can't, as a PNG if it may be see-through, which a JPEG can't be, and a JPEG if not.
 */
async function encoded(source: CanvasImageSource, { width, height }: Size, seeThrough: boolean): Promise<Blob | null> {
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
