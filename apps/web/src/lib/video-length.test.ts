import { afterEach, describe, expect, it, vi } from "vitest";
import { videoLengthOf } from "./video-length";

/** A browser's `<video>`, which reads every video's header as saying it plays for `seconds`, or fails to read it. */
function lasting(seconds: number | "unreadable") {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(seconds === "unreadable" ? NaN : seconds);
  const src = vi.spyOn(HTMLMediaElement.prototype, "src", "set").mockImplementation(function (this: HTMLMediaElement) {
    void Promise.resolve().then(() => this.dispatchEvent(new Event(seconds === "unreadable" ? "error" : "loadedmetadata")));
  });
  return src;
}

const clip = () => new File(["video"], "Video clip 2026-11-23 at 10.43.12 AM.mp4", { type: "video/mp4" });

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Video lengths", () => {
  it("reads how long a video plays from its header once, as it's picked to send, to the thousandth of a second", async () => {
    const src = lasting(15.023_456);
    const video = clip();
    expect(await videoLengthOf(video)).toBe(15.023);
    expect(await videoLengthOf(video)).toBe(15.023);
    expect(src).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledWith(video);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:video");
  });

  it("reads no length of a file that isn't a video", async () => {
    const src = lasting(35);
    expect(await videoLengthOf(new File(["sound"], "Audio clip 2026-11-23 at 9.42.10 AM.m4a", { type: "audio/mp4" }))).toBeNull();
    expect(await videoLengthOf(new File(["text"], "notes.txt", { type: "text/plain" }))).toBeNull();
    expect(src).not.toHaveBeenCalled();
  });

  it.each([
    ["a header this browser can't read", "unreadable" as const],
    ["a header that doesn't say, as an unfinished recording's doesn't", Infinity],
    ["a video too short to time", 0.0004],
  ])("sends no length for %s", async (_, seconds) => {
    lasting(seconds);
    expect(await videoLengthOf(clip())).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:video");
  });

  it("gives up on a header the browser hasn't read within five seconds, letting the file go", async () => {
    vi.useFakeTimers();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "src", "set").mockImplementation(() => {});
    const length = videoLengthOf(clip());
    await vi.advanceTimersByTimeAsync(4_999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await length).toBeNull();
    expect(load).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:video");
  });
});
