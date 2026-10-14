import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { pendingSound, soundIn, SOUND_NAMES, SOUNDS } from "./sounds";

describe(feature("messages.sounds"), () => {
  it("has Campfire's 56 sounds, each with its text or picture", () => {
    expect(SOUNDS).toHaveLength(56);
    expect(SOUND_NAMES[0]).toBe("56k");
    expect(SOUND_NAMES.at(-1)).toBe("yodel");
    expect(soundIn("/play bell")).toEqual({ name: "bell", text: "🔔" });
    expect(soundIn("/play deeper")).toEqual({ name: "deeper", image: { file: "top.webp", width: 188, height: 80 } });
  });

  it("plays a message of exactly /play and a sound's name", () => {
    for (const text of ["/play bell\n", "/play tada now", "/play nope", "/play Bell", "x /play bell", " /play bell", "/play  bell"]) {
      expect(soundIn(text), text).toBeUndefined();
    }
  });

  it("shows a message being sent as playing whenever it starts with /play and a sound's name", () => {
    expect(pendingSound("/play tada now")).toBe("tada");
    expect(pendingSound("  /play bell\n")).toBe("bell");
    expect(pendingSound("/play nope")).toBeUndefined();
    expect(pendingSound("say /play bell")).toBeUndefined();
  });
});
