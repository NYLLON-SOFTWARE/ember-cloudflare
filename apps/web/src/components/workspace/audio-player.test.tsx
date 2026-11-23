import { WAVEFORM_LENGTH, type StoredFile } from "@ember/protocol";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPlayer } from "./audio-player";

/** A sound called `name`, as a message has it. */
const stored = (name: string, contentType: string, overrides: Partial<StoredFile> = {}): StoredFile => {
  const url = `/files/k1/s1/${encodeURIComponent(name)}`;
  return { id: "k1", name, contentType, byteSize: 1234, url, downloadUrl: `${url}?disposition=attachment`, ...overrides };
};

const CLIP = "Audio clip 2026-11-23 at 9.42.10 AM.m4a";

/** A waveform growing louder from its start to its end. */
const RISING = Array.from({ length: WAVEFORM_LENGTH }, (_, n) => n + 1);

const clip = (overrides: Partial<StoredFile> = {}) => stored(CLIP, "audio/mp4", { waveform: RISING, ...overrides });

/** The sounds playing, as jsdom plays none. */
const sounding = new Set<HTMLMediaElement>();

/** What each frame of the page will call, as jsdom draws no frames. */
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (this: HTMLMediaElement) {
    return !sounding.has(this);
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (this: HTMLMediaElement) {
    sounding.add(this);
    this.dispatchEvent(new Event("play"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    if (sounding.delete(this)) this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(35);
  // Every waveform, and its slider, 200px wide and 36px tall, from 100px in.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 0, 200, 36));
  Element.prototype.setPointerCapture ??= () => {};
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  sounding.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const player = (name = CLIP) => screen.getByRole("group", { name });
const sound = (name = CLIP) => player(name).querySelector("audio")!;
const slider = (name = CLIP) => within(player(name)).getByRole("slider", { name: "Position" });
const playButton = (name = CLIP) => within(player(name)).getByRole("button", { name: /^(Play|Pause)$/ });
/** The time a player shows beside its waveform. */
const shownTime = (name = CLIP) => player(name).querySelector("span[aria-hidden=true].tabular-nums:not([style])")!.textContent;
/** How tall each of a waveform's bars is, in pixels. */
const barHeights = (name = CLIP) => [...player(name).querySelectorAll("clipPath rect")].map((bar) => Number(bar.getAttribute("height")));

/** Moves the sound to `seconds` in, as the browser says once it has. */
function seekTo(name: string, seconds: number) {
  sound(name).currentTime = seconds;
  fireEvent(sound(name), new Event("seeked"));
}

describe("Audio player", () => {
  it("plays a sound in place, in a card named for its file, saying how long it is, loading only that until it's played", async () => {
    render(<AudioPlayer file={clip()} />);
    expect(sound()).toHaveAttribute("src", clip().url);
    expect(sound()).toHaveAttribute("preload", "metadata");
    expect(sound()).not.toHaveAttribute("controls");
    expect(shownTime()).toBe("0:35");
    expect(slider()).toHaveAttribute("aria-valuetext", "0:00 of 0:35");
    // A clip's name says only when it was recorded, which the message says already.
    expect(within(player()).queryByText(CLIP)).not.toBeInTheDocument();

    await userEvent.click(playButton());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(playButton()).toHaveAccessibleName("Pause");
    expect(shownTime()).toBe("0:00");

    // As it plays, its time follows it every frame.
    sound().currentTime = 13.4;
    act(() => frames.at(-1)!(0));
    expect(shownTime()).toBe("0:13");
    expect(slider()).toHaveAttribute("aria-valuetext", "0:13 of 0:35");
    expect(slider()).toHaveAttribute("aria-valuenow", "13");
    expect(slider()).toHaveAttribute("aria-valuemax", "35");

    await userEvent.click(playButton());
    expect(playButton()).toHaveAccessibleName("Play");
    expect(shownTime()).toBe("0:13");
  });

  it("shows a file's name over its waveform, unless it's an audio clip's", () => {
    render(<AudioPlayer file={stored("launch-jingle-v2.mp3", "audio/mpeg", { waveform: RISING })} />);
    expect(within(player("launch-jingle-v2.mp3")).getByText("launch-jingle-v2.mp3")).toBeVisible();
  });

  it("plays one sound at a time, pausing the one playing as another starts", async () => {
    render(
      <>
        <AudioPlayer file={clip()} />
        <AudioPlayer file={stored("theme.mp3", "audio/mpeg", { id: "k2", waveform: RISING })} />
      </>,
    );
    await userEvent.click(playButton());
    await userEvent.click(playButton("theme.mp3"));
    expect(playButton()).toHaveAccessibleName("Play");
    expect(playButton("theme.mp3")).toHaveAccessibleName("Pause");
    expect([...sounding]).toEqual([sound("theme.mp3")]);
  });

  it("goes back to its start once it ends, saying how long it is again", async () => {
    render(<AudioPlayer file={clip()} />);
    await userEvent.click(playButton());
    sound().currentTime = 35;
    act(() => {
      sounding.clear();
      sound().dispatchEvent(new Event("pause"));
      sound().dispatchEvent(new Event("ended"));
    });
    expect(sound().currentTime).toBe(0);
    expect(playButton()).toHaveAccessibleName("Play");
    expect(shownTime()).toBe("0:35");
    expect(slider()).toHaveAttribute("aria-valuetext", "0:00 of 0:35");
  });

  it("moves a sound along where a mouse presses or drags its waveform, showing the time it hovers over", () => {
    render(<AudioPlayer file={clip()} />);
    const mouse = { pointerType: "mouse", pointerId: 1, button: 0 };
    fireEvent.pointerDown(slider(), { ...mouse, clientX: 150 });
    expect(sound().currentTime).toBe(8.75);
    expect(slider()).toHaveAttribute("aria-valuetext", "0:08 of 0:35");
    expect(shownTime()).toBe("0:08");

    fireEvent.pointerMove(slider(), { ...mouse, clientX: 250 });
    expect(sound().currentTime).toBe(26.25);
    // Past its end, it's at its end.
    fireEvent.pointerMove(slider(), { ...mouse, clientX: 400 });
    expect(sound().currentTime).toBe(35);
    fireEvent.pointerUp(slider(), { ...mouse, clientX: 400 });

    fireEvent.pointerMove(slider(), { ...mouse, clientX: 200 });
    expect(sound().currentTime).toBe(35);
    expect(within(player()).getByText("0:17")).toHaveStyle({ left: "50%" });
    fireEvent.pointerLeave(slider(), mouse);
    expect(within(player()).queryByText("0:17")).not.toBeInTheDocument();

    // Another button presses nothing.
    fireEvent.pointerDown(slider(), { ...mouse, button: 2, clientX: 100 });
    expect(sound().currentTime).toBe(35);
  });

  it("moves a sound along where a finger lifts or drags sideways, leaving it where the finger was scrolling", () => {
    render(<AudioPlayer file={clip()} />);
    const finger = { pointerType: "touch", pointerId: 2, button: 0 };
    fireEvent.pointerDown(slider(), { ...finger, clientX: 150 });
    expect(sound().currentTime).toBe(0);
    fireEvent.pointerCancel(slider(), finger);
    fireEvent.pointerUp(slider(), { ...finger, clientX: 150 });
    expect(sound().currentTime).toBe(0);

    fireEvent.pointerDown(slider(), { ...finger, clientX: 150 });
    fireEvent.pointerUp(slider(), { ...finger, clientX: 150 });
    expect(sound().currentTime).toBe(8.75);

    fireEvent.pointerDown(slider(), { ...finger, clientX: 150 });
    fireEvent.pointerMove(slider(), { ...finger, clientX: 152 });
    expect(sound().currentTime).toBe(8.75);
    fireEvent.pointerMove(slider(), { ...finger, clientX: 160 });
    expect(sound().currentTime).toBe(10.5);
    fireEvent.pointerMove(slider(), { ...finger, clientX: 200 });
    expect(sound().currentTime).toBe(17.5);
    fireEvent.pointerUp(slider(), { ...finger, clientX: 200 });
    expect(sound().currentTime).toBe(17.5);
  });

  it("moves a sound along 5 seconds with the arrows, to its ends with Home and End, and plays or pauses it with Space", async () => {
    render(<AudioPlayer file={clip()} />);
    slider().focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowUp}");
    expect(sound().currentTime).toBe(15);
    await userEvent.keyboard("{ArrowLeft}{ArrowDown}");
    expect(sound().currentTime).toBe(5);
    await userEvent.keyboard("{End}");
    expect(sound().currentTime).toBe(35);
    await userEvent.keyboard("{Home}{ArrowLeft}");
    expect(sound().currentTime).toBe(0);
    // Keys held with others are someone else's, as Cmd+Shift+Space is a huddle's.
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(sound().currentTime).toBe(0);

    await userEvent.keyboard(" ");
    expect(playButton()).toHaveAccessibleName("Pause");
    await userEvent.keyboard(" ");
    expect(playButton()).toHaveAccessibleName("Play");
  });

  it("plays every sound at the speed last picked, 1×, 1.5× or 2× in turn, which the browser keeps", async () => {
    const { unmount } = render(
      <>
        <AudioPlayer file={clip()} />
        <AudioPlayer file={stored("theme.mp3", "audio/mpeg", { id: "k2", waveform: RISING })} />
      </>,
    );
    const speed = (name = CLIP) => within(player(name)).getByRole("button", { name: /^Playback speed/ });
    expect(speed()).toHaveAccessibleName("Playback speed, 1 times");
    expect(speed()).toHaveTextContent("1×");

    await userEvent.click(speed());
    expect(speed("theme.mp3")).toHaveAccessibleName("Playback speed, 1.5 times");
    expect(speed("theme.mp3")).toHaveTextContent("1.5×");
    expect([sound().playbackRate, sound("theme.mp3").playbackRate]).toEqual([1.5, 1.5]);
    expect(localStorage.getItem("ember:playback-rate")).toBe("1.5");
    await userEvent.click(speed());
    expect(speed()).toHaveAccessibleName("Playback speed, 2 times");
    unmount();

    render(<AudioPlayer file={clip()} />);
    expect(speed()).toHaveAccessibleName("Playback speed, 2 times");
    expect(sound().playbackRate).toBe(2);
    await userEvent.click(speed());
    expect(speed()).toHaveAccessibleName("Playback speed, 1 times");
  });

  it("plays at the speed picked where the browser can't keep it, as one whose storage is full can't, over the one it kept", async () => {
    localStorage.setItem("ember:playback-rate", "1.5");
    render(<AudioPlayer file={clip()} />);
    const speed = () => within(player()).getByRole("button", { name: /^Playback speed/ });
    expect(speed()).toHaveAccessibleName("Playback speed, 1.5 times");

    const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    await userEvent.click(speed());
    expect(speed()).toHaveAccessibleName("Playback speed, 2 times");
    expect(sound().playbackRate).toBe(2);
    await userEvent.click(speed());
    expect(speed()).toHaveAccessibleName("Playback speed, 1 times");

    // Once the browser keeps it again, every page plays at the speed it keeps.
    full.mockRestore();
    await userEvent.click(speed());
    expect(speed()).toHaveAccessibleName("Playback speed, 1.5 times");
    expect(localStorage.getItem("ember:playback-rate")).toBe("1.5");
  });

  it("draws its uploader's waveform as bars across its width, the loudest full height, a silent stretch's 3px", () => {
    render(<AudioPlayer file={clip()} />);
    // 200px holds 44 bars 2.5px wide with at least 2px between them.
    const heights = barHeights();
    expect(heights).toHaveLength(44);
    expect(heights.at(-1)).toBe(30);
    expect(heights.every((height, n) => n === 0 || height >= heights[n - 1]!)).toBe(true);
    expect(player().querySelector("clipPath rect:last-child")).toHaveAttribute("x", "197.5");

    // A sound's whose name shows is shorter.
    render(<AudioPlayer file={stored("theme.mp3", "audio/mpeg", { id: "k2", waveform: Array(WAVEFORM_LENGTH).fill(0) })} />);
    expect(new Set(barHeights("theme.mp3"))).toEqual(new Set([3]));
  });

  it("draws a sound posted without its waveform, as a bot's is, flat, fetching none of it", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<AudioPlayer file={clip({ waveform: undefined })} />);
    expect(new Set(barHeights())).toEqual(new Set([3]));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a sound the browser can't play as its file's card, to download it", () => {
    render(<AudioPlayer file={stored("voice.amr", "audio/amr", { waveform: RISING })} />);
    act(() => void sound("voice.amr").dispatchEvent(new Event("error")));
    expect(screen.queryByRole("group", { name: "voice.amr" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download voice.amr" })).toHaveAttribute("href", stored("voice.amr", "audio/amr").downloadUrl);
  });

  it("gives the sound a bot's edit puts in its message a player of its own, after one the browser couldn't play or one playing", async () => {
    const { rerender } = render(<AudioPlayer file={stored("voice.amr", "audio/amr", { waveform: RISING })} />);
    act(() => void sound("voice.amr").dispatchEvent(new Event("error")));
    rerender(<AudioPlayer file={clip({ id: "k2" })} />);
    expect(sound()).toHaveAttribute("src", clip().url);
    await userEvent.click(playButton());
    sound().currentTime = 13.4;
    act(() => frames.at(-1)!(0));
    expect(shownTime()).toBe("0:13");

    rerender(<AudioPlayer file={stored("theme.mp3", "audio/mpeg", { id: "k3", waveform: RISING })} />);
    expect(playButton("theme.mp3")).toHaveAccessibleName("Play");
    expect(shownTime("theme.mp3")).toBe("0:35");
  });
});
