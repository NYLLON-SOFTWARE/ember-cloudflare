import { parseCards, type Card, type CardPart } from "@ember/protocol";
import { cardAddress, prepareBody } from "@ember/richtext";

// A bot's cards as the room keeps them (packages/protocol/src/cards.ts): what `parseCards` keeps of them,
// their links and images on named hosts, as a link preview's are, and each text in the stored form, as
// `prepareBody` keeps a body, with the plain text they add to their message's. Which host is this Ember's
// is the page's to know, so each reader's app leaves out an address on it as it draws the card.

/** A message's cards, and their plain text: a line for each part that has text, a field's title before its value. */
export interface KeptCards {
  cards: Card[];
  plainText: string;
}

/** The cards `value` lists as the room keeps them, leaving out a text that holds nothing, and a card left with nothing to show. */
export function keptCards(value: unknown): KeptCards {
  const lines: string[] = [];
  const cards = parseCards(value, (url) => cardAddress(url, "")).flatMap((card): Card[] => {
    const pretext = card.pretext === undefined ? undefined : keptText(card.pretext);
    const parts = card.parts.flatMap((part) => keptPart(part) ?? []);
    if (parts.length === 0 && pretext === undefined) return [];
    if (pretext) lines.push(pretext.plainText);
    lines.push(...parts.flatMap(({ plainText }) => plainText));
    const { pretext: _, ...rest } = card;
    return [{ ...rest, ...(pretext && { pretext: pretext.html }), parts: parts.map(({ part }) => part) }];
  });
  return { cards, plainText: lines.join("\n") };
}

/** `part` with its text kept, and the lines of plain text it adds, or null when its text holds nothing. */
function keptPart(part: CardPart): { part: CardPart; plainText: string[] } | null {
  switch (part.kind) {
    case "author":
      return { part, plainText: [part.name] };
    case "title":
      return { part, plainText: [part.text] };
    case "text": {
      const text = keptText(part.html);
      return text ? { part: { kind: "text", html: text.html }, plainText: [text.plainText] } : null;
    }
    case "fields": {
      const fields = part.fields.flatMap((field) => {
        const value = field.html === "" ? undefined : keptText(field.html);
        if (field.title === undefined && value === undefined) return [];
        return [{ field: { ...field, html: value?.html ?? "" }, plainText: [field.title ?? "", value?.plainText ?? ""].filter((line) => line !== "") }];
      });
      return fields.length === 0 ? null : { part: { kind: "fields", fields: fields.map(({ field }) => field) }, plainText: fields.flatMap(({ plainText }) => plainText) };
    }
    case "image":
      return { part, plainText: [] };
    case "buttons":
      return { part, plainText: [part.buttons.map(({ text }) => text).join(" · ")] };
    case "footer":
      return { part, plainText: part.text === undefined ? [] : [part.text] };
  }
}

/** Rich text as the room keeps a body, mentioning no one, with its plain text, or undefined when it holds nothing. */
function keptText(html: string): { html: string; plainText: string } | undefined {
  const body = prepareBody(html, () => undefined);
  return body === null || body.blank ? undefined : { html: body.html, plainText: body.plainText };
}
