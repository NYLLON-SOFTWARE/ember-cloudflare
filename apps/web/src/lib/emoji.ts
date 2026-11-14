import type { SkinTone } from "@ember/protocol";
import { withSkinTone } from "./skin-tone";

// Emoji by their :codes, as Slack writes them: typing a colon and two or more letters lists the emoji
// whose codes or names hold them, and typing the closing colon of a code puts its emoji in its place.
// The emoji and their codes are emojibase's, under its MIT license, with Slack's codes from iamcal's
// emoji-data (scripts/emoji.ts), loaded as the first code is typed, since they're 45 KB. Emoji of people
// and hands come in the skin tone you chose, and a code followed by Slack's :skin-tone-2: to
// :skin-tone-6: in that tone instead.

/**
 * An emoji, its name, Slack's codes for it, other words that find it, and 1 if it comes in skin tones, as
 * `emoji-data.json` lists it.
 */
type Row = [emoji: string, name: string, codes: string[], tags: string[], toned?: 1];

export interface EmojiMatch {
  /** The emoji, in your skin tone if it comes in tones. */
  emoji: string;
  /** The emoji without a tone, as `recentEmoji` remembers it. */
  base: string;
  name: string;
  /** The code that matched what was typed, or the emoji's first. */
  code: string;
}

export interface EmojiIndex {
  rows: Row[];
  /** Each code's emoji, and whether it comes in tones. */
  byCode: Map<string, { emoji: string; toned: boolean }>;
  /** The emoji that come in tones, by `bare` emoji. */
  toned: Map<string, string>;
}

/** `emoji` without a tone or presentation selectors, which is how emoji in any tone are found among the toned. */
const bare = (emoji: string) => emoji.replace(/[\u{1F3FB}-\u{1F3FF}\uFE0F]/gu, "");

/** `emoji` in `skinTone` if it comes in tones. */
const inTone = (emoji: string, toned: boolean, skinTone: SkinTone) => (toned ? withSkinTone(emoji, skinTone) : emoji);

/**
 * Emoji a search lists before others it finds as well, after those you've used lately: Ember's reactions,
 * `REACTIONS` in @ember/protocol. They're copied, as the editor imports this, and its importing the
 * protocol's index would split the app's script (oneAppScript in vite.config.ts).
 */
export const FAVORED = ["👍", "👏", "👋", "💪", "❤️", "😂", "🎉", "🔥"];

/** How many emoji a search lists, as many as Slack's list shows at once. */
export const MAX_MATCHES = 8;

/**
 * A code being typed: a colon at the start or after a space or an opening bracket, so "12:30" and
 * "Note:" aren't, then two or more of the letters, digits, `_`, `+` and `-` codes are made of, up to
 * the cursor. ":)" and ":D" aren't either.
 */
