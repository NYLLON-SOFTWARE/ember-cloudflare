import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { isAllEmoji } from "./emoji";

describe(feature("messages.emoji-only"), () => {
  it("is only emoji, as Ruby's regexp reads it", () => {
    for (const text of ["😄🤘", "👍", "❤️", "👍🏽", "🇨🇦", "©", "™"]) expect(isAllEmoji(text), text).toBe(true);
    for (const text of ["Haha! 😄🤘", "🔥 💯", "", "👨‍👩‍👧", "1️⃣", "😄\n"]) expect(isAllEmoji(text), text).toBe(false);
  });
});
