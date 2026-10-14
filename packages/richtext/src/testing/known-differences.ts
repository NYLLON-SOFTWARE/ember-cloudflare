// The corpus cases where Ember deliberately reads a body differently from Rails, each with its
// reason. corpus.test.ts fails when a listed case starts matching, so the list stays true.

export type Field = "plain_text" | "mentioned" | "filtered" | "presentation";

const LINK_PREVIEWS =
  "Link previews (opengraph-embed attachments) show nothing until Ember has them: Rails shows the preview, takes away the text of a " +
  "message that is only the previewed link, and raises on some malformed preview URLs.";

const TRIX =
  "Action Text turns the `<figure data-trix-attachment>` elements of Trix, Campfire's earlier editor, into attachments as it loads a " +
  "body. Ember never stored a Trix body and its clients send Lexxy's markup, so a figure a client sends stays a figure: its text " +
  "shows, and its JSON is ignored.";

export const KNOWN_DIFFERENCES: Record<string, { fields: readonly Field[]; reason: string }> = {
  "lexxy embed solo": { fields: ["filtered", "presentation"], reason: LINK_PREVIEWS },
  "lexxy embed with text": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "lexxy tweet avatar": { fields: ["filtered", "presentation"], reason: LINK_PREVIEWS },
  "lexxy hand written embed": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "lexxy embed long title": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "lexxy embed without title": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "lexxy embed title without link": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "lexxy embed html in details": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "trix unfurl basecamp solo": { fields: ["filtered", "presentation"], reason: LINK_PREVIEWS },
  "trix unfurl with text": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "trix tweet avatar": { fields: ["filtered", "presentation"], reason: LINK_PREVIEWS },
  "trix tweet content image": { fields: ["filtered", "presentation"], reason: LINK_PREVIEWS },
  "trix x.com unfurl": { fields: ["filtered", "presentation"], reason: LINK_PREVIEWS },
  "trix x.com unfurl with query": { fields: ["filtered", "presentation"], reason: LINK_PREVIEWS },
  "trix nested divs unfurl": { fields: ["filtered", "presentation"], reason: LINK_PREVIEWS },
  "trix two unfurls": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "trix figure attachment": { fields: ["plain_text", "mentioned", "filtered", "presentation"], reason: TRIX },
  "trix figure attachment typed values": { fields: ["plain_text", "filtered", "presentation"], reason: TRIX },
  "trix figure attachment empty json": { fields: ["plain_text", "filtered", "presentation"], reason: TRIX },
  "trix figure attachment broken json": { fields: ["plain_text", "filtered", "presentation"], reason: TRIX },
  "trix figure attachment array json": { fields: ["plain_text", "mentioned", "filtered", "presentation"], reason: TRIX },
  "trix figure attachment json comment": { fields: ["plain_text", "filtered", "presentation"], reason: TRIX },
  "og self host link": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "og escaped host": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "og bare addresses": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "og relative and scheme relative": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "og javascript": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "og malformed urls": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "og mailto raises": { fields: ["plain_text", "filtered", "presentation"], reason: LINK_PREVIEWS },
  "og dots host raises": { fields: ["plain_text", "filtered", "presentation"], reason: LINK_PREVIEWS },
  "og punycode": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "og other host": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "og fuzzy content type": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "og with sgid": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "og filename blank uses content": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "og href with quotes and spaces": { fields: ["presentation"], reason: LINK_PREVIEWS },
  "fuzz 287": { fields: ["presentation"], reason: LINK_PREVIEWS },
};
