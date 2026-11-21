import { clipboard, Menu, shell, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from "electron";

// What a right-click in a site's page offers, as a browser's menu would: spelling, the link or picture
// clicked, and editing. Electron offers nothing unless an app does.

type Section = MenuItemConstructorOptions[];

/** The menu for a right-click in `contents` that `params` describe, or null where there's nothing to offer. */
export function contextMenuOf(contents: WebContents, params: ContextMenuParams): Menu | null {
  const sections = [spelling(contents, params), link(params), picture(contents, params), editing(params)].filter((section) => section.length > 0);
  if (sections.length === 0) return null;
  return Menu.buildFromTemplate(sections.flatMap((section, index) => (index === 0 ? section : [{ type: "separator" as const }, ...section])));
}

function spelling(contents: WebContents, { misspelledWord, dictionarySuggestions }: ContextMenuParams): Section {
  if (!misspelledWord) return [];
  const guesses: Section = dictionarySuggestions.map((word) => ({ label: word, click: () => contents.replaceMisspelling(word) }));
  return [
    ...(guesses.length > 0 ? guesses : [{ label: "No Guesses Found", enabled: false }]),
    { label: "Add to Dictionary", click: () => contents.session.addWordToSpellCheckerDictionary(misspelledWord) },
  ];
}

function link({ linkURL }: ContextMenuParams): Section {
  const url = URL.parse(linkURL);
  if (url === null) return [];
  if (url.protocol === "mailto:") return [{ label: "Copy Email Address", click: () => clipboard.writeText(decoded(url.pathname)) }];
  if (url.protocol !== "https:" && url.protocol !== "http:") return [];
  return [
    { label: "Open Link in Browser", click: () => void shell.openExternal(url.href) },
    { label: "Copy Link", click: () => clipboard.writeText(url.href) },
  ];
}

/** `text` with its escapes decoded, or as it's written where they can't be, as in an address someone mistyped. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function picture(contents: WebContents, { mediaType, srcURL, x, y }: ContextMenuParams): Section {
  if (mediaType !== "image" || !srcURL) return [];
  return [
    { label: "Copy Image", click: () => contents.copyImageAt(x, y) },
    { label: "Save Image As…", click: () => contents.downloadURL(srcURL) },
  ];
}

function editing({ isEditable, selectionText, editFlags }: ContextMenuParams): Section {
  if (!isEditable) return selectionText ? [{ role: "copy" }] : [];
  return [
    { role: "cut", enabled: editFlags.canCut },
    { role: "copy", enabled: editFlags.canCopy },
    { role: "paste", enabled: editFlags.canPaste },
    { type: "separator" },
    { role: "selectAll", enabled: editFlags.canSelectAll },
  ];
}
