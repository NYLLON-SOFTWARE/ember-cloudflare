import { MAX_MESSAGE_HTML_LENGTH } from "@ember/protocol";
import { decodeHTMLStrict } from "entities/decode";
import { Marked, Tokenizer, type Lexer, type MarkedExtension, type Rules, type Token, type Tokens } from "marked";
import { anchor, escapeText, linkHref } from "./mrkdwn";

// The Markdown of a Block Kit markdown block (https://docs.slack.dev/reference/block-kit/blocks/markdown-block),
// read with marked into the rich text a message keeps, as Slack draws it: GitHub's flavor, its line breaks kept,
// every heading at one size, images as links to them, a task's box as a character, and HTML as the text it's
// written in. Only web and email addresses link, as in mrkdwn, and the room sanitizes what's left as it does a body.
// The message's plain text reads it as Action Text does (`nodeToPlainText`), running a code block and a table's cells
// into what follows them, so those sit in a `div`, which ends a line there, and each cell ends in a space, which it
// doesn't show. A heading sits in one too, ending its line where it would end a paragraph.
//
// marked builds all of a text before its markup can be measured, and some Markdown builds far more than it's written
// in, so every reading of Markdown here keeps to `MARKDOWN_LIMITS`, answers' cards and citations as well as this.

/** Slack's limit on the Markdown in all of a payload's markdown blocks. */
export const MAX_MARKDOWN_LENGTH = 12_000;

/**
 * The most cells marked builds of a text's tables in all, twice what a message's markup holds, as an empty cell takes
 * ten characters of it (`<td> </td>`). marked gives every row as many cells as its table's header, however few it
 * writes, so a header of 1,500 cells over 3,000 rows of a letter each, 12,000 characters, would be four and a half
 * million of them, most of a gigabyte to read, where a Worker or a room has 128 MB. A table's rows past this read as
 * the text they're written in, after the rows that fit, and a table whose header has more cells than are left reads as
 * its text. Either way, unless that header has more than ten thousand cells, the cells built by then take more than a
 * message's markup holds, so a text too long for a message is still too long.
 */
export const MAX_TABLE_CELLS = (2 * MAX_MESSAGE_HTML_LENGTH) / "<td> </td>".length;

/**
 * The most characters of addresses a text's references may link to in all, twice what a message's markup holds. A
 * reference's address is written once and marked repeats it wherever the reference is used, so an answer, which has no
 * length of Markdown of its own, could use a long one thousands of times, hundreds of megabytes of markup. Past this a
 * reference reads as the text it's written in, which leaves a text whose markup was too long for a message too long:
 * the links before it already hold more than a message's markup, unless its address alone is longer than that.
 */
export const MAX_REFERENCED_ADDRESS_LENGTH = 2 * MAX_MESSAGE_HTML_LENGTH;

/**
 * How deep quotes, lists, emphasis and strike-throughs may be inside one another, far deeper than any message needs.
 * marked reads each inside the one around it, so a few thousand of them, as in a line of 5,000 `>`, run out of stack,
 * which throws. Past this depth, what would open another reads as the text it's written in.
 */
export const MAX_MARKDOWN_DEPTH = 100;

/** A code block's language, as highlight.js names one. */
const LANGUAGE = /^[\w#+.-]+/;

/** A block in a `div`, which the plain text ends a line after. */
const ownLine = (html: string) => `<div>${html}</div>`;

/** An image's description as text: what its words say, its code, tags and autolinks as they're written, and a space for a line break. */
function descriptionText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === "link" && token.autolink) return token.text;
      if ("tokens" in token && token.tokens) return descriptionText(token.tokens);
      if (token.type === "text") return decodeHTMLStrict(token.text);
      if (token.type === "br") return " ";
      return "text" in token ? token.text : "";
    })
    .join("");
}

/** What one reading of a text has left of `MARKDOWN_LIMITS`, and how deep it is in quotes, lists and emphasis. */
interface Reading {
  cells: number;
  addresses: number;
  depth: number;
}

const readings = new WeakMap<Lexer, Reading>();

/** The reading of the text `lexer` reads, as marked starts a lexer for each text it reads. */
function readingBy(lexer: Lexer): Reading {
  let reading = readings.get(lexer);
  if (!reading) readings.set(lexer, (reading = { cells: MAX_TABLE_CELLS, addresses: MAX_REFERENCED_ADDRESS_LENGTH, depth: 0 }));
  return reading;
}

/** How many columns the table its rule matched as `match` has, as marked counts them: its delimiter row's. */
const columnsOf = ([, , delimiter = ""]: RegExpExecArray, { other }: Rules) => delimiter.replace(other.tableAlignChars, "").split("|").length;

/** How many rows it has under its header, as marked counts them, each of which it gives a cell for every column. */
const rowsOf = ([, , , rows = ""]: RegExpExecArray, { other }: Rules) => (rows.trim() ? rows.replace(other.tableRowBlankLine, "").split("\n").length : 0);

/** The first `count` lines of `text`. */
const linesOf = (text: string, count: number) => text.split("\n", count).join("\n");

