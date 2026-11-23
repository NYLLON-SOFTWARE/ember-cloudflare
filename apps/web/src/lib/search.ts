import { CJK_CHARACTER, normalizedSearch, SEARCH_FLAGS, type Search, type SearchFlag, type SearchResults, type SearchSort } from "@ember/protocol";

// Searches as the search box writes them: words, and filters, which Slack's modifiers name as they're
// typed, such as `has:link`, and which the box shows as tokens beside the words.

/** What the box and the results page call each filter that's on or off. */
export const FLAG_LABELS: Record<SearchFlag, string> = {
  withMe: "Includes me",
  hasLink: "Has a link",
  hasFile: "Has a file",
  inThread: "Threads only",
};

/** The modifiers the box takes as they're typed: `in:` and `from:` name a room and a person, and the rest a flag. */
export type ModifierKey = "in" | "from" | "has" | "is" | "with";

/** A modifier being typed at the end of the words: its key, what's typed after its colon, and where it starts. */
export interface TypedModifier {
  key: ModifierKey;
  value: string;
  start: number;
}

/** The modifier being typed at the end of `text`, after a space or at its start, if one is. */
export function modifierTyped(text: string): TypedModifier | null {
  const match = /(?:^|\s)(in|from|has|is|with):(\S*)$/iu.exec(text);
  if (!match) return null;
  const [, key, value] = match as unknown as [string, string, string];
  return { key: key.toLowerCase() as ModifierKey, value, start: text.length - key.length - 1 - value.length };
}

/** The flag `key:value` names, such as `has:link`, if it names one. */
export function flagNamed(key: string, value: string): SearchFlag | null {
  const named = SEARCH_FLAGS.find((flag) => flag.key === key.toLowerCase() && flag.value === value.toLowerCase());
  return named?.flag ?? null;
}

/** What a typed search has once the modifiers it names in full are filters: `has:`, `is:` and `with:` flags, and `from:me`. */
export function withTypedFilters(search: Search, meId: string): Search {
  const filters: Partial<Search> = {};
  const words = search.q.replace(/(^|\s)(has|is|with|from):(\S+)(?=\s|$)/giu, (whole, space: string, key: string, value: string) => {
    if (key.toLowerCase() === "from") {
      if (value.toLowerCase() !== "me" && value.toLowerCase() !== "@me") return whole;
      filters.from = meId;
      return space;
    }
    const flag = flagNamed(key, value);
    if (!flag) return whole;
    filters[flag] = true;
    return space;
  });
  return normalizedSearch({ ...search, ...filters, q: words });
}

/** `text` without the `from:me` typed in full in it, whose place a person picked for From takes, or which From me turns off. */
export const withoutFromMe = (text: string) => text.replace(/(^|\s)from:@?me(?=\s|$)/giu, "").trim();

/** `text` without the modifiers typed in full in it that turn `flag` on, such as `has:link`, which its chip turns off. */
export const withoutFlag = (text: string, flag: SearchFlag) =>
  text.replace(/(^|\s)(has|is|with):(\S+)(?=\s|$)/giu, (whole, _space: string, key: string, value: string) => (flagNamed(key, value) === flag ? "" : whole)).trim();

/** A letter, mark or number a word would run on into: any but a `CJK_CHARACTER`, where the index ends a word of other letters. */
const RUNS_ON = `(?!${CJK_CHARACTER.source})[\\p{L}\\p{M}\\p{N}]`;

/** A word that starts with a `CJK_CHARACTER`, or one that ends with one, with any marks after it. */
const STARTS_CJK = new RegExp(`^${CJK_CHARACTER.source}`, "u");
const ENDS_CJK = new RegExp(`${CJK_CHARACTER.source}\\p{M}*$`, "u");

/**
 * What marks `word` in a match's text: the word whole, but at an end that's a `CJK_CHARACTER`, which can
 * run on into more of them, as the index finds a word of them inside a run of them.
 */
function markOf(word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `${STARTS_CJK.test(word) ? "" : `(?<!${RUNS_ON})`}${escaped}${ENDS_CJK.test(word) ? "" : `(?!${RUNS_ON})`}`;
}

/** What marks the words a match matched in its text: each one as `markOf` marks it, however it's cased, longest first. */
export function marksFor(words: readonly string[]): RegExp | null {
  const marked = words.filter((word) => word !== "");
  if (marked.length === 0) return null;
  return new RegExp(marked.toSorted((a, b) => b.length - a.length).map(markOf).join("|"), "giu");
}

/** Whether `a` and `b` search for the same: the same words, once spaces are made one, and the same filters. */
export const sameSearch = (a: Search, b: Search) => JSON.stringify(normalizedSearch(a)) === JSON.stringify(normalizedSearch(b));

// What the box's search answered, for the results page it goes to, so the page shows that rather than
// asking again, and the visit to the page that took it.
let answered: { search: Search; sort: SearchSort; results: SearchResults; visit?: number } | null = null;

/** Keeps what `search`, sorted by `sort`, answered, for the results page to take. */
export function keepAnswer(search: Search, sort: SearchSort, results: SearchResults): void {
  answered = { search, sort, results };
}

/**
 * What the box's last search answered, if it was for `search` sorted by `sort`, for the visit to the
 * page that takes it first, which can take it again, as an effect run twice does. Any other forgets it.
 */
export function takeAnswer(search: Search, sort: SearchSort, visit: number): SearchResults | null {
  const answer = answered;
  if (answer && answer.sort === sort && sameSearch(answer.search, search) && (answer.visit ?? visit) === visit) {
    answer.visit = visit;
    return answer.results;
  }
  answered = null;
  return null;
}
