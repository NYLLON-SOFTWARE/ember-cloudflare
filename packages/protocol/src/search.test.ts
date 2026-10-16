import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { isSearchable, sanitizeSearch, searchTerms } from "./index";

describe(feature("search.messages"), () => {
  it("turns every character but a word's into a space, one each, as ember-rust's tests find Ruby does", () => {
    expect(sanitizeSearch("héllo wörld_1 ２ 日本語 ‿ a-b \u{fe0f} ❤ é")).toBe("héllo wörld_1 ２ 日本語 ‿ a b \u{fe0f}   é");
    expect(sanitizeSearch('"quoted" OR NEAR(x*)')).toBe(" quoted  OR NEAR x  ");
    expect(sanitizeSearch("hello, world!")).toBe("hello  world ");
    expect(sanitizeSearch("café_1 日本")).toBe("café_1 日本");
    expect(sanitizeSearch('"quoted" AND-x')).toBe(" quoted  AND x");
    expect(sanitizeSearch("")).toBe("");
  });

  it("keeps the characters Onigmo calls word characters, and no others", () => {
    for (const c of ["a", "Z", "0", "_", "é", "ß", "日", "‿", "\u{0301}", "٣", "ǅ", "ʰ", "Ⅻ", "Ⓐ", "\u{200d}"]) expect(sanitizeSearch(c), c).toBe(c);
    for (const c of [" ", "-", "*", '"', "\u{a0}", "❤", "€", "½", "²", "\0", "😀"]) expect(sanitizeSearch(c), c).toBe(" ");
  });

  it("searches only for a query with a word left in it", () => {
    expect(isSearchable(sanitizeSearch("eels"))).toBe(true);
    for (const q of ["", "   ", "!!!", "😀 ❤", "\0"]) expect(isSearchable(sanitizeSearch(q)), q).toBe(false);
  });

  it("quotes each word, so that every word has to match and none is FTS5's syntax", () => {
    expect(searchTerms("NOT eel")).toBe('"NOT" "eel"');
    expect(searchTerms("  hello  world ")).toBe('"hello" "world"');
    expect(searchTerms('say "hi"')).toBe('"say" """hi"""');
    expect(searchTerms("eel\0shark")).toBe('"eel" "shark"');
    expect(searchTerms("")).toBe("");
  });
});
