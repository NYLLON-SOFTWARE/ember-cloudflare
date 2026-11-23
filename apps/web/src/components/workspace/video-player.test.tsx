import { WAVEFORM_LENGTH, type StoredFile } from "@ember/protocol";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeLabel } from "@/lib/messages";
import { AudioPlayer } from "./audio-player";
import { VideoPlayer } from "./video-player";

/** A file called `name`, as a message has it. */
const stored = (name: string, contentType: string, overrides: Partial<StoredFile> = {}): StoredFile => {
  const url = `/files/k1/s1/${encodeURIComponent(name)}`;
  return { id: "k1", name, contentType, byteSize: 1234, url, downloadUrl: `${url}?disposition=attachment`, ...overrides };
};

const CLIP = "Video clip 2026-11-23 at 10.43.12 AM.mp4";

/** A clip from the composer, as a message has it: 720p, with its poster and the length its uploader's browser read. */
const clip = (overrides: Partial<StoredFile> = {}) =>
  stored(CLIP, "video/mp4", { width: 1280, height: 720, previewUrl: `/previews/k1/s1/${encodeURIComponent(CLIP)}`, duration: 15, ...overrides });

/** The videos and sounds playing, as jsdom plays none. */
const playingNow = new Set<HTMLMediaElement>();

/** What each frame of the page will call, as jsdom draws no frames. */
let frames: FrameRequestCallback[] = [];

/** How long the browser says a video is: unknown until it has loaded one, as jsdom loads none. */
let lasting = NaN;

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (this: HTMLMediaElement) {
    return !playingNow.has(this);
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (this: HTMLMediaElement) {
    playingNow.add(this);
    this.dispatchEvent(new Event("play"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    if (playingNow.delete(this)) this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockImplementation(() => lasting);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  // Every line, and its slider, 200px wide, from 100px in.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 0, 200, 24));
  Element.prototype.setPointerCapture ??= () => {};
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  playingNow.clear();
  lasting = NaN;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const name of ["fullscreenEnabled", "fullscreenElement"]) delete (document as unknown as Record<string, unknown>)[name];
  delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
  delete (HTMLVideoElement.prototype as { webkitEnterFullscreen?: unknown }).webkitEnterFullscreen;
});

/** A browser whose pages can be full screen, as jsdom's can't, or can't, as an iPhone's can't, with what `shown` says is full screen. */
function fullScreenable(enabled: boolean, shown: () => Element | null = () => null) {
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => enabled });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: shown });
}

const player = (name = CLIP) => screen.getByRole("group", { name });
const video = (name = CLIP) => player(name).querySelector("video")!;
const slider = (name = CLIP) => within(player(name)).getByRole("slider", { name: "Position" });
const playButton = (name = CLIP) => within(player(name)).getByRole("button", { name: /^(Play|Pause)$/ });
/** What the card says under its title. */
const about = (name = CLIP) => player(name).querySelector("p + p")!.textContent;
/** The times the strip shows, as wide, then as narrow, as one shows at a time. */
const shownTimes = (name = CLIP) => [...player(name).querySelectorAll("span[aria-hidden=true].tabular-nums > span")].map((time) => time.textContent);

/** Has the browser load `name`'s video, saying it's `seconds` long. */
function load(name: string, seconds: number) {
  lasting = seconds;
  fireEvent(video(name), new Event("loadedmetadata"));
}

