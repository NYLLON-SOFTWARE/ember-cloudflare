import type { StoredFile } from "./files.ts";
import type { RoomId, User, UserId } from "./index.ts";
import { MAX_ID_LENGTH } from "./pages.ts";

// The workspace's files, as Slack's Files page lists them, and a room's tabs, as Slack's channel tabs hold
// them. Files are the files people send in messages, which the search index keeps with their messages, and
// the canvases rooms keep in tabs; links are the addresses messages hold. Imported from
// "@ember/protocol/library", so the app's main chunk carries only what the room's tabs need of it.

/** The kinds of file the Types menu narrows the list to, read from a file's type and name (`fileTypeOf`). */
export const FILE_TYPES = ["documents", "spreadsheets", "presentations", "pdfs", "images", "videos", "audio", "snippets", "other"] as const;
export type FileType = (typeof FILE_TYPES)[number];

/** What the Types menu calls each kind of file. */
export const FILE_TYPE_LABELS: Record<FileType, string> = {
  documents: "Canvases and documents",
  spreadsheets: "Spreadsheets",
  presentations: "Presentations",
  pdfs: "PDFs",
  images: "Images",
  videos: "Videos",
  audio: "Audio",
  snippets: "Snippets",
  other: "Other",
};

const EXTENSIONS: Array<[FileType, string[]]> = [
  ["pdfs", ["pdf"]],
  ["spreadsheets", ["xls", "xlsx", "xlsm", "ods", "csv", "tsv", "numbers"]],
  ["presentations", ["ppt", "pptx", "odp", "key"]],
  ["documents", ["doc", "docx", "odt", "rtf", "txt", "md", "markdown", "pages"]],
  [
    "snippets",
    ["js", "jsx", "ts", "tsx", "json", "html", "css", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "sh", "sql", "yml", "yaml", "toml", "xml", "php"],
  ],
  ["images", ["png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "heif", "svg", "bmp", "tif", "tiff", "ico"]],
  ["videos", ["mp4", "mov", "webm", "mkv", "avi", "m4v"]],
  ["audio", ["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "opus"]],
];

const TYPE_PATTERNS: Array<[FileType, RegExp]> = [
  ["pdfs", /^application\/pdf$/],
  ["spreadsheets", /spreadsheet|ms-excel|^text\/(csv|tab-separated-values)$/],
  ["presentations", /presentation|powerpoint/],
  ["documents", /wordprocessing|msword|opendocument\.text|^application\/rtf$|^text\/(plain|markdown)$/],
  ["snippets", /^(text\/(html|css|javascript|x-[\w-]+)|application\/(json|javascript|xml|x-sh|sql|x-yaml))$/],
  ["images", /^image\//],
  ["videos", /^video\//],
  ["audio", /^audio\//],
];

/** The kind of file of type `contentType` named `name`: by its type, or else its name's extension. */
export function fileTypeOf(contentType: string, name: string): FileType {
  for (const [type, pattern] of TYPE_PATTERNS) if (pattern.test(contentType)) return type;
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  for (const [type, extensions] of EXTENSIONS) if (extensions.includes(extension)) return type;
  return "other";
}

/** Whether a file of `type` is a picture or a video, which Files & links shows under Media. */
export const isMedia = (type: FileType) => type === "images" || type === "videos";

/**
 * A file the Files page lists: a file someone sent in a message, or a room's canvas, with who made it, when,
 * and whether the person reading has starred it and when they last opened it.
 */
export interface LibraryFile {
  /** The file's key, or the canvas's tab's id. */
  id: string;
  kind: "file" | "canvas";
  name: string;
  type: FileType;
  roomId: RoomId;
  owner: User;
  createdAt: string;
  /** A file's message, and the file as it shows there. */
  messageId?: string;
  file?: StoredFile;
  starred: boolean;
  viewedAt: string | null;
}

/** A link a message holds: its address, what it says, and who sent it where and when. */
export interface LibraryLink {
  /** The message's id and the link's place in it. */
  id: string;
  url: string;
  title: string;
  roomId: RoomId;
  messageId: string;
  owner: User;
  createdAt: string;
}

/** What `GET /api/files` answers, and `GET /api/rooms/<id>/library` for one room, with its links. */
export interface Library {
  files: LibraryFile[];
  links: LibraryLink[];
}

/** The most file messages, and messages with links, the library reads, newest first. */
export const LIBRARY_LIMIT = 1_000;

export const FILES_API_PATH = "/api/files";
export const FILE_MARKS_API_PATH = "/api/files/marks";
export const roomLibraryPath = (roomId: RoomId) => `/api/rooms/${encodeURIComponent(roomId)}/library`;

/** Starring a file or a canvas, or not, or saying it was opened, as `PUT /api/files/marks` takes it. */
export interface FileMark {
  fileId: string;
  roomId: RoomId;
  starred?: boolean;
  viewed?: true;
}

/** What marking a file answers: whether it's starred, and when it was last opened. */
export interface FileMarks {
  starred: boolean;
  viewedAt: string | null;
}

/** Parses an untrusted `FileMark`, or returns why it's refused. */
export function parseFileMark(data: unknown): FileMark | string {
  if (!isObject(data)) return "Expected a JSON object";
  const { fileId, roomId, starred, viewed } = data;
  if (!isId(fileId)) return "A file's id is needed";
  if (!isId(roomId)) return "A file's room is needed";
  if (starred !== undefined && typeof starred !== "boolean") return "Starred is true or false";
  if (viewed !== undefined && viewed !== true) return "Viewed can only be true";
  if (starred === undefined && viewed === undefined) return "Nothing to mark";
  return { fileId, roomId, ...(starred !== undefined && { starred }), ...(viewed && { viewed }) };
}

// Listing: what the Files page and a room's Files & links narrow the library to, and its order.

/** Whose files: everyone's, the reader's own, or others'. */
export type FileOwner = "all" | "mine" | "shared";

/** The order a list takes. */
export const FILE_SORTS = ["viewed", "newest", "oldest", "name"] as const;
export type FileSort = (typeof FILE_SORTS)[number];
export const FILE_SORT_LABELS: Record<FileSort, string> = { viewed: "Recently viewed", newest: "Newest", oldest: "Oldest", name: "Name A–Z" };

/** When the files were sent: any time, today, the last 7 or 30 days, or between two days, as `YYYY-MM-DD`, each included. */
export type FileDate = { within: "any" | "today" | "7d" | "30d" } | { from: string; to: string };
export const ANY_TIME: FileDate = { within: "any" };

/** What a list is narrowed to. */
export interface FileFilters {
  /** Words each name has, ignoring case. */
  q: string;
  owner: FileOwner;
  /** The kinds of file shown, or every kind when it's empty. */
  types: FileType[];
  /** Only someone's files. */
  from?: UserId;
  /** Only one room's. */
  in?: RoomId;
  date: FileDate;
  /** Only starred files. */
  starred?: boolean;
  /** Only canvases. */
  canvases?: boolean;
}

export const NO_FILE_FILTERS: FileFilters = { q: "", owner: "all", types: [], date: ANY_TIME };

/** How many of the dialog's filters are on: From, In and Date. */
export const filtersOn = ({ from, in: room, date }: FileFilters) => [from, room, "within" in date && date.within === "any" ? undefined : date].filter((on) => on !== undefined).length;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The start of the day `day` names, `YYYY-MM-DD`, in local time, or NaN. */
const startOfDay = (day: string) => new Date(`${day}T00:00:00`).getTime();

/** Whether something sent at `createdAt` falls within `date`, as of `now`, in local time. */
export function isWithin(createdAt: string, date: FileDate, now: Date): boolean {
  const at = Date.parse(createdAt);
  if ("from" in date) {
    const from = startOfDay(date.from);
    const to = startOfDay(date.to) + DAY_MS;
    return (Number.isNaN(from) || at >= from) && (Number.isNaN(to) || at < to);
  }
  if (date.within === "any") return true;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const since = date.within === "today" ? today : now.getTime() - (date.within === "7d" ? 7 : 30) * DAY_MS;
  return at >= since;
}

/** Whether `name` holds every word of `q`, ignoring case. */
const hasWords = (name: string, q: string) => {
  const lower = name.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((word) => lower.includes(word));
};

/** Whether `item`, sent by its owner, passes the filters a link can: words, owner, person, room and date. */
function passes(item: { owner: User; roomId: RoomId; createdAt: string }, name: string, filters: FileFilters, meId: UserId, now: Date): boolean {
  if (filters.q.trim() && !hasWords(name, filters.q.trim())) return false;
  if (filters.owner === "mine" && item.owner.id !== meId) return false;
  if (filters.owner === "shared" && item.owner.id === meId) return false;
  if (filters.from !== undefined && item.owner.id !== filters.from) return false;
  if (filters.in !== undefined && item.roomId !== filters.in) return false;
  return isWithin(item.createdAt, filters.date, now);
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
const newestFirst = (a: { createdAt: string }, b: { createdAt: string }) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

/** The files `filters` lets through, in `sort`'s order. Recently viewed puts those never opened last, newest first. */
export function listFiles(files: LibraryFile[], filters: FileFilters, sort: FileSort, meId: UserId, now = new Date()): LibraryFile[] {
  const shown = files.filter(
    (file) =>
      passes(file, file.name, filters, meId, now) &&
      (filters.types.length === 0 || filters.types.includes(file.type)) &&
      (!filters.starred || file.starred) &&
      (!filters.canvases || file.kind === "canvas"),
  );
  switch (sort) {
    case "name":
      return shown.sort(byName);
    case "oldest":
      return shown.sort((a, b) => newestFirst(b, a));
    case "newest":
      return shown.sort(newestFirst);
    case "viewed":
      return shown.sort((a, b) => (a.viewedAt === b.viewedAt ? newestFirst(a, b) : a.viewedAt === null ? 1 : b.viewedAt === null ? -1 : a.viewedAt < b.viewedAt ? 1 : -1));
  }
}

/** The links `filters` lets through, by their titles and addresses, in `sort`'s order, where Recently viewed is newest first. */
export function listLinks(links: LibraryLink[], filters: FileFilters, sort: FileSort, meId: UserId, now = new Date()): LibraryLink[] {
  const shown = links.filter((link) => passes(link, `${link.title} ${link.url}`, filters, meId, now));
  if (sort === "name") return shown.sort((a, b) => byName({ name: a.title }, { name: b.title }));
  return shown.sort(sort === "oldest" ? (a, b) => newestFirst(b, a) : newestFirst);
}

// Room tabs: Messages, Files & links, and those a room's members add: a file, a link, a folder of files and
// links, or a canvas, a document the room's members write together.

export const ROOM_TAB_KINDS = ["file", "link", "folder", "canvas"] as const;
export type RoomTabKind = (typeof ROOM_TAB_KINDS)[number];

/** A file sent in the room, as a tab or a folder holds it: its message, and the file as it shows there. */
export interface TabFile {
  messageId: string;
  file: StoredFile;
}

/** A tab a room's member added. */
export interface RoomTab {
  id: string;
  roomId: RoomId;
  kind: RoomTabKind;
  title: string;
  creator: User;
  createdAt: string;
  updatedAt: string;
  /** A file tab's file. */
  file?: TabFile;
  /** A link tab's address. */
  url?: string;
}

/** A file or a link in a folder. */
export interface FolderItem {
  id: string;
  title: string;
  creator: User;
  createdAt: string;
  file?: TabFile;
  url?: string;
}

/** A canvas: its document, as Tiptap's JSON, and how many times it's been saved, which a save names to say what it changes. */
export interface Canvas {
  body: string;
  version: number;
  updatedAt: string;
  updatedBy: User;
}

/** What opening a tab answers: the tab, a folder's files and links, or a canvas's document. */
export interface OpenedTab {
  tab: RoomTab;
  items?: FolderItem[];
  canvas?: Canvas;
}

/** What a canvas starts as: an empty paragraph. */
export const EMPTY_CANVAS = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });

/** The most tabs a room's members can add, past Messages and Files & links. */
export const MAX_ROOM_TABS = 20;
/** The most files and links a folder holds. */
export const MAX_FOLDER_ITEMS = 100;
export const MAX_TAB_TITLE_LENGTH = 80;
export const MAX_URL_LENGTH = 2048;
/** The most characters a canvas's document takes, as JSON. */
export const MAX_CANVAS_LENGTH = 500_000;

export const TAB_LIMIT_REACHED = `A room holds at most ${MAX_ROOM_TABS} tabs.`;
export const FOLDER_FULL = `A folder holds at most ${MAX_FOLDER_ITEMS} files and links.`;
export const CANVAS_TOO_LONG = "That canvas is too long to save.";
export const CANVAS_CHANGED = "Someone else changed this canvas. It shows their changes now.";

export const roomTabsPath = (roomId: RoomId) => `/api/rooms/${encodeURIComponent(roomId)}/tabs`;
export const roomTabPath = (roomId: RoomId, tabId: string) => `${roomTabsPath(roomId)}/${encodeURIComponent(tabId)}`;

/** What adding a tab or a folder's item sends: a file sent in the room names its message. */
export type NewTabTarget = { kind: "file"; messageId: string } | { kind: "link"; url: string } | { kind: "folder" } | { kind: "canvas" };
export type NewTab = NewTabTarget & { title: string };
export type NewFolderItem = ({ kind: "file"; messageId: string } | { kind: "link"; url: string }) & { title: string };

/** What a tab's change sends: its new title. */
export interface TabChange {
  title: string;
}

/** What saving a canvas sends: its document, and the version it changes. */
export interface CanvasSave {
  body: string;
  version: number;
}

function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;

/** A title, trimmed, or why it's refused. */
function titleOf(title: unknown): string | { error: string } {
  if (typeof title !== "string" || !title.trim()) return { error: "A tab needs a name" };
  if (title.trim().length > MAX_TAB_TITLE_LENGTH) return { error: `Names are at most ${MAX_TAB_TITLE_LENGTH} characters` };
  return title.trim();
}

// Both of the protocol's runtimes have the WHATWG URL parser, which its ES2022 library doesn't declare.
declare const URL: new (url: string) => { readonly protocol: string };

/** Whether `url` is a web address a link may hold: http or https, and not too long. */
export function isWebAddress(url: unknown): url is string {
  if (typeof url !== "string" || url.length > MAX_URL_LENGTH) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** A target as one of `kinds`, or why it's refused. */
function targetOf(data: Record<string, unknown>, kinds: readonly RoomTabKind[]): NewTabTarget | string {
  const { kind, messageId, url } = data;
  if (typeof kind !== "string" || !(kinds as readonly string[]).includes(kind)) return "That isn't something a tab can hold";
  if (kind === "file") return isId(messageId) ? { kind, messageId } : "Pick a file sent in the room";
  if (kind === "link") return isWebAddress(url) ? { kind, url } : "Links start with http:// or https://";
  return { kind: kind as "folder" | "canvas" };
}

/** Parses an untrusted `NewTab`, or returns why it's refused. */
export function parseNewTab(data: unknown): NewTab | string {
  if (!isObject(data)) return "Expected a JSON object";
  const title = titleOf(data.title);
  if (typeof title !== "string") return title.error;
  const target = targetOf(data, ROOM_TAB_KINDS);
  return typeof target === "string" ? target : { ...target, title };
}

/** Parses an untrusted `NewFolderItem`, or returns why it's refused. */
export function parseNewFolderItem(data: unknown): NewFolderItem | string {
  if (!isObject(data)) return "Expected a JSON object";
  const title = titleOf(data.title);
  if (typeof title !== "string") return title.error;
  const target = targetOf(data, ["file", "link"]);
  return typeof target === "string" ? target : ({ ...target, title } as NewFolderItem);
}

/** Parses an untrusted `TabChange`, or returns why it's refused. */
export function parseTabChange(data: unknown): TabChange | string {
  if (!isObject(data)) return "Expected a JSON object";
  const title = titleOf(data.title);
  return typeof title === "string" ? { title } : title.error;
}

/** Parses an untrusted order of a room's tabs, by their ids, or returns why it's refused. */
export function parseTabOrder(data: unknown): string[] | string {
  if (!isObject(data) || !Array.isArray(data.tabIds)) return "Expected the tabs' ids";
  const { tabIds } = data;
  if (tabIds.length > MAX_ROOM_TABS || !tabIds.every(isId) || new Set(tabIds).size !== tabIds.length) return "Expected the tabs' ids, once each";
  return tabIds;
}

/** Whether `body` is a Tiptap document as JSON: an object of type "doc". */
function isDocument(body: string): boolean {
  try {
    const doc = JSON.parse(body) as unknown;
    return isObject(doc) && doc.type === "doc" && (doc.content === undefined || Array.isArray(doc.content));
  } catch {
    return false;
  }
}

/** Parses an untrusted `CanvasSave`, or returns why it's refused. */
export function parseCanvasSave(data: unknown): CanvasSave | string {
  if (!isObject(data)) return "Expected a JSON object";
  const { body, version } = data;
  if (typeof body !== "string") return "A canvas is a document";
  if (body.length > MAX_CANVAS_LENGTH) return CANVAS_TOO_LONG;
  if (!isDocument(body)) return "A canvas is a document";
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) return "A canvas's version is a number";
  return { body, version };
}
