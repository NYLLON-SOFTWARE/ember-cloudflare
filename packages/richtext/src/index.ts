// Ember's rich text: message bodies as Campfire's Action Text pipeline reads them, ported from
// ember-rust's crates/richtext and checked against the Rails outputs it was tested with. This
// entry point parses with parse5, for the Worker; browsers import "@ember/richtext/dom".

import { withParser } from "./body";
import { parseHtml } from "./parse";

export * from "./shared";
export { parseHtml };

export const { prepareBody, plainText, mentionedUsers } = withParser(parseHtml);
