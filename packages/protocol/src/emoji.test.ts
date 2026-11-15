import { describe, expect, it } from "vitest";
import { EMOJI_CATEGORIES } from "./emoji";
import { REACTIONS } from "./index";

const everyEmoji = EMOJI_CATEGORIES.flatMap(({ emoji }) => emoji);

describe("The emoji picker's emoji", () => {
  it("are in Slack's categories, in its order", () => {
    expect(EMOJI_CATEGORIES.map(({ name }) => name)).toEqual(["Smileys & People", "Animals & Nature", "Food & Drink", "Activities", "Travel & Places", "Objects", "Symbols", "Flags"]);
    for (const { name, emoji } of EMOJI_CATEGORIES) expect(emoji.length, name).toBeGreaterThan(50);
  });

  it("hold each emoji once, with its short names, which no other emoji has", () => {
    expect(new Set(everyEmoji.map(([emoji]) => emoji)).size).toBe(everyEmoji.length);
    const names = everyEmoji.flatMap(([, ...names]) => names);
    expect(new Set(names).size).toBe(names.length);
    for (const [emoji, ...names] of everyEmoji) expect(names.length, emoji).toBeGreaterThan(0);
    expect(everyEmoji).toContainEqual(["👍", "+1", "thumbsup"]);
    expect(everyEmoji).toContainEqual(["🎉", "tada"]);
  });

  it("start with the smileys, in Unicode's order, and leave out the skin tones, which aren't picked on their own", () => {
    expect(EMOJI_CATEGORIES[0]!.emoji.slice(0, 3)).toEqual([
      ["😀", "grinning"],
      ["😃", "smiley"],
      ["😄", "smile"],
    ]);
    expect(everyEmoji.some(([, ...names]) => names.some((name) => name.startsWith("skin-tone")))).toBe(false);
  });

  it("include the reactions'", () => {
    for (const [reaction] of REACTIONS) expect(everyEmoji.some(([emoji]) => emoji === reaction), reaction).toBe(true);
  });
});
