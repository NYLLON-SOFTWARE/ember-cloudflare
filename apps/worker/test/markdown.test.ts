import { MAX_MESSAGE_HTML_LENGTH } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { MAX_MARKDOWN_DEPTH, MAX_MARKDOWN_LENGTH, MAX_REFERENCED_ADDRESS_LENGTH, MAX_TABLE_CELLS, markdownHtml } from "../src/bots/markdown";

/** A table of `columns` columns headed "h", over `rows` rows of a letter each, which marked gives a cell for every column. */
const table = (columns: number, rows: number) => [`|${"h|".repeat(columns)}`, `|${"-|".repeat(columns)}`, ...Array<string>(rows).fill("a")].join("\n");

/** How many `tag` elements `html` opens. */
const opened = (html: string, tag: string) => html.split(`<${tag}>`).length - 1;

/** `inner` inside `depth` of `open` and `close`. */
const nested = (open: string, inner: string, close: string, depth = MAX_MARKDOWN_DEPTH) => `${open.repeat(depth)}${inner}${close.repeat(depth)}`;

/** `count` lines of a letter, as a paragraph shows them. */
const letters = (count: number) => `<p>${Array<string>(count).fill("a").join("<br>")}</p>`;

describe("The Markdown bots, connected apps and @ember write", () => {
  it("gives a text's tables twice the cells a message's markup holds, every row as many as its header, and reads the rows past those as text after the table", () => {
    expect(MAX_TABLE_CELLS).toBe(20_000);
    const whole = markdownHtml(table(200, 99));
    expect([opened(whole, "th"), opened(whole, "td"), opened(whole, "p")]).toEqual([200, 19_800, 0]);
    const cut = markdownHtml(table(200, 101));
    expect([opened(cut, "th"), opened(cut, "td")]).toEqual([200, 19_800]);
    expect(cut.endsWith(`</table></div>${letters(2)}`)).toBe(true);

    // Four and a half million cells, had every row been given its 1,500.
    const widest = table(1_500, 2_990);
    expect(widest.length).toBeLessThanOrEqual(MAX_MARKDOWN_LENGTH);
    const html = markdownHtml(widest);
    expect([opened(html, "th"), opened(html, "td")]).toEqual([1_500, 18_000]);
    expect(html.endsWith(`</table></div>${letters(2_978)}`)).toBe(true);
    // Too long for a message still, as it was with every cell.
    expect(html.length).toBeGreaterThan(MAX_MESSAGE_HTML_LENGTH);
  });

  it("counts the cells of all of a text's tables, reading one whose header has more than are left as its text, and counts afresh for each text", () => {
    // The first table takes 12,000 cells, leaving the second its header and 39 of its 59 rows.
    const text = [table(200, 59), table(200, 59), table(2, 1)].join("\n\n");
    const html = markdownHtml(text);
    expect(opened(html, "tr")).toBe(60 + 40);
    expect(html.endsWith(`</table></div>${letters(20)}<p>|h|h|<br>|-|-|<br>a</p>`)).toBe(true);
    expect(markdownHtml(text)).toBe(html);
  });

  it("links a reference wherever it's used until its links have written twice a message's markup of its address, and reads the uses after as their text", () => {
    const address = `https://example.com/${"a".repeat(9_980)}`;
    expect(20 * address.length).toBe(MAX_REFERENCED_ADDRESS_LENGTH);
    const html = markdownHtml(`${"[x][r] ".repeat(25)}\n\n[r]: ${address}`);
    expect(html).toBe(`<p>${Array<string>(20).fill(`<a href="${address}">x</a>`).join(" ")} ${"[x][r] ".repeat(5)}</p>`);
    // Too long for a message still, as it was with every link.
    expect(html.length).toBeGreaterThan(MAX_MESSAGE_HTML_LENGTH);
  });

  it(`reads quotes, lists, emphasis and strike-through ${MAX_MARKDOWN_DEPTH} deep, and what would open another inside them as its text, however deep it goes`, () => {
    expect(markdownHtml(`${">".repeat(MAX_MARKDOWN_DEPTH)} deep`)).toBe(nested("<blockquote>", "<p>deep</p>", "</blockquote>"));
    // Thousands deep, marked would run out of stack.
    expect(markdownHtml(`${">".repeat(5_000)} deep`)).toBe(nested("<blockquote>", `<p>${"&gt;".repeat(4_900)} deep</p>`, "</blockquote>"));
    expect(markdownHtml(`${"- ".repeat(MAX_MARKDOWN_DEPTH + 1)}deep`)).toBe(nested("<ul><li>", "- deep", "</li></ul>"));
    expect(markdownHtml(`${"1. ".repeat(2_000)}deep`)).toBe(nested("<ol><li>", `${"1. ".repeat(1_900)}deep`, "</li></ol>"));
    expect(markdownHtml(`${"> - ".repeat(1_000)}deep`)).toBe(nested("<blockquote><ul><li>", `${"&gt; - ".repeat(950)}deep`, "</li></ul></blockquote>", MAX_MARKDOWN_DEPTH / 2));
    expect(markdownHtml(`${"*a ".repeat(2_000)}b${" c*".repeat(2_000)}`)).toBe(`<p>${nested("<em>a ", `${"*a ".repeat(1_900)}b${" c*".repeat(1_900)}`, " c</em>")}</p>`);
    expect(markdownHtml(`${"~~a ".repeat(2_000)}b${" c~~".repeat(2_000)}`)).toBe(`<p>${nested("<del>a ", `${"~~a ".repeat(1_900)}b${" c~~".repeat(1_900)}`, " c</del>")}</p>`);
  });
});
