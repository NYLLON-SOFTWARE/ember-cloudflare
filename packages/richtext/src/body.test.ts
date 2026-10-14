import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { prepareBody } from "./body";
import { userGid, userIdFromGid } from "./mentions";
import { parseHtml } from "./parse";

const users = new Map([
  [1, { id: 1, name: "David" }],
  [2, { id: 2, name: "Jason" }],
]);
const resolve = (sgid: string) => users.get(userIdFromGid(sgid) ?? 0);
const prepare = (html: string) => prepareBody(parseHtml, html, resolve);
const mention = (id: number, attributes = "") =>
  `<action-text-attachment sgid="${userGid(id)}" content-type="application/vnd.campfire.mention"${attributes}></action-text-attachment>`;
const storedMention = (id: number) =>
  `<action-text-attachment content-type="application/vnd.campfire.mention" sgid="${userGid(id)}"></action-text-attachment>`;

describe(feature("messages.rich-text"), () => {
  it("stores Lexxy's formatting, without classes, styles, targets or scripts", () => {
    const body = '<p class="x" style="color: red">Hi <strong>all</strong><script>alert(1)</script></p><pre data-language="ruby">x = 1</pre>';
    expect(prepare(body)).toEqual({
      html: '<p>Hi <strong>all</strong></p><pre data-language="ruby">x = 1</pre>',
      plainText: "Hi all\n\nx = 1",
      mentions: [],
      blank: false,
    });
    expect(prepare('<a href="https://example.com" target="_blank">x</a>')?.html).toBe('<a href="https://example.com">x</a>');
    expect(prepare('<p><a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)></p>')?.html).toBe("<p><a>x</a></p>");
  });

  it("stores rendered attachments, with an image's caption but not its image", () => {
    expect(prepare('<action-text-attachment content-type="text/html" content="&lt;hr&gt;"></action-text-attachment>')?.html).toBe("<hr>");
    const image = '<action-text-attachment content-type="image/png" url="https://example.com/a.png" caption="Cat"></action-text-attachment>';
    expect(prepare(image)).toMatchObject({ html: "Cat", plainText: "[Cat]" });
  });

  it("is blank when there's no text but whitespace and no attachment", () => {
    for (const body of ["", "  \n ", "<p> </p>", "<p><br></p>"]) expect(prepare(body)?.blank, body).toBe(true);
    expect(prepare(`<p>${mention(3)}</p>`)?.blank).toBe(false);
  });

  it("refuses a body it can't show", () => {
    expect(prepare("<b>".repeat(401))).toBeNull();
    expect(prepare(`<p ${Array.from({ length: 401 }, (_, i) => `a${i}`).join(" ")}>x</p>`)).toBeNull();
    // Rails raises rendering these: an image that isn't at a URL, and an attachment of nothing
    expect(prepare('<action-text-attachment content-type="image/png" url="x.png"></action-text-attachment>')).toBeNull();
    expect(prepare("<action-text-attachment></action-text-attachment>")).toBeNull();
  });
});

describe(feature("mentions.render"), () => {
  it("stores a mention as an attachment that renders the person as they are now", () => {
    const body = `<p>Hi ${mention(1, ' content="&lt;img src=&quot;/x.png&quot;&gt; David"')} and ${mention(2)}, and ${mention(1)}!</p>`;
    expect(prepare(body)).toEqual({
      html: `<p>Hi ${storedMention(1)} and ${storedMention(2)}, and ${storedMention(1)}!</p>`,
      plainText: "Hi @David and @Jason, and @David!",
      mentions: [1, 2],
      blank: false,
    });
  });

  it("stores ☒ for a mention of someone who doesn't exist", () => {
    expect(prepare(`<p>Hi ${mention(3)}</p>`)).toEqual({ html: "<p>Hi ☒</p>", plainText: "Hi ", mentions: [], blank: false });
  });
});

describe(feature("messages.plain-text"), () => {
  it("reads the body's plain text", () => {
    expect(prepare("<blockquote>q</blockquote><ul><li>a</li></ul>")?.plainText).toBe("“q”\n\n• a");
  });
});
