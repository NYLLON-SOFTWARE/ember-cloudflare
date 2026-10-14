import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { autoLink } from "./autolink";
import { bodyFromPlainText, plainText, prepareBody } from "./body";
import { displayBody, type DisplayNode } from "./display";
import { MAX_TREE_DEPTH, ParseLimitError } from "./markup";
import { mentionSgid } from "./mentions";
import { parseHtml } from "./parse";
import { AUTO_LINK } from "./sanitize";
import { toHtml } from "./serialize";
import { descendants, removeAttr } from "./tree";
import { corpus, corpusUser, RailsError } from "./testing/corpus";
import { securityViolations } from "./testing/security";

const display = (html: string) => displayBody(parseHtml, html);
const MENTION = 'content-type="application/vnd.campfire.mention"';

/** The markup of what shows, a mention as the attachment it's stored as. */
function markupOf(nodes: DisplayNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "text") return toHtml(parseHtml(node.value.replace(/[&<> ]/g, (c) => `&#${c.charCodeAt(0)};`)));
      if (node.kind === "mention") return `<action-text-attachment ${MENTION} sgid="${mentionSgid(node.userId)}"></action-text-attachment>`;
      const attrs = Object.entries(node.attrs).map(([name, value]) => ` ${name}="${value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`);
      const inner = markupOf(node.children);
      return ["br", "hr"].includes(node.name) ? `<${node.name}${attrs.join("")}>` : `<${node.name}${attrs.join("")}>${inner}</${node.name}>`;
    })
    .join("");
}

/** The form a corpus body is stored in, or undefined for one that's refused, or that Rails raised on. */
function storedForm(body: string): string | undefined {
  try {
    return prepareBody(parseHtml, body, corpusUser)?.html;
  } catch (error) {
    if (error instanceof RailsError) return undefined;
    throw error;
  }
}

/**
 * A body as Rails linked it, but for the `target` the web app chooses for itself, and the `src` and
 * `alt` that only do something on the images a stored body can't hold.
 */
function linkedAsShown(html: string): string {
  const fragment = parseHtml(autoLink(parseHtml, html));
  for (const node of descendants(fragment)) {
    if (node.kind === "element") for (const name of ["target", "src", "alt"]) removeAttr(node, name);
  }
  return toHtml(fragment);
}

describe(feature("messages.rich-text"), () => {
  it("shows all a stored body holds, linked as Rails linked it, for every corpus body", { timeout: 30_000 }, () => {
    const differences: string[] = [];
    for (const { name, body } of corpus.cases) {
      const stored = storedForm(body);
      if (stored === undefined) continue;
      const shown = toHtml(parseHtml(markupOf(display(stored))));
      const expected = linkedAsShown(stored);
      if (shown !== expected) differences.push(`${name}\n  shows:    ${shown}\n  expected: ${expected}`);
    }
    expect(differences).toEqual([]);
  });

  it("takes out whatever a message can't show, from a body stored around prepareBody", () => {
    const shown = (html: string) => markupOf(display(html));
    expect(shown('<p class="fixed inset-0" style="color: red" onclick="alert(1)" id="x">Hi</p>')).toBe("<p>Hi</p>");
    expect(shown("<script>alert(1)</script><style>p {}</style>")).toBe("alert(1)p {}");
    expect(shown('<img src="x" onerror="alert(1)"><iframe src="https://example.com"></iframe>')).toBe("");
    expect(shown('<a href="javascript:alert(1)" target="_top">x</a>')).toBe("<a>x</a>");
    expect(shown('<svg><a href="https://example.com">x</a></svg><math><mi>y</mi></math>')).toBe("");
    expect(shown('<pre data-language="ruby" data-turbo="true">puts 1</pre>')).toBe('<pre data-language="ruby">puts 1</pre>');
    expect(shown("<p>a<!-- hidden -->b</p>")).toBe("<p>ab</p>");
  });

  it("shows no corpus body unsafely, prepared or not", { timeout: 30_000 }, () => {
    const shown = { tags: AUTO_LINK.tags, attributes: AUTO_LINK.attributes };
    const violations: string[] = [];
    for (const { name, body } of corpus.cases) {
      for (const html of [body, storedForm(body) ?? ""]) {
        let markup;
        try {
          markup = markupOf(display(html)).replaceAll(/<action-text-attachment [^>]*><\/action-text-attachment>/g, "");
        } catch (error) {
          if (error instanceof ParseLimitError) continue;
          throw error;
        }
        violations.push(...securityViolations(markup, shown).map((violation) => `${name}: ${violation}`));
      }
    }
    expect(violations).toEqual([]);
  });

  it("shows a mention as the person it names, and ☒ for an sgid that names no one", () => {
    expect(display(`<p>Hi <action-text-attachment ${MENTION} sgid="0123456789abcdef"></action-text-attachment></p>`)).toEqual([
      { kind: "element", name: "p", attrs: {}, children: [{ kind: "text", value: "Hi " }, { kind: "mention", userId: "0123456789abcdef" }] },
    ]);
    expect(display(`<action-text-attachment ${MENTION} sgid="gid://campfire/User/1"></action-text-attachment>`)).toEqual([{ kind: "text", value: "☒" }]);
    expect(display('<action-text-attachment content-type="text/html" sgid="0123456789abcdef">inside</action-text-attachment>')).toEqual([
      { kind: "text", value: "inside" },
    ]);
  });

  it("can't show markup past the parser's limits", () => {
    expect(() => display("<b>".repeat(MAX_TREE_DEPTH + 1))).toThrow(ParseLimitError);
  });

  it("stores plain text as one paragraph, with its lines broken by <br>, as Lexxy sends it", () => {
    expect(bodyFromPlainText("a < b & c\nd\r\ne\rf")).toBe("<p>a &lt; b &amp; c<br>d<br>e<br>f</p>");
    expect(bodyFromPlainText(" \n\n<b>\"quoted\"</b>")).toBe("<p>&nbsp;<br><br>&lt;b&gt;\"quoted\"&lt;/b&gt;</p>");
    for (const text of ["Hello", "one\ntwo\n\nthree", "<script>alert('x')</script>", "a  b", "Tom & Jerry > Itchy", "😄🤘", "https://example.com"]) {
      const body = bodyFromPlainText(text);
      expect(prepareBody(parseHtml, body, () => undefined)?.html, text).toBe(body);
      expect(plainText(parseHtml, body, () => undefined), text).toBe(text);
    }
  });
});

describe(feature("messages.autolink"), () => {
  it("links addresses, leaving the target to the web app", () => {
    expect(display("<p>See https://example.com/a?b=1&amp;c=2.</p>")).toEqual([
      {
        kind: "element",
        name: "p",
        attrs: {},
        children: [
          { kind: "text", value: "See " },
          { kind: "element", name: "a", attrs: { href: "https://example.com/a?b=1&c=2" }, children: [{ kind: "text", value: "https://example.com/a?b=1&c=2" }] },
          { kind: "text", value: "." },
        ],
      },
    ]);
  });

  it("links after taking out what can't show, so an address links even with a scheme no link can keep", () => {
    expect(markupOf(display("<p>feed://example.com/rss</p>"))).toBe('<p><a href="feed://example.com/rss">feed://example.com/rss</a></p>');
    expect(markupOf(display('<p><a href="feed://example.com/rss">News</a></p>'))).toBe("<p><a>News</a></p>");
  });
});
