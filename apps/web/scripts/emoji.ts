// Writes src/lib/emoji-data.json, the emoji that :codes find, from emojibase-data:
//
//   pnpm --filter @ember/web emoji
//
// Each is [emoji, name, Slack's codes for it, words that find it too], and 1 after them for an emoji that
// comes in skin tones (src/lib/skin-tone.ts makes them), in Unicode's order. The codes are
// Slack's (emojibase's iamcal set, from iamcal/emoji-data, which Slack's are), so :tada: and :+1: work as
// they do there. Emoji newer than 15.0 are left out, as phones and computers a few years old draw them
// as boxes, and so are skin tones, components and the regional indicators flags are made of.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The newest emoji version left in: 2022's, which iOS 16.4, macOS 13.3, Android 14 and Windows 11 draw. */
const NEWEST_VERSION = 15;

interface EmojibaseEmoji {
  emoji: string;
  hexcode: string;
  label: string;
  tags?: string[];
  skins?: unknown[];
  group?: number;
  order?: number;
  version: number;
}

const data = path.resolve(import.meta.dirname, "../node_modules/emojibase-data/en");
const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(data, file), "utf8")) as T;

const emoji = read<EmojibaseEmoji[]>("data.json");
const slackCodes = read<Record<string, string | string[]>>("shortcodes/iamcal.json");

/** Slack's codes for the emoji, or its name in snake case if Slack has none. */
function codesOf(entry: EmojibaseEmoji): string[] {
  const codes = slackCodes[entry.hexcode];
  if (codes) return typeof codes === "string" ? [codes] : codes;
  return [entry.label.toLowerCase().replace(/[^a-z0-9+-]+/g, "_").replace(/^_|_$/g, "")];
}

const rows = emoji
  .filter((entry) => entry.group !== undefined && entry.group !== 2 && entry.version <= NEWEST_VERSION)
  .sort((a, b) => a.order! - b.order!)
  .map((entry) => {
    const codes = codesOf(entry);
    // Words the codes already hold would find nothing more.
    const words = new Set(codes.flatMap((code) => code.split("_")));
    const tags = (entry.tags ?? []).filter((tag) => !words.has(tag));
    return entry.skins ? [entry.emoji, entry.label, codes, tags, 1] : [entry.emoji, entry.label, codes, tags];
  });

const out = path.resolve(import.meta.dirname, "../src/lib/emoji-data.json");
writeFileSync(out, `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`);
console.log(`Wrote ${rows.length} emoji to ${path.relative(process.cwd(), out)}`);
