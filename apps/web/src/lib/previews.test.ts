import { feature } from "@ember/parity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fitted, previewOf } from "./previews";

// jsdom decodes no pictures, plays no videos and draws nothing, so these stand in for the browser's,
// and e2e/ makes real previews.

/** The canvases drawn on, and what each drew. */
let canvases: Array<{ width: number; height: number; drawn: unknown[] }>;
/** The types this browser encodes, beyond PNG, which every browser encodes. */
let encodes: Set<string>;
/** The videos made to take posters from. */
let videos: HTMLVideoElement[];

beforeEach(() => {
  canvases = [];
  encodes = new Set(["image/webp", "image/jpeg"]);
  videos = [];
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:file");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    const canvas = { width: this.width, height: this.height, drawn: [] as unknown[] };
    canvases.push(canvas);
    return { drawImage: (...args: unknown[]) => canvas.drawn.push(args) } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type = "image/png", quality) => {
    callback(new Blob([`${type} at ${quality}`], { type: encodes.has(type) ? type : "image/png" }));
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((name: string, options?: ElementCreationOptions) => {
    const element = createElement(name, options);
    if (element instanceof HTMLVideoElement) videos.push(element);
    return element;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Has pictures decode as `width` by `height`, or fail to, as Chrome fails to decode HEIC. */
function decodes(width: number, height: number, ok = true) {
  HTMLImageElement.prototype.decode = vi.fn(() => (ok ? Promise.resolve() : Promise.reject(new DOMException("The source image cannot be decoded.", "EncodingError"))));
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(height);
}

interface VideoSize {
  duration?: number;
  width?: number;
  height?: number;
}

/**
 * Answers `video`'s loading as a browser would for one `duration` seconds long and `width` by `height`,
 * answering what tells where it was asked to seek to, once it has been.
 */
function loads(video: HTMLVideoElement, { duration = 12, width = 1920, height = 1080 }: VideoSize = {}): () => number {
  let seekedTo = Number.NaN;
  Object.defineProperties(video, {
    duration: { value: duration },
    videoWidth: { value: width },
    videoHeight: { value: height },
    currentTime: { get: () => seekedTo, set: (time: number) => (seekedTo = time) },
  });
  video.dispatchEvent(new Event("loadedmetadata"));
  return () => seekedTo;
}

/** Answers `video`'s loading and seeking as a browser would, as `loads` does, answering where it was asked to seek to. */
async function plays(video: HTMLVideoElement, size?: VideoSize): Promise<number> {
  const seekedTo = loads(video, size);
  await vi.waitFor(() => expect(seekedTo()).not.toBeNaN());
  video.dispatchEvent(new Event("seeked"));
  return seekedTo();
}

const file = (name: string, type: string) => new File(["bytes"], name, { type });

describe(feature("attachments.previews"), () => {
  it("scales a preview down, never up, to fit 1200×800, as ember-rust's `resize_to_limit` does", () => {
    const sizes = [
      [4000, 2667],
      [1920, 1080],
      [1000, 3000],
      [1200, 800],
      [40, 30],
      [5000, 1],
    ].map(([width, height]) => fitted({ width: width!, height: height! }));
    expect(sizes).toEqual([
      { width: 1200, height: 800 },
      { width: 1200, height: 675 },
      { width: 267, height: 800 },
      { width: 1200, height: 800 },
      { width: 40, height: 30 },
      { width: 1200, height: 1 },
    ]);
  });

  it("makes a picture's thumbnail as WebP, scaled to fit 1200×800, and lets go of the file", async () => {
    decodes(2400, 1600);
    const preview = await previewOf(file("moon.png", "image/png"));
    expect(preview?.type).toBe("image/webp");
    expect(await preview?.text()).toBe("image/webp at 0.85");
    expect(canvases).toMatchObject([{ width: 1200, height: 800, drawn: [[expect.any(HTMLImageElement), 0, 0, 1200, 800]] }]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:file");

    // A small picture keeps its size.
    decodes(40, 30);
    await previewOf(file("dot.gif", "image/gif"));
    expect(canvases[1]).toMatchObject({ width: 40, height: 30 });
  });

  it("makes a JPEG where the browser can't encode WebP, as Safari can't, unless the picture can be see-through, which a PNG keeps", async () => {
    encodes.delete("image/webp");
    decodes(800, 600);
    expect((await previewOf(file("photo.jpg", "image/jpeg")))?.type).toBe("image/jpeg");
    for (const type of ["image/png", "image/gif", "image/webp", "image/heic"]) expect((await previewOf(file("picture", type)))?.type).toBe("image/png");
  });

  it("makes a video's poster from its frame a tenth of a second in, or halfway through a shorter one, then lets go of the video", async () => {
    const making = previewOf(file("launch.mp4", "video/mp4"));
    const [video] = videos;
    expect(video).toMatchObject({ muted: true, preload: "auto", src: "blob:file" });
    expect(await plays(video!)).toBe(0.1);
    const poster = await making;
    expect(poster?.type).toBe("image/webp");
    expect(canvases).toMatchObject([{ width: 1200, height: 675, drawn: [[video, 0, 0, 1200, 675]] }]);
    expect(video).not.toHaveAttribute("src");
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();

    // Photos are never see-through, so neither are videos.
    encodes.delete("image/webp");
    const short = previewOf(file("blink.webm", "video/webm"));
    expect(await plays(videos[1]!, { duration: 0.06 })).toBe(0.03);
    expect((await short)?.type).toBe("image/jpeg");
  });

  it("makes none for a file that isn't a picture or a video, or that the browser can't decode or doesn't within five seconds", async () => {
    for (const [name, type] of [
      ["notes.txt", "text/plain"],
      ["logo.svg", "image/svg+xml"],
      ["photo", ""],
    ]) expect(await previewOf(file(name!, type!))).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    decodes(0, 0, false);
    expect(await previewOf(file("photo.heic", "image/heic"))).toBeNull();
    const broken = previewOf(file("broken.mov", "video/quicktime"));
    videos[0]!.dispatchEvent(new Event("error"));
    expect(await broken).toBeNull();
    // A recording of sound alone has no picture.
    const sound = previewOf(file("interview.mp4", "video/mp4"));
    await plays(videos[1]!, { width: 0, height: 0 });
    expect(await sound).toBeNull();
    expect(canvases).toEqual([]);

    vi.useFakeTimers();
    const stuck = previewOf(file("huge.mp4", "video/mp4"));
    const huge = videos[2]!;
    const seekedTo = loads(huge, { duration: 600, width: 3840, height: 2160 });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(seekedTo()).toBe(0.1);
    expect(huge).toHaveAttribute("src");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(await stuck).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
    // It lets go of the video then, so a seek that ends after draws nothing.
    expect(huge).not.toHaveAttribute("src");
    huge.dispatchEvent(new Event("seeked"));
    await vi.advanceTimersByTimeAsync(0);
    expect(canvases).toEqual([]);

    // A picture that hasn't decoded by then goes without one too.
    HTMLImageElement.prototype.decode = vi.fn(() => new Promise<void>(() => {}));
    const slow = previewOf(file("panorama.png", "image/png"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await slow).toBeNull();
    expect(canvases).toEqual([]);

    // And so does one still being encoded.
    decodes(2400, 1600);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(() => {});
    const encoding = previewOf(file("mural.png", "image/png"));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(canvases).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await encoding).toBeNull();
  });
});