/** What `read` makes of the quote, list or emphasis `lexer` is at, a level deeper, or nothing past `MAX_MARKDOWN_DEPTH`. */
function deeper<T>(lexer: Lexer, read: () => T): T | undefined {
  const reading = readingBy(lexer);
  if (reading.depth >= MAX_MARKDOWN_DEPTH) return undefined;
  reading.depth += 1;
  try {
    return read();
  } finally {
    reading.depth -= 1;
  }
}

/**
 * The limits every reading of Markdown here keeps to. A table's rows past what its text has left of `MAX_TABLE_CELLS`,
 * a reference to an address longer than what's left of `MAX_REFERENCED_ADDRESS_LENGTH`, and a quote, a list, emphasis
 * or a strike-through deeper than `MAX_MARKDOWN_DEPTH` read as the text they're written in, as marked reads what none
 * of its tokenizers take.
 */
export const MARKDOWN_LIMITS: MarkedExtension = {
  tokenizer: {
    table(src) {
      const match = this.rules.block.table.exec(src);
      if (!match) return undefined;
      const reading = readingBy(this.lexer);
      const columns = columnsOf(match, this.rules);
      const rows = rowsOf(match, this.rules);
      const kept = Math.min(rows, Math.floor(reading.cells / columns) - 1);
      if (kept < 0) return undefined;
      // The rows past those kept are left to be read after the table, its header and delimiter being its first two lines.
      const table = Tokenizer.prototype.table.call(this, kept < rows ? linesOf(src, kept + 2) : src);
      if (table) reading.cells -= columns * (kept + 1);
      return table;
    },
    reflink(src, links) {
      // A link's text is read as it's matched, which can change the lexer's state, so a link left as text undoes that.
      const state = { ...this.lexer.state };
      const link = Tokenizer.prototype.reflink.call(this, src, links);
      if (link?.type !== "link" && link?.type !== "image") return link;
      const reading = readingBy(this.lexer);
      if (link.href.length > reading.addresses) {
        Object.assign(this.lexer.state, state);
        return undefined;
      }
      reading.addresses -= link.href.length;
      return link;
    },
    blockquote(src) {
      return deeper(this.lexer, () => Tokenizer.prototype.blockquote.call(this, src));
    },
    list(src) {
      return deeper(this.lexer, () => Tokenizer.prototype.list.call(this, src));
    },
    emStrong(src, maskedSrc, prevChar) {
      return deeper(this.lexer, () => Tokenizer.prototype.emStrong.call(this, src, maskedSrc, prevChar));
    },
    del(src, maskedSrc, prevChar) {
      return deeper(this.lexer, () => Tokenizer.prototype.del.call(this, src, maskedSrc, prevChar));
    },
  },
};

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    heading({ tokens }) {
      return ownLine(`<h4>${this.parser.parseInline(tokens)}</h4>`);
    },
    html({ text, block }) {
      const html = escapeText(text.trim()).replace(/\n/g, "<br>");
      return block ? `<p>${html}</p>` : html;
    },
    text(token) {
      // marked writes the text in a `pre`, `code`, `kbd` or `script` tag unescaped, as it writes the tag, but the tag
      // shows as its text here, so that text is escaped as any other is: `<code>a<b</code>` keeps its `<b`.
      if (token.type === "text") token.escaped = false;
      return false;
    },
    code({ text, lang }) {
      const language = lang?.match(LANGUAGE)?.[0];
      return ownLine(`<pre${language ? ` data-language="${language}"` : ""}>${escapeText(text)}</pre>`);
    },
    table({ header, rows }) {
      const row = (cells: Tokens.TableCell[]) => `<tr>${cells.map((cell) => this.tablecell(cell)).join("")}</tr>`;
      return ownLine(`<table><thead>${row(header)}</thead>${rows.length > 0 ? `<tbody>${rows.map(row).join("")}</tbody>` : ""}</table>`);
    },
    tablecell({ tokens, header }) {
      const name = header ? "th" : "td";
      return `<${name}>${this.parser.parseInline(tokens)} </${name}>`;
    },
    link({ href, text, tokens, autolink }) {
      // As CommonMark reads them, a character reference in a link's address stands for its character, as `&amp;` does
      // for `&`, but an autolink's address is its text, every `&` in it an ampersand.
      const label = autolink ? escapeText(text) : this.parser.parseInline(tokens);
      const url = linkHref(autolink ? href : decodeHTMLStrict(href));
      return url ? anchor(url, label) : label;
    },
    image({ href, tokens }) {
      const label = descriptionText(tokens);
      const address = decodeHTMLStrict(href);
      const url = linkHref(address);
      return url ? anchor(url, escapeText(label || address)) : escapeText(label);
    },
    checkbox({ checked }) {
      return checked ? "☑ " : "☐ ";
    },
  },
}, MARKDOWN_LIMITS);

/** A markdown block's text as markup, without the line breaks marked writes between its elements. */
export function markdownHtml(text: string): string {
  const html = markdown.parse(text, { async: false });
  return html.replace(/>\n+(?=<)/g, ">").trim();
}
