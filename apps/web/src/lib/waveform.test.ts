import { WAVEFORM_LENGTH } from "@ember/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { barsOf, levelsOf, waveformOf } from "./waveform";

/** Sound whose samples are `level` at sample `n` of `length`. */
const samples = (length: number, level: (n: number) => number) => Float32Array.from({ length }, (_, n) => level(n));

/** A browser's OfflineAudioContext, which decodes every sound into `channels`, or fails to as `decode` says. */
function decodingAs(channels: Float32Array[], decode = vi.fn(async (_bytes: ArrayBuffer) => decodedAs(channels))) {
  vi.stubGlobal("OfflineAudioContext", function OfflineAudioContext() {
    return { decodeAudioData: decode };
  });
  return decode;
}

/** A browser's `<audio>`, which reads every sound's header as saying it plays for `seconds`. */
function lasting(seconds: number) {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sound");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(seconds);
  vi.spyOn(HTMLMediaElement.prototype, "src", "set").mockImplementation(function (this: HTMLMediaElement) {
    void Promise.resolve().then(() => this.dispatchEvent(new Event("loadedmetadata")));
  });
}

/** What a browser's decoding gives for `channels` of sound. */
const decodedAs = (channels: Float32Array[]) => ({ numberOfChannels: channels.length, getChannelData: (channel: number) => channels[channel]! });

afterEach(() => {
  vi.restoreAllMocks();
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
    lasting(35);
    const decode = decodingAs([samples(1_000, (n) => (n < 500 ? 0.1 : 0.2))]);
    const clip = new File(["sound"], "Audio clip 2026-11-23 at 9.42.10 AM.m4a", { type: "audio/mp4" });
    const waveform = await waveformOf(clip);
    expect(waveform).toEqual([...Array(50).fill(50), ...Array(50).fill(100)]);
    expect(await waveformOf(clip)).toBe(waveform);
    expect(decode).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(decode.mock.calls[0]![0])).toBe("sound");
    expect(URL.createObjectURL).toHaveBeenCalledWith(clip);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:sound");
  });

  it("decodes only a sound whose header says it plays for no more than five minutes, as an audio clip does", async () => {
    const decode = decodingAs([samples(1_000, () => 0.5)]);
    lasting(5 * 60 + 1);
    expect(await waveformOf(new File(["talk"], "talk.m4a", { type: "audio/mp4" }))).toBeNull();
    // A header that doesn't say, as a recording's can leave out.
    lasting(Infinity);
    expect(await waveformOf(new File(["memo"], "memo.webm", { type: "audio/webm" }))).toBeNull();
    expect(decode).not.toHaveBeenCalled();

    lasting(5 * 60);
    expect(await waveformOf(new File(["song"], "song.mp3", { type: "audio/mpeg" }))).toEqual(Array(WAVEFORM_LENGTH).fill(100));
    expect(decode).toHaveBeenCalledOnce();
  });

  it("decodes one sound at a time, so only one is in memory at once", async () => {
    lasting(35);
    const finishing: (() => void)[] = [];
    const decode = decodingAs([], vi.fn((_bytes: ArrayBuffer) => new Promise<ReturnType<typeof decodedAs>>((resolve) => finishing.push(() => resolve(decodedAs([samples(1_000, () => 0.5)]))))));
    const first = waveformOf(new File(["one"], "one.m4a", { type: "audio/mp4" }));
    const second = waveformOf(new File(["two"], "two.m4a", { type: "audio/mp4" }));
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(decode).toHaveBeenCalledOnce();

    finishing[0]!();
    expect(await first).toEqual(Array(WAVEFORM_LENGTH).fill(100));
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
    finishing[1]!();
    expect(await second).toEqual(Array(WAVEFORM_LENGTH).fill(100));
  });

  it("works out none for a file that isn't a sound, or is over 10 MiB, or that the browser can't decode, or doesn't within five seconds", async () => {
    lasting(35);
    const decode = decodingAs([samples(1_000, () => 0.5)]);
    expect(await waveformOf(new File(["hi"], "notes.txt", { type: "text/plain" }))).toBeNull();
    expect(await waveformOf(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "mix.mp3", { type: "audio/mpeg" }))).toBeNull();
    expect(decode).not.toHaveBeenCalled();

    decodingAs([], vi.fn(async () => Promise.reject(new DOMException("Unable to decode audio data", "EncodingError"))));
    expect(await waveformOf(new File(["noise"], "noise.wma", { type: "audio/x-ms-wma" }))).toBeNull();

    vi.useFakeTimers();
    let stop!: () => void;
    decodingAs([], vi.fn(() => new Promise<never>((_, reject) => (stop = () => reject(new DOMException("Unable to decode audio data", "EncodingError"))))));
    const slow = waveformOf(new File(["long"], "long.m4a", { type: "audio/mp4" }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await slow).toBeNull();
    // Its decoding goes on, as it can't be stopped, until the browser gives up on it.
    stop();
  });

  it("decodes no sound whose five seconds ran out while it waited its turn, as its upload went without it", async () => {
    lasting(35);
    vi.useFakeTimers();
    let finish!: () => void;
    const decode = decodingAs([], vi.fn((_bytes: ArrayBuffer) => new Promise<ReturnType<typeof decodedAs>>((resolve) => (finish = () => resolve(decodedAs([samples(1_000, () => 0.5)]))))));
    const first = waveformOf(new File(["one"], "one.m4a", { type: "audio/mp4" }));
    const second = waveformOf(new File(["two"], "two.m4a", { type: "audio/mp4" }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect([await first, await second]).toEqual([null, null]);

    finish();
    const third = waveformOf(new File(["three"], "three.m4a", { type: "audio/mp4" }));
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
    finish();
    expect(await third).toEqual(Array(WAVEFORM_LENGTH).fill(100));
    expect(decode.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes))).toEqual(["one", "three"]);
  });

  it("works out none where the browser can't read how long a sound plays", async () => {
    const decode = decodingAs([samples(1_000, () => 0.5)]);
    lasting(35);
    vi.spyOn(HTMLMediaElement.prototype, "src", "set").mockImplementation(function (this: HTMLMediaElement) {
      void Promise.resolve().then(() => this.dispatchEvent(new Event("error")));
    });
    expect(await waveformOf(new File(["voice"], "voice.amr", { type: "audio/amr" }))).toBeNull();
    expect(decode).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:sound");
  });

  it("lets a sound go whose header the browser hasn't read within five seconds, as its upload went without a waveform", async () => {
    const decode = decodingAs([samples(1_000, () => 0.5)]);
    lasting(35);
    // A browser that puts off reading it, as one can.
    vi.spyOn(HTMLMediaElement.prototype, "src", "set").mockImplementation(() => {});
    vi.useFakeTimers();
    const stalled = waveformOf(new File(["voice"], "voice.m4a", { type: "audio/mp4" }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await stalled).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:sound");
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
  });
});
