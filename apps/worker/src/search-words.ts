import { CJK_CHARACTER, type RoomId, type RoomKind, type UserId } from "@ember/protocol";

// The words the search index keeps of each message (search-migrations/0005_search_readers.sql). An open
// room's are kept as its messages have them, since everyone in Ember can read those. Those of a room
// that not everyone can read are each kept under a key: the room's own, for a private room or a DM of
// three people or more, or each person's, for a DM of one or two people, whose DMs all share it. So
// FTS5's list of the messages with a word, kept under a key, lists only the messages of that room, or
// that person's DMs, and a search reads the lists of the words its rooms keep and no others. Either way,
// it keeps each run of Chinese, Japanese and Korean characters as pairs of them (`termsOf`), so that a
// search finds a word of them inside a longer run, as their words have nothing between them.

/**
 * Who can read a room's messages, which says how the index keeps their words: everyone, as in an open
 * room, the room's members, as in a private room or a DM of three people or more, or the one or two
 * people of a DM.
 */
export type Readers = "everyone" | "members" | UserId[];

/** Who can read a room, as the Workspace tells the index, or null for a room it no longer has. */
export interface RoomReaders {
  roomId: RoomId;
  readers: Readers | null;
}

/**
 * Who can read a room of `kind`, as the index keeps its words: everyone, for an open room, each of the
 * `people` of a DM of one or two people, whose DMs all share their keys, or its members.
 */
export function readersOf(kind: RoomKind, people: UserId[] | null): Readers {
  if (kind === "open") return "everyone";
  return kind === "direct" && people !== null && people.length <= 2 ? people : "members";
}

/**
 * The characters FTS5's tokenizer ends a word at though JavaScript counts them as letters, since the
 * Unicode it goes by, 6.1, called them marks: New Tai Lue's vowel signs and two Vedic signs. With them,
 * the two characters a key is put between.
 */
const ENDS_WORDS = /[ᦰ-ᧀᧈᧉᳲᳳ]/gu;

/** The marks FTS5's tokenizer keeps in a word as accents, though it starts none at one, as U+0301 after an e writes é. */
const ACCENTS = "\u0300-\u0304\u0306-\u030c\u030f\u0311\u031b\u0323-\u0328\u032d\u032e\u0330\u0331";

/**
 * A word as FTS5's tokenizer finds one, or part of one: a letter, number or character for private use,
 * then more of them and of its `ACCENTS`.
 */
const WORD = new RegExp(`[\\p{L}\\p{N}\\p{Co}][\\p{L}\\p{N}\\p{Co}${ACCENTS}]*`, "gu");

/**
 * The words of `text`, in order and spelled as it spells them, as FTS5's tokenizer finds them, or split
 * finer, at a character the Unicode it goes by didn't have, which it takes for a letter, as it takes the
 * newer emoji. A word kept under a key then never holds a character FTS5 would end it at, which would
 * leave the rest of it a word of its own, kept plainly, and a match's words are as its text has them.
 */
export const wordsOf = (text: string): string[] => text.replace(ENDS_WORDS, " ").match(WORD) ?? [];

/** One of a run's `CJK_CHARACTER`s, with any `ACCENTS` after it, which FTS5 keeps in its word. */
const CJK_LETTER = new RegExp(`${CJK_CHARACTER.source}[${ACCENTS}]*`, "gu");

/** A run of `CJK_LETTER`s. */
const CJK_RUN = new RegExp(`(?:${CJK_LETTER.source})+`, "gu");

/** A word of `CJK_LETTER`s alone. */
const CJK_WORD = new RegExp(`^${CJK_RUN.source}$`, "u");

/**
 * What the index keeps of `run`, a `CJK_RUN`: a term for each of its letters, the letter and the next, or
 * the last alone. So the terms of a word of them, but for its last letter's, are in a row in those of
 * any run that has it (`searchTermsOf`).
 */
function pairsOf(run: string): string[] {
  const letters = run.match(CJK_LETTER)!;
  return letters.map((letter, at) => letter + (letters[at + 1] ?? ""));
}

/** The parts of `word`, one of `wordsOf`'s, in order: each `CJK_RUN`, and the rest between them. */
function partsOf(word: string): Array<{ text: string; run: boolean }> {
  const parts: Array<{ text: string; run: boolean }> = [];
  let from = 0;
  for (const { 0: run, index } of word.matchAll(CJK_RUN)) {
    if (index > from) parts.push({ text: word.slice(from, index), run: false });
    parts.push({ text: run, run: true });
    from = index + run.length;
  }
  if (from < word.length) parts.push({ text: word.slice(from), run: false });
  return parts;
}

/** What the index keeps of `parts`, those of a word: each run's pairs, and the rest as they are. */
const termsOfParts = (parts: Array<{ text: string; run: boolean }>) => parts.flatMap(({ text, run }) => (run ? pairsOf(text) : [text]));

/**
 * The terms the index keeps of `text`: its words (`wordsOf`), each `CJK_RUN` in them as its pairs
 * (`pairsOf`), since FTS5 finds a term only whole, and a run can be a sentence.
 */
export const termsOf = (text: string): string[] => wordsOf(text).flatMap((word) => termsOfParts(partsOf(word)));

/**
 * The terms a message with `word` has in a row, as `termsOf` has them, and whether the last of them is
 * where one of its terms starts, rather than one of them. A run at the end of `word` can run on in a
 * message, where its last letter's term is the letter and the next: so for two letters or more, the terms
 * are the pairs but the last letter's, which the pair before it ends with, and for one letter, any term
 * it starts.
 */
