import { MAX_PREVIEW_SIZE, WAVEFORM_LENGTH, WAVEFORM_LOUDEST } from "@ember/protocol";
import { fileUpTo } from "./file-reading";

// Sounds' waveforms, which a message's player draws (components/workspace/audio-player.tsx): how loud a
// sound is along its length, as 100 levels from 0 to 100. The uploader's browser works a sound's out as it
// starts the upload, decoding it as it would play it, and the room keeps it with the file. A sound posted
// without one, as a bot's is, or one sent before Ember kept them, has its own worked out where it's
// shown, if it's no more than 5 MiB.

/**
 * The most bytes of sound the uploader's browser works a waveform out from: about ten minutes of music, as
 * decoding holds all of it in memory, uncompressed. An audio clip is never more than 4 MB.
 */
const MAX_HEARD_SIZE = 10 * 1024 * 1024;

/** How long working a waveform out may take, after which the file goes without one. */
const WAVEFORM_TIMEOUT = 5_000;

/** How many samples a second a sound is decoded to: few, as only how loud it is counts. */
const SAMPLE_RATE = 8_000;

/** How much quieter bars are drawn taller, so that a sound's quiet stretches still show. */
const EASING = 0.8;

/**
 * How loud `channels` of sound are along their length: the root mean square of each of 100 stretches, over
 * every channel, as a level from 0 to 100 for the loudest, or all 0 for silence.
 */
export function levelsOf(channels: readonly Float32Array[]): number[] {
  const length = channels[0]?.length ?? 0;
  const loudness = Array.from({ length: WAVEFORM_LENGTH }, (_, stretch) => {
    const from = Math.floor((stretch * length) / WAVEFORM_LENGTH);
    const to = Math.floor(((stretch + 1) * length) / WAVEFORM_LENGTH);
    let sum = 0;
    for (const samples of channels) for (let i = from; i < to; i++) sum += samples[i]! ** 2;
    return to > from ? Math.sqrt(sum / ((to - from) * channels.length)) : 0;
  });
  const loudest = Math.max(...loudness);
  return loudness.map((level) => (loudest > 0 ? Math.round((level / loudest) * WAVEFORM_LOUDEST) : 0));
}

/** Each file's waveform, worked out once: the composer starts on it as the file is picked, and its upload waits for it. */
const waveforms = new WeakMap<File, Promise<number[] | null>>();

/**
 * The waveform of `file` that the app sends as it starts the upload, or null for a file that isn't a sound
 * or is over 10 MiB, and where this browser can't decode it, or doesn't within five seconds.
 */
export function waveformOf(file: File): Promise<number[] | null> {
  if (!file.type.startsWith("audio/") || file.size > MAX_HEARD_SIZE) return Promise.resolve(null);
  let waveform = waveforms.get(file);
  if (!waveform) waveforms.set(file, (waveform = withinTimeout(waveformIn(file))));
  return waveform;
}

/**
 * The waveform of the sound at `url`, worked out here for one posted without its own, or null for one over
 * 5 MiB, on another site, or that this browser can't decode, unless `signal` aborts first.
 */
export async function waveformAt(url: string, signal: AbortSignal): Promise<number[] | null> {
  try {
    const sound = await fileUpTo(url, MAX_PREVIEW_SIZE, signal);
    return sound && (await waveformIn(sound));
  } catch {
    return null;
  }
}

/** The waveform of `sound`, decoded as this browser would play it, or null where it can't decode it. */
async function waveformIn(sound: Blob): Promise<number[] | null> {
  try {
    const decoded = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(await sound.arrayBuffer());
    return levelsOf(Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel)));
  } catch {
    return null;
  }
}

/** What `working` answers, or null if it takes longer than five seconds, as decoding can't be stopped. */
function withinTimeout(working: Promise<number[] | null>): Promise<number[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), WAVEFORM_TIMEOUT)));
  return Promise.race([working, late]).finally(() => clearTimeout(timer));
}

/**
 * `levels` drawn as `count` bars, each as loud as the levels it covers on average, from 0 to 1 for the
 * loudest, the quieter ones a little taller, or all 0 without levels.
 */
export function barsOf(levels: readonly number[] | null, count: number): number[] {
  if (!levels?.length) return Array.from({ length: count }, () => 0);
  const bars = Array.from({ length: count }, (_, bar) => {
    const from = Math.floor((bar * levels.length) / count);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * levels.length) / count));
    let sum = 0;
    for (let i = from; i < to; i++) sum += levels[i]!;
    return sum / (to - from);
  });
  const loudest = Math.max(...bars);
  return bars.map((bar) => (loudest > 0 ? (bar / loudest) ** EASING : 0));
}
