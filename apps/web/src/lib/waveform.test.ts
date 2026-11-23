import { MAX_PREVIEW_SIZE, WAVEFORM_LENGTH } from "@ember/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { barsOf, levelsOf, waveformAt, waveformOf } from "./waveform";

/** Sound whose samples are `level` at sample `n` of `length`. */
const samples = (length: number, level: (n: number) => number) => Float32Array.from({ length }, (_, n) => level(n));

/** A browser's OfflineAudioContext, which decodes every sound into `channels`, or fails to as `decode` says. */
function decodingAs(channels: Float32Array[], decode = vi.fn(async (_bytes: ArrayBuffer) => ({ numberOfChannels: channels.length, getChannelData: (channel: number) => channels[channel]! }))) {
  vi.stubGlobal("OfflineAudioContext", function OfflineAudioContext() {
    return { decodeAudioData: decode };
  });
  return decode;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Waveforms", () => {
  it("measures how loud a sound is along its length, in 100 stretches from 0 to 100 for the loudest", () => {
    // Louder by each hundredth, as a square wave, which is as loud as its height.
    const rising = samples(10_000, (n) => (Math.floor(n / 100) + 1) * (n % 2 ? 1 : -1) * 0.01);
    expect(levelsOf([rising])).toEqual(Array.from({ length: WAVEFORM_LENGTH }, (_, n) => n + 1));
    expect(levelsOf([samples(10_000, () => 0)])).toEqual(Array(WAVEFORM_LENGTH).fill(0));
  });

  it("hears every channel, and leaves stretches with no samples silent", () => {
    // Loud on the left at the start, then on the right.
    const left = samples(200, (n) => (n < 100 ? 0.5 : 0));
    const right = samples(200, (n) => (n < 100 ? 0 : 0.5));
    expect(new Set(levelsOf([left, right]))).toEqual(new Set([100]));

    const blip = levelsOf([samples(50, () => 0.5)]);
    expect(blip.filter((level) => level === 100)).toHaveLength(50);
    expect(blip.filter((level) => level === 0)).toHaveLength(50);
  });

  it("draws levels as bars, each as loud as the levels it covers, the loudest full height, the quieter ones a little taller", () => {
    const levels = Array.from({ length: WAVEFORM_LENGTH }, (_, n) => (n < 50 ? 25 : 100));
    const bars = barsOf(levels, 4);
    expect(bars[0]).toBeCloseTo(0.25 ** 0.8);
    expect(bars[1]).toBeCloseTo(0.25 ** 0.8);
    expect(bars.slice(2)).toEqual([1, 1]);

    // Twice as many bars as levels, each level two bars.
    expect(barsOf([0, 50, 100], 6).map((bar) => bar.toFixed(2))).toEqual(["0.00", "0.00", "0.57", "0.57", "1.00", "1.00"]);
    expect(barsOf(null, 3)).toEqual([0, 0, 0]);
    expect(barsOf(Array(WAVEFORM_LENGTH).fill(0), 2)).toEqual([0, 0]);
  });

  it("works out a sound's waveform once, as it's picked to send, decoding it as the browser would play it", async () => {
    const decode = decodingAs([samples(1_000, (n) => (n < 500 ? 0.1 : 0.2))]);
    const clip = new File(["sound"], "Audio clip 2026-11-23 at 9.42.10 AM.m4a", { type: "audio/mp4" });
    const waveform = await waveformOf(clip);
    expect(waveform).toEqual([...Array(50).fill(50), ...Array(50).fill(100)]);
    expect(await waveformOf(clip)).toBe(waveform);
    expect(decode).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(decode.mock.calls[0]![0])).toBe("sound");
  });

  it("works out none for a file that isn't a sound, or is over 10 MiB, or that the browser can't decode, or doesn't within five seconds", async () => {
    const decode = decodingAs([samples(1_000, () => 0.5)]);
    expect(await waveformOf(new File(["hi"], "notes.txt", { type: "text/plain" }))).toBeNull();
    expect(await waveformOf(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "mix.mp3", { type: "audio/mpeg" }))).toBeNull();
    expect(decode).not.toHaveBeenCalled();

    decodingAs([], vi.fn(async () => Promise.reject(new DOMException("Unable to decode audio data", "EncodingError"))));
    expect(await waveformOf(new File(["noise"], "noise.wma", { type: "audio/x-ms-wma" }))).toBeNull();

    vi.useFakeTimers();
    decodingAs([], vi.fn(() => new Promise<never>(() => {})));
    const slow = waveformOf(new File(["long"], "long.m4a", { type: "audio/mp4" }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await slow).toBeNull();
  });

  it("works out the waveform of a sound posted without one from its file, of up to 5 MiB, from this site", async () => {
    decodingAs([samples(1_000, () => 0.5)]);
    const fetch = vi.fn(async () => new Response("sound", { headers: { "Content-Length": "5" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await waveformAt("/files/k1/s1/song.mp3", new AbortController().signal)).toEqual(Array(WAVEFORM_LENGTH).fill(100));
    expect(fetch).toHaveBeenCalledOnce();

    fetch.mockResolvedValueOnce(new Response("big", { headers: { "Content-Length": String(MAX_PREVIEW_SIZE + 1) } }));
    expect(await waveformAt("/files/k1/s1/song.mp3", new AbortController().signal)).toBeNull();
    expect(await waveformAt("https://elsewhere.example/song.mp3", new AbortController().signal)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