const TYPING_CODE = /(?:^|[\s([{]):([a-z0-9_+-]{2,})$/i;

/** A code just closed with its colon, preceded as `TYPING_CODE`'s are. */
const CLOSED_CODE = /(?:^|[\s([{]):([a-z0-9_+-]+):$/i;

/** Slack's code for a skin tone, after an emoji, just closed: :skin-tone-2: is the lightest, and :skin-tone-6: the darkest. */
const SKIN_TONE_CODE = /:skin-tone-([2-6]):$/i;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

let loading: Promise<EmojiIndex> | null = null;
let loaded: EmojiIndex | null = null;

/** The emoji, loaded once, or tried again the next time they're wanted if they couldn't be. */
export function loadEmoji(): Promise<EmojiIndex> {
  loading ??= import("./emoji-data.json").then(
    ({ default: rows }) => (loaded = indexOf(rows as Row[])),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The emoji, if they've loaded. */
export const loadedEmoji = (): EmojiIndex | null => loaded;

export function indexOf(rows: Row[]): EmojiIndex {
  const byCode = new Map<string, { emoji: string; toned: boolean }>();
  const toned = new Map<string, string>();
  for (const [emoji, , codes, , takesTone] of rows) {
    for (const code of codes) byCode.set(code, { emoji, toned: takesTone === 1 });
    if (takesTone) toned.set(bare(emoji), emoji);
  }
  return { rows, byCode, toned };
}

/** What's typed after the colon of a code that ends at the cursor, given the text before it, or null. */
export function typedCode(textBeforeCursor: string): string | null {
  return TYPING_CODE.exec(textBeforeCursor)?.[1] ?? null;
}

/**
 * The code a colon just closed, given the text before the cursor, what's typed that it replaces, and
 * its emoji, in `skinTone` if it comes in tones, or null if there's none, or it's no code of an emoji's,
 * as in "see :foo:". A skin tone's code after an emoji that comes in tones puts it in that tone instead,
 * replacing it too, so :wave::skin-tone-4: is 👋🏽 whatever tone you chose.
 */
export function closedCode(index: EmojiIndex, textBeforeCursor: string, skinTone: SkinTone = 0): { typed: string; emoji: string; base: string } | null {
  const toneCode = SKIN_TONE_CODE.exec(textBeforeCursor);
  if (toneCode) return toneChanged(index, textBeforeCursor.slice(0, toneCode.index), toneCode[0], (Number(toneCode[1]) - 1) as SkinTone);
  const code = CLOSED_CODE.exec(textBeforeCursor)?.[1];
  const found = code && index.byCode.get(code.toLowerCase());
  return found ? { typed: `:${code}:`, emoji: inTone(found.emoji, found.toned, skinTone), base: found.emoji } : null;
}

/** The emoji that ends `before`, if it comes in tones, in `skinTone`, replacing it and `toneCode` after it. */
function toneChanged(index: EmojiIndex, before: string, toneCode: string, skinTone: SkinTone) {
  const last = [...graphemes.segment(before)].at(-1)?.segment;
  const base = last && index.toned.get(bare(last));
  return base ? { typed: last + toneCode, emoji: withSkinTone(base, skinTone), base } : null;
}

/** The rank of an emoji `query` finds only inside a word of one of its codes. */
const WITHIN = 4;

/**
 * How well `query` finds an emoji, lower being better, with the code that matched: one of its codes, a
 * code that starts with it, a word of a code that does, a word of its name or one of its other words that
 * does, or a code that holds it anywhere. Null when none does.
 */
function rankOf([, name, codes, tags]: Row, query: string): { rank: number; code: string } | null {
  const exact = codes.find((code) => code === query);
  if (exact) return { rank: 0, code: exact };
  const prefixed = codes.find((code) => code.startsWith(query));
  if (prefixed) return { rank: 1, code: prefixed };
  const word = codes.find((code) => code.split(/[_-]/).some((part) => part.startsWith(query)));
  if (word) return { rank: 2, code: word };
  if ([...name.split(" "), ...tags].some((part) => part.startsWith(query))) return { rank: 3, code: codes[0]! };
  const within = codes.find((code) => code.includes(query));
  return within ? { rank: WITHIN, code: within } : null;
}

/**
 * The emoji `query` finds, in `skinTone` if they come in tones, best first, much as Slack orders them: an emoji whose code it is, then those
 * you've used lately, latest first, then Ember's reactions, so :th finds 👍 before :three:, then the rest
 * by how well it finds them and then in Unicode's order.
 */
export function searchEmoji(index: EmojiIndex, query: string, recent: readonly string[] = [], skinTone: SkinTone = 0, limit = MAX_MATCHES): EmojiMatch[] {
  const typed = query.toLowerCase();
  const favored = [...recent, ...FAVORED];
  // Only a word that starts with what's typed favors an emoji, so :cl finds 👏 sooner, but not 💪 :muscle:.
  const favor = ({ row: [emoji], rank }: { row: Row; rank: number }) => {
    const position = rank === WITHIN ? -1 : favored.indexOf(emoji);
    return position === -1 ? favored.length : position;
  };
  return index.rows
    .flatMap((row, order) => {
      const ranked = rankOf(row, typed);
      return ranked ? [{ row, order, ...ranked }] : [];
    })
    .sort(
      (a, b) =>
        Number(a.rank !== 0) - Number(b.rank !== 0) ||
        favor(a) - favor(b) ||
        a.rank - b.rank ||
        a.order - b.order,
    )
    .slice(0, limit)
    .map(({ row: [emoji, name, , , toned], code }) => ({ emoji: inTone(emoji, toned === 1, skinTone), base: emoji, name, code }));
}

const RECENT_KEY = "ember:recent-emoji";
/** How many emoji you've used lately are remembered. */
const MAX_RECENT = 24;

/** The emoji this browser has put in place of a code lately, latest first, without their tones. */
export function recentEmoji(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((emoji): emoji is string => typeof emoji === "string") : [];
  } catch {
    return [];
  }
}

/** Remembers `emoji` as the latest used, so searches list it sooner. */
export function rememberEmoji(emoji: string): void {
  try {
    const recent = [emoji, ...recentEmoji().filter((other) => other !== emoji)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Storage can be refused, and then searches keep Unicode's order.
  }
}
