import type { SkinTone } from "@ember/protocol";

// Emoji of people and hands in the skin tone someone chose on their profile, as Slack's default skin
// tone gives them: those they type by their :codes and add as quick reactions.

/** What each tone is called, the emoji's own yellow first, then Unicode's five, light to dark. */
export const SKIN_TONES: readonly { tone: SkinTone; label: string }[] = [
  { tone: 0, label: "Default" },
  { tone: 1, label: "Light" },
  { tone: 2, label: "Medium-light" },
  { tone: 3, label: "Medium" },
  { tone: 4, label: "Medium-dark" },
  { tone: 5, label: "Dark" },
];

/** Each tone's modifier, U+1F3FB to U+1F3FF. */
const MODIFIERS = ["", "\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"] as const;

/**
 * A person or hand that takes a tone, as Unicode's modifier bases are, with the presentation selector a
 * modifier takes the place of. Holding hands' 🤝 between two people takes none.
 */
const BASE = /(?<!‍)\u{1F91D}(?!‍)️?|(?!\u{1F91D})\p{Emoji_Modifier_Base}️?/gu;

/**
 * `emoji` in `tone`, each person or hand in it taking the tone's modifier, as Unicode's sequences for
 * them are made: 👍🏽, 🧑🏽‍🚒, 🧑🏽‍🤝‍🧑🏽. It's for emoji that come in tones (`takesSkinTone`, or the emoji's
 * list), since a family's people, say, take none.
 */
export function withSkinTone(emoji: string, tone: SkinTone): string {
  if (tone === 0) return emoji;
  return emoji.replace(BASE, (base) => base.replace("️", "") + MODIFIERS[tone]);
}

/** Whether `emoji` is one person or hand that takes a tone, as 👍 and 👋 do. */
export const takesSkinTone = (emoji: string) => /^\p{Emoji_Modifier_Base}️?$/u.test(emoji);
