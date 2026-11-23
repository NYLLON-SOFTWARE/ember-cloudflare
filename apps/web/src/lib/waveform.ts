import { WAVEFORM_LENGTH, WAVEFORM_LOUDEST } from "@ember/protocol";
import { MAX_CLIP_SECONDS } from "./clip-recording";

// Sounds' waveforms, which a message's player draws (components/workspace/audio-player.tsx): how loud a
// sound is along its length, as 100 levels from 0 to 100. The uploader's browser works a sound's out as it
// starts the upload, decoding it as it would play it, and the room keeps it with the file. A sound posted
// without one, as a bot's is, or one sent before Ember kept them, draws flat. Decoding holds a whole sound
// in memory, uncompressed, which for a long one of few bytes a second is far more than its file, and a
// file can say it's shorter than it is, so a browser decodes only the sounds it uploads, of up to five
// minutes, one at a time.

/** The most bytes of sound the uploader's browser works a waveform out from. An audio clip is never more than 4 MB. */
const MAX_HEARD_SIZE = 10 * 1024 * 1024;

/** The longest sound the uploader's browser works a waveform out from, in seconds: as long as a clip can be. */
const MAX_HEARD_SECONDS = MAX_CLIP_SECONDS;

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
 * The waveform of `file` that the app sends as it starts the upload, or null for a file that isn't a sound,
 * is over 10 MiB or plays for over five minutes, and where this browser can't decode it, or doesn't within
 * five seconds.
 */
export function waveformOf(file: File): Promise<number[] | null> {
  if (!file.type.startsWith("audio/") || file.size > MAX_HEARD_SIZE) return Promise.resolve(null);
  let waveform = waveforms.get(file);
  if (!waveform) waveforms.set(file, (waveform = withinTimeout((late) => waveformIn(file, late))));
  return waveform;
}

/**
 * The waveform of `sound`, decoded as this browser would play it once every sound decoding before it is, or
 * null where it can't decode it or its header says it plays for over five minutes, or doesn't say, and
 * where `late` says its time ran out before its turn came, as its upload has gone without it.
 */
async function waveformIn(sound: Blob, late: AbortSignal): Promise<number[] | null> {
  try {
    const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    if (!((await durationOf(sound, late)) <= MAX_HEARD_SECONDS)) return null;
    const decoded = await inTurn(async () => (late.aborted ? null : context.decodeAudioData(await sound.arrayBuffer())));
    return decoded && levelsOf(Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel)));
  } catch {
    return null;
  }
}

/**
 * How long `sound` plays, in seconds, as its header says, which the browser reads without decoding it, or NaN
 * where it can't, or hasn't by the time `late` says the upload has gone without a waveform.
 */
function durationOf(sound: Blob, late: AbortSignal): Promise<number> {
  const url = URL.createObjectURL(sound);
  const audio = new Audio();
  return new Promise<number>((resolve) => {
    audio.addEventListener("loadedmetadata", () => resolve(audio.duration));
    audio.addEventListener("error", () => resolve(NaN));
    late.addEventListener("abort", () => resolve(NaN), { once: true });
    audio.preload = "metadata";
    audio.src = url;
  }).finally(() => {
    // Lets the file go.
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  });
}

/** The sound decoding, which the next waits for, so that only one is in memory at once. */
let decoding: Promise<unknown> = Promise.resolve();

/** What `decode` decodes, once the sound decoding before it is. */
function inTurn<T>(decode: () => Promise<T>): Promise<T> {
  const turn = decoding.then(decode);
  decoding = turn.catch(() => {});
  return turn;
}

/**
 * What `work` answers, or null if it takes longer than five seconds, as decoding can't be stopped once it's
 * started, when the signal it's given says it's too late to start.
 */
function withinTimeout(work: (late: AbortSignal) => Promise<number[] | null>): Promise<number[] | null> {
  const late = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      late.abort();
      resolve(null);
    }, WAVEFORM_TIMEOUT);
  });
  return Promise.race([work(late.signal), timedOut]).finally(() => clearTimeout(timer));
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