describe("Video player", () => {
  it("plays a video in place, in a card named for its file, saying when it was recorded and how long it is, loading nothing until it's played", async () => {
    render(<VideoPlayer file={clip()} />);
    expect(video()).toHaveAttribute("src", clip().url);
    expect(video()).toHaveAttribute("poster", clip().previewUrl);
    expect(video()).toHaveAttribute("preload", "none");
    expect(video()).toHaveAttribute("playsinline");
    expect(video()).not.toHaveAttribute("controls");
    // A clip's name says only when it was recorded, which the card says in words.
    expect(within(player()).getByText("Video clip")).toBeVisible();
    expect(about()).toBe(`Recorded Nov 23 at ${timeLabel(new Date(2026, 10, 23, 10, 43))} · 0:15`);
    expect(shownTimes()).toEqual(["0:00 / 0:15", "0:15"]);
    expect(slider()).toHaveAttribute("aria-valuetext", "0:00 of 0:15");
    expect(within(player()).getByRole("link", { name: `Download ${CLIP}` })).toHaveAttribute("href", clip().downloadUrl);

    await userEvent.click(playButton());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(playButton()).toHaveAccessibleName("Pause");

    // As it plays, its time follows it every frame.
    video().currentTime = 13.4;
    act(() => frames.at(-1)!(0));
    expect(shownTimes()).toEqual(["0:13 / 0:15", "0:13"]);
    expect(slider()).toHaveAttribute("aria-valuetext", "0:13 of 0:15");
    expect(slider()).toHaveAttribute("aria-valuemax", "15");

    // A click on the picture pauses it, and plays it again.
    await userEvent.click(video());
    expect(playButton()).toHaveAccessibleName("Play");
    await userEvent.click(video());
    expect(playButton()).toHaveAccessibleName("Pause");
  });

  it("names any other video, with its type and size, and how long it is once the browser says, as it wasn't sent with its length", () => {
    render(<VideoPlayer file={stored("launch.mov", "video/quicktime", { byteSize: 1_482_034 })} />);
    expect(within(player("launch.mov")).getByText("launch.mov")).toBeVisible();
    expect(about("launch.mov")).toBe("MOV · 1.5 MB");
    expect(shownTimes("launch.mov")).toEqual(["0:00", "0:00"]);
    // Without a poster, it loads enough to show its first picture.
    expect(video("launch.mov")).toHaveAttribute("preload", "metadata");

    load("launch.mov", 35.2);
    expect(about("launch.mov")).toBe("MOV · 1.5 MB · 0:35");
    expect(shownTimes("launch.mov")).toEqual(["0:00 / 0:35", "0:35"]);
  });

  it("plays one video or sound at a time, pausing the one playing as another starts", async () => {
    const sound = stored("Audio clip 2026-11-23 at 9.42.10 AM.m4a", "audio/mp4", { id: "k2", waveform: Array(WAVEFORM_LENGTH).fill(50) });
    render(
      <>
        <AudioPlayer file={sound} />
        <VideoPlayer file={clip()} />
        <VideoPlayer file={stored("launch.mp4", "video/mp4", { id: "k3" })} />
      </>,
    );
    await userEvent.click(playButton(sound.name));
    await userEvent.click(playButton());
    expect(playButton(sound.name)).toHaveAccessibleName("Play");
    await userEvent.click(playButton("launch.mp4"));
    expect(playButton()).toHaveAccessibleName("Play");
    expect([...playingNow]).toEqual([video("launch.mp4")]);
  });

  it("moves a video along where its line is pressed, the browser loading one it hadn't there, and by the keys", async () => {
    render(<VideoPlayer file={clip()} />);
    const mouse = { pointerType: "mouse", pointerId: 1, button: 0 };
    fireEvent.pointerDown(slider(), { ...mouse, clientX: 150 });
    expect(video().currentTime).toBe(3.75);
    expect(video()).toHaveProperty("preload", "auto");
    expect(shownTimes()).toEqual(["0:03 / 0:15", "0:03"]);
    fireEvent.pointerUp(slider(), { ...mouse, clientX: 150 });

    slider().focus();
    await userEvent.keyboard("{ArrowRight}{End}");
    expect(video().currentTime).toBe(15);
    await userEvent.keyboard("{Home} ");
    expect(video().currentTime).toBe(0);
    expect(playButton()).toHaveAccessibleName("Pause");
  });

  it("shows the time a mouse hovers over on its line, with a picture of that moment, which a silent copy of the video finds", () => {
    const created = vi.spyOn(document, "createElement");
    const drawn = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: drawn } as unknown as CanvasRenderingContext2D);
    const { unmount } = render(<VideoPlayer file={clip()} />);
    created.mockClear();
    const mouse = { pointerType: "mouse", pointerId: 1, button: 0 };
    fireEvent.pointerMove(slider(), { ...mouse, clientX: 240 });
    expect(within(player()).getByText("0:10")).toBeVisible();
    const canvas = player().querySelector("canvas")!;
    expect(canvas).not.toHaveAttribute("data-drawn");

    const copy = created.mock.results.map(({ value }) => value as HTMLElement).find((element) => element instanceof HTMLVideoElement)!;
    expect(copy).toHaveAttribute("src", clip().url);
    expect(copy.muted).toBe(true);
    expect(copy).not.toBe(video());
    // Once it has loaded and moved there, it draws itself, then moves to where the mouse went meanwhile.
    fireEvent.pointerMove(slider(), { ...mouse, clientX: 280 });
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(HTMLMediaElement.HAVE_METADATA);
    fireEvent(copy, new Event("loadedmetadata"));
    expect((copy as HTMLVideoElement).currentTime).toBe(10.5);
    fireEvent(copy, new Event("seeked"));
    expect(drawn).toHaveBeenCalledExactlyOnceWith(copy, 0, 0, canvas.width, canvas.height);
    expect(canvas).toHaveAttribute("data-drawn");
    expect((copy as HTMLVideoElement).currentTime).toBe(13.5);
    expect(video().currentTime).toBe(0);

    fireEvent.pointerLeave(slider(), mouse);
    expect(within(player()).queryByText("0:10")).not.toBeInTheDocument();
    expect(player().querySelector("canvas")).not.toBeInTheDocument();

    // A finger shows no moment, as it hovers over nothing.
    fireEvent.pointerMove(slider(), { pointerType: "touch", pointerId: 2, clientX: 240 });
    expect(player().querySelector("canvas")).not.toBeInTheDocument();

    // The copy goes with the player.
    unmount();
    expect(copy).not.toHaveAttribute("src");
  });

  it("mutes and unmutes a video with its sound button, which says whether it's pressed", async () => {
    render(<VideoPlayer file={clip()} />);
    const sound = within(player()).getByRole("button", { name: "Mute" });
    expect(sound).toHaveAttribute("aria-pressed", "false");
    expect(sound.querySelector("svg")).toHaveClass("iconoir-sound-high-solid");

    await userEvent.click(sound);
    expect(video().muted).toBe(true);
    fireEvent(video(), new Event("volumechange"));
    expect(sound).toHaveAttribute("aria-pressed", "true");
    expect(sound.querySelector("svg")).toHaveClass("iconoir-sound-off-solid");

    await userEvent.click(sound);
    expect(video().muted).toBe(false);
    fireEvent(video(), new Event("volumechange"));
    expect(sound).toHaveAttribute("aria-pressed", "false");
  });

  it("plays at the speed every player last picked", async () => {
    render(<VideoPlayer file={clip()} />);
    const speed = within(player()).getByRole("button", { name: "Playback speed, 1 times" });
    await userEvent.click(speed);
    expect(speed).toHaveAccessibleName("Playback speed, 1.5 times");
    expect(video().playbackRate).toBe(1.5);
    expect(localStorage.getItem("ember:playback-rate")).toBe("1.5");
  });

  it("keeps a speed picked in the browser's own player, as full screen shows it, as every player's", async () => {
    const sound = stored("Audio clip 2026-11-23 at 9.42.10 AM.m4a", "audio/mp4", { id: "k2", waveform: Array(WAVEFORM_LENGTH).fill(50) });
    render(
      <>
        <VideoPlayer file={clip()} />
        <AudioPlayer file={sound} />
      </>,
    );
    const speed = (name = CLIP) => within(player(name)).getByRole("button", { name: /^Playback speed/ });
    act(() => {
      video().playbackRate = 1.25;
      video().dispatchEvent(new Event("ratechange"));
    });
    expect(speed()).toHaveAccessibleName("Playback speed, 1.25 times");
    expect(speed(sound.name)).toHaveTextContent("1.25×");
    expect(player(sound.name).querySelector("audio")!.playbackRate).toBe(1.25);
    expect(localStorage.getItem("ember:playback-rate")).toBe("1.25");

    // The card's button goes on from it to 1×.
    await userEvent.click(speed());
    expect(speed()).toHaveAccessibleName("Playback speed, 1 times");
    expect(video().playbackRate).toBe(1);
  });

  it("plays full screen in the browser's own player, with its controls, until it leaves full screen", async () => {
    let shown: Element | null = null;
    fullScreenable(true, () => shown);
    const requested = vi.fn(async function (this: Element) {
      shown = this;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    HTMLElement.prototype.requestFullscreen = requested;
    render(<VideoPlayer file={clip()} />);

    await userEvent.click(within(player()).getByRole("button", { name: "Full screen" }));
    expect(requested.mock.contexts).toEqual([video()]);
    expect(video()).toHaveAttribute("controls");

    shown = null;
    act(() => void document.dispatchEvent(new Event("fullscreenchange")));
    expect(video()).not.toHaveAttribute("controls");
  });

  it("plays full screen in an iPhone's own player, whose pages can't be full screen", async () => {
    fullScreenable(false);
    const entered = vi.fn(function (this: HTMLVideoElement) {
      // As an iPhone won't before it has loaded the video.
      if (entered.mock.calls.length === 1) throw new DOMException("The object is in an invalid state.", "InvalidStateError");
    });
    Object.assign(HTMLVideoElement.prototype, { webkitEnterFullscreen: entered });
    render(<VideoPlayer file={clip()} />);
    const fullScreen = within(player()).getByRole("button", { name: "Full screen" });
    await userEvent.click(fullScreen);
    // Its first press plays it in place, loading it.
    expect(playButton()).toHaveAccessibleName("Pause");
    await userEvent.click(fullScreen);
    expect(entered.mock.contexts).toEqual([video(), video()]);
    expect(video()).not.toHaveAttribute("controls");
  });

  it("shows an upright video at its tallest, its sides filled with its poster, blurred", () => {
    const upright = clip({ width: 720, height: 1280 });
    const { container } = render(<VideoPlayer file={upright} />);
    const backdrop = container.querySelector("img")!;
    expect(backdrop).toHaveAttribute("src", upright.previewUrl);
    expect(backdrop).toHaveAttribute("alt", "");
    expect(video().parentElement).toHaveStyle({ aspectRatio: "0.5625" });
    expect(video().parentElement).toHaveClass("max-h-[320px]");
  });

  it("shows a wide video across its card, with nothing at its sides", () => {
    const { container } = render(<VideoPlayer file={clip()} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(video().parentElement).toHaveStyle({ aspectRatio: String(1280 / 720) });
  });

  it("shows a video the browser can't play as its file's card, to download it", () => {
    render(<VideoPlayer file={stored("screen.mkv", "video/x-matroska")} />);
    act(() => void video("screen.mkv").dispatchEvent(new Event("error")));
    expect(screen.queryByRole("group", { name: "screen.mkv" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download screen.mkv" })).toHaveAttribute("href", stored("screen.mkv", "video/x-matroska").downloadUrl);
  });
});
