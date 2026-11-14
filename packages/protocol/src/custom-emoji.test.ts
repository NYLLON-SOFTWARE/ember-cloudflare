import { describe, expect, it } from "vitest";
import {
  CUSTOM_EMOJI_NAME_IS_STANDARD,
  customEmojiApiPath,
  customEmojiImagePath,
  customEmojiNameIn,
  customEmojiNameOf,
  customEmojiNameProblem,
  emojiSegments,
  MAX_CUSTOM_EMOJI_NAME_LENGTH,
  type CustomEmoji,
} from "./custom-emoji.ts";
import { isBoostLength, MAX_BOOST_LENGTH, parseClientFrame } from "./index.ts";
import { isAppPage, workspacePageOf } from "./pages.ts";

const emoji = (name: string): CustomEmoji => ({ name, key: `key-of-${name}`, creatorId: "u1", createdAt: "2026-11-14T12:00:00.000Z" });
const shipit = emoji("shipit");
const parrot = emoji("party_parrot");
const named = (name: string) => [shipit, parrot].find((one) => one.name === name);

describe("A custom emoji's name", () => {
  it("is lowercase letters, numbers, underscores, hyphens and plus signs, from 2 to 32 characters", () => {
    for (const name of ["shipit", "party_parrot", "this-is-fine", "c++", "100percent", "ok", "x".repeat(MAX_CUSTOM_EMOJI_NAME_LENGTH)]) {
      expect(customEmojiNameProblem(name), name).toBeNull();
    }
    for (const name of ["", "x", "Shipit", "ship it", "ship:it", "_shipit", "-1up", "+1up", "café", "x".repeat(MAX_CUSTOM_EMOJI_NAME_LENGTH + 1)]) {
      expect(customEmojiNameProblem(name), name).toEqual(expect.any(String));
    }
  });

  it("is never one of Slack's codes for the skin tones", () => {
    for (const tone of [2, 3, 4, 5, 6]) expect(customEmojiNameProblem(`skin-tone-${tone}`)).toBe(CUSTOM_EMOJI_NAME_IS_STANDARD);
    expect(customEmojiNameProblem("skin-tone-7")).toBeNull();
  });

  it("is suggested by its picture's file name, as Slack suggests one", () => {
    expect(customEmojiNameOf("Party Parrot.gif")).toBe("party_parrot");
    expect(customEmojiNameOf("ship-it.final.PNG")).toBe("ship-it_final");
    expect(customEmojiNameOf("  __Très bien!__.webp")).toBe("tr_s_bien");
    expect(customEmojiNameOf(`${"x".repeat(60)}.png`)).toBe("x".repeat(MAX_CUSTOM_EMOJI_NAME_LENGTH));
    expect(customEmojiNameOf("😀.png")).toBe("");
    for (const file of ["Party Parrot.gif", "ship-it.final.PNG", "a.b.c.jpg"]) expect(customEmojiNameProblem(customEmojiNameOf(file))).toBeNull();
  });

  it("has addresses for its picture and for removing it", () => {
    expect(customEmojiImagePath("abc123")).toBe("/emoji/abc123");
    expect(customEmojiApiPath("c++")).toBe("/api/emoji/c%2B%2B");
  });
});

describe("Custom emoji in text", () => {
  it("are cut out by their codes, leaving the rest as it's written", () => {
    expect(emojiSegments("Ready to :shipit: now", named)).toEqual(["Ready to ", shipit, " now"]);
    expect(emojiSegments(":shipit:", named)).toEqual([shipit]);
    expect(emojiSegments(":shipit::party_parrot:!", named)).toEqual([shipit, parrot, "!"]);
    expect(emojiSegments("no codes here", named)).toEqual(["no codes here"]);
    expect(emojiSegments("", named)).toEqual([]);
  });

  it("leave a code no custom emoji has as text, as one removed since shows", () => {
    expect(emojiSegments("see :nothing: and :Shipit:", named)).toEqual(["see :nothing: and :Shipit:"]);
  });

  it("let a colon close one code or open the next, but not both", () => {
    expect(emojiSegments("at 12:30:shipit:", named)).toEqual(["at 12:30", shipit]);
    expect(emojiSegments(":a:shipit:b:", named)).toEqual([":a", shipit, "b:"]);
    expect(emojiSegments(":shipit:shipit:", named)).toEqual([shipit, "shipit:"]);
  });

  it("are found again each time, whatever was searched before", () => {
    expect(emojiSegments("x :shipit:", named)).toEqual(["x ", shipit]);
    expect(emojiSegments(":shipit:", named)).toEqual([shipit]);
  });
});

describe("A reaction of a custom emoji", () => {
  it("is its code and nothing else", () => {
    expect(customEmojiNameIn(":shipit:")).toBe("shipit");
    expect(customEmojiNameIn(`:${"x".repeat(MAX_CUSTOM_EMOJI_NAME_LENGTH)}:`)).toBe("x".repeat(MAX_CUSTOM_EMOJI_NAME_LENGTH));
    for (const text of ["shipit", ":shipit", ":shipit: ", ":shipit::shipit:", ":x:", ":Shipit:", `:${"x".repeat(MAX_CUSTOM_EMOJI_NAME_LENGTH + 1)}:`]) {
      expect(customEmojiNameIn(text), text).toBeNull();
    }
  });

  it("can be longer than Campfire's 16 characters, which anything else still keeps to", () => {
    const code = `:${"x".repeat(MAX_CUSTOM_EMOJI_NAME_LENGTH)}:`;
    expect(isBoostLength(code)).toBe(true);
    expect(isBoostLength("x".repeat(MAX_BOOST_LENGTH))).toBe(true);
    expect(isBoostLength("x".repeat(MAX_BOOST_LENGTH + 1))).toBe(false);
    expect(isBoostLength(`${code}!`)).toBe(false);

    const boost = (content: string) => parseClientFrame(JSON.stringify({ type: "boost.create", messageId: "m1", content }));
    expect(boost(` ${code} `)).toEqual({ type: "boost.create", messageId: "m1", content: code });
    expect(boost(`${code}!`)).toBeNull();
    expect(boost(`:${"x".repeat(MAX_CUSTOM_EMOJI_NAME_LENGTH + 1)}:`)).toBeNull();
  });
});

describe("The Custom emoji page", () => {
  it("is one of the app's pages, at /account/emoji, and an emoji's picture isn't", () => {
    expect(workspacePageOf("/account/emoji")).toEqual({ page: "custom-emoji" });
    expect(isAppPage("/account/emoji")).toBe(true);
    expect(isAppPage("/emoji/abc123")).toBe(false);
  });
});