function searchTermsOf(word: string): { terms: string[]; prefix: boolean } {
  const parts = wordsOf(word).flatMap(partsOf);
  const last = parts.at(-1);
  if (!last?.run) return { terms: termsOfParts(parts), prefix: false };
  const before = termsOfParts(parts.slice(0, -1));
  const pairs = pairsOf(last.text);
  return pairs.length === 1 ? { terms: [...before, ...pairs], prefix: true } : { terms: [...before, ...pairs.slice(0, -1)], prefix: false };
}

/** The `CJK_RUN`s of `words`, a search's, which every message it finds has, as they're written (`unkeyed`). */
export const runsOf = (words: string[]): string[] => words.flatMap((word) => word.match(CJK_RUN) ?? []);

/**
 * The digits a key is written in: decimal digits and consonants but y, which Porter's stemmer, which
 * stems the index's words, reads as consonants. So it stems a word under a key as it stems the word
 * alone, but for a word of one or two letters, which it stems only under a key.
 */
const KEY_DIGITS = "0123456789bcdfghjklmnpqrstvwxz";

/** Key `key`, a whole number from 1, in `KEY_DIGITS`. */
function keyText(key: number): string {
  let text = "";
  for (let rest = key; rest > 0; rest = Math.floor(rest / KEY_DIGITS.length)) text = KEY_DIGITS[rest % KEY_DIGITS.length] + text;
  return text;
}

/** What a key is put between, characters for private use that the index takes out of what it keeps plainly. */
const OPENING_KEY = "";
const CLOSING_KEY = "";

/** `word`, one of `wordsOf`'s, kept under key `key`: one word to FTS5's tokenizer, which no message's text has. */
const keyedWord = (key: number, word: string) => `${OPENING_KEY}${keyText(key)}${CLOSING_KEY}${word}`;

/**
 * What the index keeps of `text` plainly: all of it, but for the characters a key is put between, which
 * it makes spaces, and each `CJK_RUN`, which it keeps as its pairs (`termsOf`), between spaces.
 */
export const plainText = (text: string) => text.replace(/[]/gu, " ").replace(CJK_RUN, (run) => ` ${pairsOf(run).join(" ")} `);

/** What the index keeps of `terms`, a message's (`termsOf`), under each of `keys`: all of them under the first, then all of them again under the next, and so on. */
export function keyedText(terms: string[], keys: number[]): string {
  return keys.map((key) => terms.map((term) => keyedWord(key, term)).join(" ")).join("\n");
}

/** A word kept under a key: the key, as `keyText` writes it, and the word. */
const KEYED_WORD = new RegExp(`${OPENING_KEY}([^${CLOSING_KEY}\\s]*)${CLOSING_KEY}(\\S+)`, "gu");

/**
 * What the index keeps under keys of a message whose words it kept so before it paired `CJK_RUN`s,
 * `kept`, with each word's terms (`termsOf`) in its place, under the same key.
 */
export const pairedKeyedText = (kept: string) =>
  kept.replace(KEYED_WORD, (_, key: string, word: string) => termsOfParts(partsOf(word)).map((term) => `${OPENING_KEY}${key}${CLOSING_KEY}${term}`).join(" "));

/** `text` as an FTS5 string, which FTS5 reads as words to find, never as its syntax. */
const quoted = (text: string) => `"${text.replaceAll('"', '""')}"`;

/** `terms`, in a row, plainly or under key `key`, as an FTS5 phrase, whose last term is only where one starts when `prefix` says so. */
function phraseOf(terms: string[], key: number | null, prefix = false): string {
  const phrase = quoted(terms.map((term) => (key === null ? term : keyedWord(key, term))).join(" "));
  return prefix ? `${phrase} *` : phrase;
}

/**
 * Each way the index can keep `word`, as an FTS5 phrase: plainly, and under each of `keys`. A word with
 * `CJK_CHARACTER`s it keeps as its terms (`searchTermsOf`), and kept whole before it paired them, as it
 * still does a message its walk hasn't reached, or one a release before this one took.
 */
function formsOf(word: string, keys: number[]): string[] {
  const parts = wordsOf(word);
  const whole = [quoted(word), ...(parts.length === 0 ? [] : keys.map((key) => phraseOf(parts, key)))];
  if (!CJK_CHARACTER.test(word)) return whole;
  const { terms, prefix } = searchTermsOf(word);
  return [...new Set([phraseOf(terms, null, prefix), ...keys.map((key) => phraseOf(terms, key, prefix)), ...whole])];
}

/**
 * The FTS5 query for messages with every one of `words`, plainly or under one of `keys`, the keys of the
 * rooms a search looks in. A word FTS5 would find as several, as it does a_b, has to have them all in a
 * row, as FTS5 finds a quoted word. FTS5 takes two words in a row for both, but not two bracketed ORs.
 */
export function matchOf(words: string[], keys: number[]): string {
  return words
    .map((word) => {
      const forms = formsOf(word, keys);
      return forms.length === 1 ? forms[0]! : `(${forms.join(" OR ")})`;
    })
    .join(" AND ");
}

/**
 * The words of `marked`, a match FTS5 marked in what the index keeps of a message, as its text has them:
 * the match itself, or, where it's kept under a key or has `CJK_CHARACTER`s, each of its words, without
 * their keys. But for the words of `CJK_CHARACTER`s alone, a run's pairs, or a run kept whole before:
 * what those match is the search's own runs (`runsOf`), since such characters have no case or stem, and
 * a pair can be a longer match than its search's one letter.
 */
export function unkeyed(marked: string): string[] {
  if (!marked.includes(CLOSING_KEY) && !CJK_CHARACTER.test(marked)) return [marked];
  return marked
    .split(/\s+/u)
    .map((word) => word.slice(word.lastIndexOf(CLOSING_KEY) + 1))
    .filter((word) => word !== "" && !CJK_WORD.test(word));
}
