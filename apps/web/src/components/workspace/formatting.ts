// The composer's formatting, as its toolbar offers it and the editor reports it at the cursor. The editor's
// own code is a chunk of its own (editor.ts), so what the toolbar needs to know lives here.

/** What a toolbar button does to the text at the cursor, or to what's selected. */
export type Format =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "code"
  | "numberedList"
  | "bulletList"
  | "quote"
  | "codeBlock"
  | "divider";

/** The kinds of line the paragraph menu turns the lines at the cursor into. */
export type Block = "paragraph" | "heading" | "subheading";

/** What the text at the cursor is, which the toolbar shows as pressed. */
export interface Formats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  /** Inline code, which isn't a code block. */
  code: boolean;
  link: boolean;
  block: Block;
  list: "bullet" | "number" | null;
  quote: boolean;
  codeBlock: boolean;
}

export const NO_FORMATS: Formats = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  code: false,
  link: false,
  block: "paragraph",
  list: null,
  quote: false,
  codeBlock: false,
};

/** The heading each kind of line is, as Lexxy writes it: the paragraph menu's two sizes of heading. */
export const HEADING_TAGS = { heading: "h1", subheading: "h3" } as const satisfies Record<Exclude<Block, "paragraph">, string>;

/** A button of the toolbar, or the paragraph menu or Link, which open something of their own. */
export type Tool = Format | "block" | "link";

/** Whether `format` is on at the cursor. */
export function isActive(tool: Tool, formats: Formats): boolean {
  switch (tool) {
    case "numberedList":
      return formats.list === "number";
    case "bulletList":
      return formats.list === "bullet";
    case "block":
      return formats.block !== "paragraph";
    case "divider":
      return false;
    default:
      return formats[tool];
  }
}

/**
 * Whether `tool` can't be used where the cursor is: inside code, inline or a block, the only button that
 * works is the one that turns that code off, as nothing else formats code.
 */
export function isDisabled(tool: Tool, formats: Formats): boolean {
  if (formats.codeBlock) return tool !== "codeBlock";
  if (formats.code) return tool !== "code";
  return false;
}

/** The toolbar's buttons, in Slack's order, in groups the toolbar rules off from each other. */
export const TOOL_GROUPS: { tool: Tool; label: string; keys?: string }[][] = [
  [
    { tool: "bold", label: "Bold", keys: "B" },
    { tool: "italic", label: "Italic", keys: "I" },
    { tool: "underline", label: "Underline", keys: "U" },
    { tool: "strikethrough", label: "Strikethrough", keys: "⇧X" },
    { tool: "block", label: "Paragraph style" },
  ],
  [
    { tool: "link", label: "Link", keys: "K" },
    { tool: "numberedList", label: "Numbered list" },
    { tool: "bulletList", label: "Bulleted list" },
  ],
  [
    { tool: "quote", label: "Blockquote" },
    { tool: "code", label: "Code" },
    { tool: "codeBlock", label: "Code block" },
    { tool: "divider", label: "Divider" },
  ],
];

/**
 * A phone's tools, which take the place of the composer's buttons while Aa is on, as Slack's do: the
 * character formats, then Link and the lists.
 */
export const PHONE_TOOL_GROUPS: typeof TOOL_GROUPS = [TOOL_GROUPS[0]!.filter(({ tool }) => tool !== "block"), TOOL_GROUPS[1]!];

/** The paragraph menu's kinds of line, as it lists them. */
export const BLOCKS: { block: Block; label: string }[] = [
  { block: "paragraph", label: "Normal text" },
  { block: "heading", label: "Heading" },
  { block: "subheading", label: "Subheading" },
];

/** What the link field takes as an address: one with a scheme, or a bare host, which gets https://. */
export function linkAddress(typed: string): string | null {
  const address = typed.trim();
  // A web address has no spaces, and a host with a dot in it, or is this computer's.
  if (address === "" || /\s/.test(address)) return null;
  // A colon before digits is a port, as in localhost:3000, rather than a scheme's.
  const withScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(address) ? address : `https://${address}`;
  try {
    const url = new URL(withScheme);
    if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) return null;
    return url.protocol.startsWith("http") && !url.hostname.includes(".") && url.hostname !== "localhost" ? null : withScheme;
  } catch {
    return null;
  }
}
