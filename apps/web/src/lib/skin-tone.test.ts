import emojibase from "emojibase-data/en/data.json";
import { describe, expect, it } from "vitest";
import rows from "./emoji-data.json";
import { takesSkinTone, withSkinTone } from "./skin-tone";

describe("Emoji in a skin tone", () => {
  it("puts each tone's modifier after a person or hand, and leaves the default as it is", () => {
    expect(withSkinTone("👍", 3)).toBe("👍🏽");
    expect(withSkinTone("✌️", 1)).toBe("✌🏻");
    expect(withSkinTone("🧑‍🚒", 5)).toBe("🧑🏿‍🚒");
    expect(withSkinTone("🧑‍🤝‍🧑", 2)).toBe("🧑🏼‍🤝‍🧑🏼");
    expect(withSkinTone("👍", 0)).toBe("👍");
  });

  it("makes every toned emoji the list has as Unicode does, in each tone", () => {
    const unicode = new Map(emojibase.map((entry) => [entry.emoji, entry.skins ?? []]));
    const toned = rows.filter((row) => row[4] === 1).map(([emoji]) => emoji as string);
    expect(toned.length).toBeGreaterThan(300);
    for (const emoji of toned) {
      for (const tone of [1, 2, 3, 4, 5] as const) {
        const skin = unicode.get(emoji)!.find((skin) => skin.tone === tone || (Array.isArray(skin.tone) && skin.tone.every((each) => each === tone)));
        expect(withSkinTone(emoji, tone), `${emoji} in tone ${tone}`).toBe(skin?.emoji);
      }
    }
  });

  it("knows which quick reactions are a person or hand", () => {
    expect(["👍", "👏", "👋", "💪", "❤️", "😂", "🎉", "🔥"].filter(takesSkinTone)).toEqual(["👍", "👏", "👋", "💪"]);
  });
});
