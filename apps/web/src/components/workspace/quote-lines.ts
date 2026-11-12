import { Lexical, type LexicalEditor, type LexicalNode, type ParagraphNode } from "@37signals/lexxy";

// Quotes and lists line by line, as Slack's composer has them. Shift+Enter breaks a line within its
// paragraph, so a message written before it's sent is one paragraph of lines, and Lexical's > shortcut, which
// quotes a paragraph, quoted the first of them and every line after it, while its - shortcut only starts a
// list at a paragraph's start. Typing >, -, * or 1. and a space at the start of any line quotes that line, or
// starts a list with it, and Backspace on an empty line in a quote takes the line out of it, splitting the
// quote around it, so a quote can be followed by what's said about it.

const { $copyNode, $createParagraphNode, $getSelection, $isLineBreakNode, $isParagraphNode, $isRangeSelection, $isTextNode, COMMAND_PRIORITY_HIGH, KEY_BACKSPACE_COMMAND, KEY_SPACE_COMMAND } = Lexical;

const isQuote = (node: LexicalNode | null): boolean => node?.getType() === "quote";

/** Where a collapsed caret is in a paragraph: before child `index`, or `offset` into text child `index`. */
function caretInParagraph(): { paragraph: ParagraphNode; index: number; offset: number } | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const { anchor } = selection;
  const node = anchor.getNode();
  if (anchor.type === "element") return $isParagraphNode(node) ? { paragraph: node, index: anchor.offset, offset: 0 } : null;
  const parent = node.getParent();
  return $isParagraphNode(parent) ? { paragraph: parent, index: node.getIndexWithinParent(), offset: anchor.offset } : null;
}

/**
 * Takes the empty line the caret is on, in a quote, out of it: the lines before it stay quoted, those after it
 * go in a quote of their own below, and the caret goes to a new unquoted line between. Answers whether it did,
 * which it doesn't anywhere but an empty line in a quote.
 */
export function $unquoteEmptyLine(): boolean {
  const caret = caretInParagraph();
  if (!caret || caret.offset !== 0) return false;
  const { paragraph, index } = caret;
  const quote = paragraph.getParent();
  if (!quote || !isQuote(quote)) return false;
  const children = paragraph.getChildren();
  const before = children[index - 1];
  const after = children[index];
  const empty = (index === 0 || $isLineBreakNode(before)) && (after === undefined || $isLineBreakNode(after));
  if (!empty) return false;

  // The breaks on either side of the empty line go with it.
  const following = children.slice(index + 1);
  const later = paragraph.getNextSiblings();
  before?.remove();
  after?.remove();
  for (const node of following) node.remove();
  if (paragraph.getChildrenSize() === 0) paragraph.remove();

  const unquoted = $createParagraphNode();
  quote.insertAfter(unquoted);
  if (following.length > 0 || later.length > 0) {
    const rest = $copyNode(quote);
    if (following.length > 0) rest.append($createParagraphNode().append(...following));
    rest.append(...later);
    unquoted.insertAfter(rest);
  }
  if (quote.getChildrenSize() === 0) quote.remove();
  unquoted.select();
  return true;
}

/** The marks that, with a space after them at a line's start, quote it or start a list with it, and Lexxy's command for each. */
const LINE_MARKERS = [
  { marker: ">", command: "insertQuoteBlock" },
  { marker: "-", command: "insertUnorderedList" },
  { marker: "*", command: "insertUnorderedList" },
  { marker: "1.", command: "insertOrderedList" },
];

/**
 * Quotes the line the caret is on, or starts a list with it, as typing >, -, * or 1. and a space at its start
 * does in Slack, where a line is a line whichever paragraph it's in: gives the line a paragraph of its own,
 * between the lines before and after it, has Lexxy quote it or list it, as its buttons do, and takes the mark
 * out. Answers whether it did, which it doesn't but just after a mark at the start of a line outside a quote or
 * a list.
 */
export function $formatLineAfterMarker(editor: LexicalEditor): boolean {
  const caret = caretInParagraph();
  if (!caret) return false;
  const { paragraph, index, offset } = caret;
  if (paragraph.getParent()?.getType() !== "root") return false;
  const children = paragraph.getChildren();
  const text = children[index];
  const lineStart = index === 0 ? null : children[index - 1];
  if (!$isTextNode(text)) return false;
  const typed = text.getTextContent().slice(0, offset);
  const found = LINE_MARKERS.find(({ marker }) => typed === marker);
  if (!found) return false;
  if (lineStart !== null && !$isLineBreakNode(lineStart)) return false;

  const nextBreak = children.findIndex((node, i) => i > index && $isLineBreakNode(node));
  const line = children.slice(index, nextBreak === -1 ? undefined : nextBreak);
  const following = nextBreak === -1 ? [] : children.slice(nextBreak + 1);
  lineStart?.remove();
  if (nextBreak !== -1) children[nextBreak]!.remove();
  for (const node of [...line, ...following]) node.remove();
  // The lines before stay in the paragraph, an empty one too, which is a blank line.
  const quoted = $createParagraphNode().append(...line);
  paragraph.insertAfter(quoted);
  if (following.length > 0) quoted.insertAfter($createParagraphNode().append(...following));
  if (lineStart === null) paragraph.remove();

  const length = found.marker.length;
  text.select(length, length);
  editor.dispatchCommand(found.command, undefined);
  const rest = text.getTextContent().slice(length);
  if (rest === "") {
    const holder = text.getParent();
    text.remove();
    holder?.select(0, 0);
  } else {
    text.setTextContent(rest);
    text.select(0, 0);
  }
  return true;
}

/** Has `editor` quote line by line, answering what stops it. */
export function registerQuoteLines(editor: LexicalEditor): () => void {
  const unregisterBackspace = editor.registerCommand(
    KEY_BACKSPACE_COMMAND,
    (event: KeyboardEvent | null) => {
      if (!$unquoteEmptyLine()) return false;
      event?.preventDefault();
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );
  // The space after the mark only quotes or lists, as Slack's does.
  const unregisterSpace = editor.registerCommand(
    KEY_SPACE_COMMAND,
    (event: KeyboardEvent) => {
      if (!$formatLineAfterMarker(editor)) return false;
      event.preventDefault();
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );
  return () => {
    unregisterBackspace();
    unregisterSpace();
  };
}
