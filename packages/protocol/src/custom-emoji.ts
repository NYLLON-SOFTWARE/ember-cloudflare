// Custom emoji, as Slack has them: a picture anyone in the workspace uploads and names, which everyone
// then types by its :code:, in messages and as reactions. A message or a reaction keeps the code as text,
// as Slack's do, and the app draws the picture in its place while the workspace has an emoji of that
// name, so removing one leaves its code showing, and nothing stored changes.
//
// Dependency-free, and imported from "@ember/protocol/custom-emoji" by the editor's chunk, as importing
// the protocol's index there would split the app's script (`oneAppScript` in apps/web/vite.config.ts).

/** A custom emoji, as everyone's app lists it. */
export interface CustomEmoji {
  /** What it's typed by, between colons. */
  name: string;
  /** Where its picture is: `customEmojiImagePath` gives the address. */
  key: string;
  /** Who added it, by id. */
  creatorId: string;
  createdAt: string;
}

/** What `GET /api/emoji` answers: every custom emoji, by name. */
export interface CustomEmojiList {
  emoji: CustomEmoji[];
}

/** The Custom emoji page, which anyone signed in may open. */
export const CUSTOM_EMOJI_PATH = "/account/emoji";

/**
 * Where custom emoji go: `GET` lists them, `POST` adds one, from a form's `name` and `image`, and
 * `DELETE` of a name under it removes that one.
 */
export const CUSTOM_EMOJI_API_PATH = "/api/emoji";

/** The address of the custom emoji named `name`, which `DELETE` removes. */
export const customEmojiApiPath = (name: string) => `${CUSTOM_EMOJI_API_PATH}/${encodeURIComponent(name)}`;

/** Where the Worker serves the picture kept at `key`, to people signed in. */
export const customEmojiImagePath = (key: string) => `/emoji/${encodeURIComponent(key)}`;

/** The fewest characters a custom emoji's name has: as many as a code needs before the list of emoji opens. */
export const MIN_CUSTOM_EMOJI_NAME_LENGTH = 2;

/** The most characters a custom emoji's name has. */
export const MAX_CUSTOM_EMOJI_NAME_LENGTH = 32;

/** The box a custom emoji's picture fits within, as Slack scales one, which the uploader's browser does. */
export const CUSTOM_EMOJI_BOX = 128;

/**
 * The largest picture kept for a custom emoji, in bytes: more than any picture within the box needs, and
 * room for an animated GIF, which is kept as it came.
 */
export const MAX_CUSTOM_EMOJI_SIZE = 256 * 1024;

/** What the Worker's 413 and the app say of a larger one. */
export const CUSTOM_EMOJI_TOO_LARGE = "Emoji must be 256 KB or smaller.";

/** The types a custom emoji's picture can be, by its bytes: the ones every browser draws. */
export const CUSTOM_EMOJI_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** What the Worker's 415 and the app say of anything else. */
export const CUSTOM_EMOJI_WRONG_TYPE = "Emoji are PNG, JPEG, GIF or WebP images.";

/** How many custom emoji a workspace can have. */
export const MAX_CUSTOM_EMOJI = 2000;

/** What the Worker's 422 says of one more. */
export const TOO_MANY_CUSTOM_EMOJI = `A workspace can have up to ${MAX_CUSTOM_EMOJI.toLocaleString("en-US")} custom emoji.`;

/** What the Worker's 409 and the app say of a name another custom emoji has. */
export const CUSTOM_EMOJI_NAME_TAKEN = "That name is already taken by another custom emoji.";

/** What they say of a name that's one of the emoji's own codes, as Slack refuses those. */
export const CUSTOM_EMOJI_NAME_IS_STANDARD = "That name is already taken by one of the standard emoji.";

/** What a custom emoji's name is made of: the characters of a code, starting with a letter or digit. */
const NAME = /^[a-z0-9][a-z0-9_+-]*$/;

/** Slack's codes for the skin tones, which re-tone the emoji before them, so no custom emoji takes one. */
const SKIN_TONE_NAME = /^skin-tone-[2-6]$/;

/** Why `name` can't name a custom emoji, or null if it can, as far as its characters go. */
export function customEmojiNameProblem(name: string): string | null {
  if (name.length < MIN_CUSTOM_EMOJI_NAME_LENGTH) return `Names have at least ${MIN_CUSTOM_EMOJI_NAME_LENGTH} characters.`;
  if (name.length > MAX_CUSTOM_EMOJI_NAME_LENGTH) return `Names can be up to ${MAX_CUSTOM_EMOJI_NAME_LENGTH} characters.`;
  if (!NAME.test(name)) return "Names are lowercase letters, numbers, underscores, hyphens and plus signs, starting with a letter or number.";
  return SKIN_TONE_NAME.test(name) ? CUSTOM_EMOJI_NAME_IS_STANDARD : null;
}

/** The name a picture's file suggests for its emoji, as Slack fills it in: "Party Parrot.gif" gives "party_parrot". */
export function customEmojiNameOf(filename: string): string {
  return filename
    .replace(/\.[^.]*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_+-]+/g, "_")
    .replace(/^[_+-]+|_+$/g, "")
    .slice(0, MAX_CUSTOM_EMOJI_NAME_LENGTH);
}

/** The code `name` is typed by. */
export const emojiCode = (name: string) => `:${name}:`;

/** A custom emoji's code and nothing else, as a reaction of one is kept. */
const ONE_CODE = new RegExp(`^:([a-z0-9][a-z0-9_+-]{${MIN_CUSTOM_EMOJI_NAME_LENGTH - 1},${MAX_CUSTOM_EMOJI_NAME_LENGTH - 1}}):$`);

/** The name `text` is the code of, if it's one a custom emoji could have and nothing else, or null. */
export const customEmojiNameIn = (text: string): string | null => ONE_CODE.exec(text)?.[1] ?? null;

/** A piece of text: what's written, or a custom emoji whose code stood there. */
export type EmojiSegment = string | CustomEmoji;

/** The codes text may hold, each a name between colons. */
const CODES = /:([a-z0-9][a-z0-9_+-]*):/g;

/**
 * `text` cut where it holds the codes of custom emoji, by `emojiNamed`, each code giving its emoji. A
 * colon closes one code or opens the next, never both, so "12:30:15" and ":a:b:" read as they're written.
 */
export function emojiSegments(text: string, emojiNamed: (name: string) => CustomEmoji | undefined): EmojiSegment[] {
  const segments: EmojiSegment[] = [];
  let written = 0;
  CODES.lastIndex = 0;
  for (let match = CODES.exec(text); match; match = CODES.exec(text)) {
    const emoji = emojiNamed(match[1]!);
    if (!emoji) {
      // Its closing colon may open the next code.
      CODES.lastIndex = match.index + match[0].length - 1;
      continue;
    }
    if (match.index > written) segments.push(text.slice(written, match.index));
    segments.push(emoji);
    written = match.index + match[0].length;
  }
  if (written < text.length) segments.push(text.slice(written));
  return segments;
}
