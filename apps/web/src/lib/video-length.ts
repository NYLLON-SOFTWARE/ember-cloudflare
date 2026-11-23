import { isDuration } from "@ember/protocol";

// Videos' lengths, which a message's player shows before it loads anything of the video
// (components/workspace/video-player.tsx). The uploader's browser reads a video's from its header as it starts
// the upload, and the room keeps it with the file, so the room's other browsers load none of a video to say
// how long it is. A video sent before Ember kept them, or whose header doesn't say, as a recording that was
// never finished doesn't, shows its length once it's played.

/** How long reading a video's length may take, after which the file goes without one. */
const LENGTH_TIMEOUT = 5_000;

/** Each video's length, read once: the composer starts on it as the file is picked, and its upload waits for it. */
const lengths = new WeakMap<File, Promise<number | null>>();

/**
 * How long `file` plays, in seconds to the thousandth, as its header says, which the app sends as it starts
 * the upload, or null for a file that isn't a video, and where this browser can't read it, or doesn't within
 * five seconds.
 */
export function videoLengthOf(file: File): Promise<number | null> {
  if (!file.type.startsWith("video/")) return Promise.resolve(null);
  let length = lengths.get(file);
  if (!length) lengths.set(file, (length = lengthIn(file)));
  return length;
}

/** How long `video` plays, as its header says, which the browser reads without decoding it, or null where it can't within five seconds. */
async function lengthIn(video: Blob): Promise<number | null> {
  const url = URL.createObjectURL(video);
  const element = document.createElement("video");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const seconds = await new Promise<number>((resolve) => {
      timer = setTimeout(() => resolve(NaN), LENGTH_TIMEOUT);
      element.addEventListener("loadedmetadata", () => resolve(element.duration));
      element.addEventListener("error", () => resolve(NaN));
      element.muted = true;
      element.preload = "metadata";
      element.src = url;
    });
    const length = Math.round(seconds * 1000) / 1000;
    return isDuration(length) ? length : null;
  } finally {
    clearTimeout(timer);
    // Lets the file go.
    element.removeAttribute("src");
    element.load();
    URL.revokeObjectURL(url);
  }
}
