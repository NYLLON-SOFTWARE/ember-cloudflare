import { feature } from "@ember/parity";
import { SOUNDS, soundIn } from "@ember/richtext/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { playSound, soundImageUrl, soundUrl } from "./sounds";

/** Stands in for the browser's Audio where it refuses to play, as before the page has been used. */
class RefusingAudio {
  static played: string[] = [];

  constructor(readonly src: string) {}

  play() {
    RefusingAudio.played.push(this.src);
    return Promise.reject(new DOMException("play() can only be initiated by a user gesture.", "NotAllowedError"));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe(feature("messages.sounds"), () => {
  it("serves each sound's clip and picture under /sounds/", () => {
    expect(soundUrl(soundIn("/play bell")!)).toBe("/sounds/bell.mp3");
    // deeper's picture is top.webp, as in Campfire.
    const deeper = SOUNDS.find((sound) => sound.name === "deeper")!;
    expect("image" in deeper && soundImageUrl(deeper.image)).toBe("/sounds/images/top.webp");
  });

  it("plays a sound once, saying nothing when the browser refuses to", async () => {
    vi.stubGlobal("Audio", RefusingAudio);
    playSound(soundIn("/play tada")!);
    expect(RefusingAudio.played).toEqual(["/sounds/tada.mp3"]);
    // A refusal left unhandled fails the run once the event loop turns.
    await new Promise((resolve) => setTimeout(resolve));
  });
});
