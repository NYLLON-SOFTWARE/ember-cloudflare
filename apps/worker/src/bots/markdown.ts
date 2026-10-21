import { Marked } from "marked";
import { anchor, escapeText, linkHref } from "./mrkdwn";

// The Markdown of a Block Kit markdown block (https://docs.slack.dev/reference/block-kit/blocks/markdown-block),
// read with marked into the rich text a message keeps, as Slack draws it: GitHub's flavor, its line breaks kept,
// every heading at one size, images as links to them, a task's box as a character, and HTML as the text it's
// written in. Only web and email addresses link, as in mrkdwn, and the room sanitizes what's left as it does a body.

/** Slack's limit on the Markdown in all of a payload's markdown blocks. */
export const MAX_MARKDOWN_LENGTH = 12_000;

/** A code block's language, as highlight.js names one. */
const LANGUAGE = /^[\w#+.-]+/;

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    heading({ tokens }) {
      return `<h4>${this.parser.parseInline(tokens)}</h4>`;
    },
    html({ text, block }) {
      const html = escapeText(text.trim()).replace(/\n/g, "<br>");
      return block ? `<p>${html}</p>` : html;
    },
    code({ text, lang }) {
      const language = lang?.match(LANGUAGE)?.[0];
      return `<pre${language ? ` data-language="${language}"` : ""}>${escapeText(text)}</pre>`;
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const url = linkHref(href);
      return url ? anchor(url, label) : label;
    },
    image({ href, text }) {
      const url = linkHref(href);
      return url ? anchor(url, escapeText(text || href)) : escapeText(text);
    },
    checkbox({ checked }) {
      return checked ? "☑ " : "☐ ";
    },
  },
});

/** A markdown block's text as markup, without the line breaks marked writes between its elements. */
export function markdownHtml(text: string): string {
  const html = markdown.parse(text, { async: false });
  return html.replace(/>\n+(?=<)/g, ">").trim();
}
