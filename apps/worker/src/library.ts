import { isRoomId, type Message, type RoomId, type StoredFile } from "@ember/protocol";
import {
  CANVAS_CHANGED,
  FILE_MARKS_API_PATH,
  FILES_API_PATH,
  FOLDER_FULL,
  fileTypeOf,
  LIBRARY_LIMIT,
  parseCanvasSave,
  parseFileMark,
  parseNewFolderItem,
  parseNewTab,
  parseTabChange,
  parseTabOrder,
  TAB_LIMIT_REACHED,
  type Canvas,
  type FileMarks,
  type FolderItem,
  type Library,
  type LibraryFile,
  type LibraryLink,
  type NewTabTarget,
  type OpenedTab,
  type RoomTab,
  type TabFile,
} from "@ember/protocol/library";
import { credentialsOf } from "./auth";
import { jsonBodyOf } from "./bodies";
import type { Env } from "./env";
import { fileSigner } from "./files/addresses";
import type { AttachedFile } from "./files/blobs";
import type { KeptFile, KeptItem, KeptTab, KeptTarget, LibraryShelf, TabAction, TabAnswer } from "./room-tabs";
import { searchIndex, type ShelvedMessage } from "./search-index";
import { readNow } from "./searches";
import { indexedMessages } from "./store";
import { workspace, type Credentials } from "./workspace";

// The Files page's list of the workspace's files, a room's Files & links, starring files, and a room's tabs
// (room-tabs.ts). The files are the messages with files the search index holds, in the rooms the reader is in,
// read from the index alone, with the canvases the rooms' tabs keep; the links are the addresses in the
// messages with links it holds.

const NOT_SIGNED_IN = "Not signed in";
const ROOM_NOT_FOUND = "Room not found or inaccessible";
const TAB_NOT_FOUND = "That tab isn't there anymore";
const FILE_NOT_FOUND = "That file isn't in this room";

const json = (data: unknown, init?: ResponseInit) => Response.json(data, { ...init, headers: { "Cache-Control": "no-store" } });
const problem = (status: number, message: string) => Response.json({ error: message }, { status });

/** The messages `shelved` names, as the index last took them, or from their rooms where it kept no row. */
async function messagesOf(env: Env, shelved: ShelvedMessage[]): Promise<Message[]> {
  const kept = shelved.flatMap(({ message }) => message ?? []);
  const missing = shelved.filter(({ message }) => message === null).map(({ messageId, roomId }) => ({ messageId, roomId, number: 0, message: null, words: [] }));
  const [indexed, read] = await Promise.all([indexedMessages(kept, env.SESSION_SECRET), readNow(env, missing)]);
  return [...indexed, ...read];
}

/** A file message's file as a library lists it. */
function libraryFileOf(message: Message & { attachment: StoredFile }, marks: Map<string, { starred: boolean; viewedAt: string | null }>): LibraryFile {
  const { attachment: file } = message;
  const mark = marks.get(file.id);
  return {
    id: file.id,
    kind: "file",
    name: file.name,
    type: fileTypeOf(file.contentType, file.name),
    roomId: message.roomId,
    owner: message.creator,
    createdAt: message.createdAt,
    messageId: message.id,
    file,
    starred: mark?.starred ?? false,
    viewedAt: mark?.viewedAt ?? null,
  };
}

const ANCHOR = /<a\s[^>]*?\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
const ADDRESS = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;

/** Markup's text, without its tags, with the entities a message's markup holds decoded. */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * The web addresses a message holds, once each, with what each link says, or else its address: those its
 * markup links, and those its plain text shows, as search's has-link filter finds them.
 */
export function linksOf(message: Pick<Message, "body" | "plainText">): Array<{ url: string; title: string }> {
  const links = new Map<string, string>();
  for (const [, href, inner] of message.body.matchAll(ANCHOR)) {
    const url = textOf(href!);
    // A link that says nothing in words, such as a permalink's "#", is called by its address.
    const said = textOf(inner!);
    if (/^https?:\/\//i.test(url) && !links.has(url)) links.set(url, /[\p{L}\p{N}]/u.test(said) ? said : url);
  }
  for (const [url] of message.plainText.matchAll(ADDRESS)) if (!links.has(url)) links.set(url, url);
  return [...links].map(([url, title]) => ({ url, title }));
}

function libraryLinksOf(message: Message): LibraryLink[] {
  return linksOf(message).map(({ url, title }, index) => ({
    id: `${message.id}:${index}`,
    url,
    title,
    roomId: message.roomId,
    messageId: message.id,
    owner: message.creator,
    createdAt: message.createdAt,
  }));
}

const hasFile = (message: Message): message is Message & { attachment: StoredFile } => message.attachment !== undefined && !message.deleted;

/** The library of `shelf`'s rooms: their files and canvases, newest first, and their links, when `withLinks`. */
async function libraryOf(env: Env, { roomIds, canvases, marks }: LibraryShelf, withLinks: boolean): Promise<Library> {
  if (roomIds.length === 0) return { files: [], links: [] };
  const index = searchIndex(env);
  const [withFiles, linked] = await Promise.all([index.shelved(roomIds, false, LIBRARY_LIMIT), withLinks ? index.shelved(roomIds, true, LIBRARY_LIMIT) : []]);
  const [fileMessages, linkMessages] = await Promise.all([messagesOf(env, withFiles), messagesOf(env, linked)]);
  const marked = new Map(marks.map(({ fileId, ...mark }) => [fileId, mark]));
  const files = fileMessages.filter(hasFile).map((message) => libraryFileOf(message, marked));
  const canvasFiles = canvases.map(
    (canvas): LibraryFile => ({
      id: canvas.id,
      kind: "canvas",
      name: canvas.title,
      type: "documents",
      roomId: canvas.roomId,
      owner: canvas.creator,
      createdAt: canvas.createdAt,
      starred: marked.get(canvas.id)?.starred ?? false,
      viewedAt: marked.get(canvas.id)?.viewedAt ?? null,
    }),
  );
  const newestFirst = (a: LibraryFile, b: LibraryFile) => (a.createdAt < b.createdAt ? 1 : -1);
  return { files: [...files, ...canvasFiles].sort(newestFirst), links: linkMessages.filter((message) => !message.deleted).flatMap(libraryLinksOf) };
}

/** `GET /api/files`: every file and canvas in the rooms you're in, DMs too, with what you've starred and opened. */
async function listFiles(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const shelf = credentials && (await workspace(env).library(credentials, null));
  if (!shelf || shelf === "not found") return problem(401, NOT_SIGNED_IN);
  return json((await libraryOf(env, shelf, false)) satisfies Library);
}

/** `GET /api/rooms/<id>/library`: a room's files, canvases and links, for its Files & links tab. */
async function roomLibrary(request: Request, env: Env, roomId: RoomId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const shelf = credentials && (await workspace(env).library(credentials, roomId));
  if (!shelf) return problem(401, NOT_SIGNED_IN);
  if (shelf === "not found") return problem(404, ROOM_NOT_FOUND);
  return json((await libraryOf(env, shelf, true)) satisfies Library);
}

/** `PUT /api/files/marks`, a `FileMark`: stars a file or a canvas, or not, or records that you opened it. */
async function markFile(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const mark = parseFileMark(await jsonBodyOf(request));
  if (typeof mark === "string") return problem(422, mark);
  // Only a file a message in the room still holds, or one of its canvases, can be marked.
  if (!isRoomId(mark.roomId)) return problem(404, ROOM_NOT_FOUND);
  if (mark.messageId !== undefined) {
    const [message] = await env.CHAT_ROOM.getByName(mark.roomId).messagesWithIds(mark.roomId, [mark.messageId]);
    if (!message || message.deleted || message.attachment?.id !== mark.fileId) return problem(404, FILE_NOT_FOUND);
  }
  const marks = await workspace(env).markFile(credentials, mark);
  if (!marks) return problem(401, NOT_SIGNED_IN);
  return marks === "not found" ? problem(404, ROOM_NOT_FOUND) : json(marks satisfies FileMarks);
}

/** `file` as a tab keeps it, without its addresses, which are signed as it's read. */
const keptFileOf = ({ url: _url, downloadUrl: _downloadUrl, previewUrl, ...file }: StoredFile): AttachedFile => ({ ...file, ...(previewUrl !== undefined && { preview: true as const }) });

/**
 * What a new tab or folder item holds: a link or a canvas as it was sent, or the file a message in the room
 * has, read from the room, or null when the room has no such file.
 */
async function keptTargetOf(env: Env, roomId: RoomId, target: NewTabTarget): Promise<KeptTarget | null> {
  if (target.kind !== "file") return target;
  const [message] = await env.CHAT_ROOM.getByName(roomId).messagesWithIds(roomId, [target.messageId]);
  if (!message?.attachment || message.deleted) return null;
  return { kind: "file", kept: { messageId: message.id, file: keptFileOf(message.attachment) } };
}

/** A kept file with its addresses signed. */
type Sign = (kept: KeptFile) => Promise<TabFile>;

async function signer(env: Env): Promise<Sign> {
  const sign = await fileSigner(env.SESSION_SECRET);
  return async ({ messageId, file: { preview, ...file } }) => ({ messageId, file: { ...file, ...(await sign(file.id, file.name, preview)) } });
}

async function shownTab({ kept, ...tab }: KeptTab, sign: Sign): Promise<RoomTab> {
  return { ...tab, ...(kept && { file: await sign(kept) }) };
}

async function shownItem({ kept, ...item }: KeptItem, sign: Sign): Promise<FolderItem> {
  return { ...item, ...(kept && { file: await sign(kept) }) };
}

/** What a tab action's answer says, as JSON or a problem. */
async function tabResponse(env: Env, answer: TabAnswer | null): Promise<Response> {
  if (!answer) return problem(401, NOT_SIGNED_IN);
  if (answer === "not found") return problem(404, TAB_NOT_FOUND);
  if (answer === "forbidden") return problem(403, "You can't change this room's tabs");
  if (answer === "full") return problem(422, TAB_LIMIT_REACHED);
  if ("removed" in answer) return new Response(null, { status: 204 });
  if ("conflict" in answer) return Response.json({ error: CANVAS_CHANGED, canvas: answer.conflict satisfies Canvas }, { status: 409 });
  const sign = await signer(env);
  if ("tabs" in answer) return json({ tabs: await Promise.all(answer.tabs.map((tab) => shownTab(tab, sign))) });
  const opened: OpenedTab = {
    tab: await shownTab(answer.tab, sign),
    ...(answer.items && { items: await Promise.all(answer.items.map((item) => shownItem(item, sign))) }),
    ...(answer.canvas && { canvas: answer.canvas }),
  };
  return json(opened);
}

/** Asks the Workspace to do `action` to the room's tabs, for whoever `credentials` signs in. */
async function actOnTabs(env: Env, credentials: Credentials, roomId: RoomId, action: TabAction): Promise<Response> {
  return tabResponse(env, await workspace(env).roomTabs(credentials, roomId, action));
}

/** Parses what's sent to add a tab or a folder's item, finding its file in the room, then does it. */
async function addTo(request: Request, env: Env, roomId: RoomId, tabId: string | null): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const body = await jsonBodyOf(request);
  const added = tabId === null ? parseNewTab(body) : parseNewFolderItem(body);
  if (typeof added === "string") return problem(422, added);
  const target = await keptTargetOf(env, roomId, added);
  if (!target) return problem(422, FILE_NOT_FOUND);
  const answer = await workspace(env).roomTabs(
    credentials,
    roomId,
    tabId === null ? { act: "add", title: added.title, target } : { act: "add-item", tabId, title: added.title, target },
  );
  return answer === "full" && tabId !== null ? problem(422, FOLDER_FULL) : tabResponse(env, answer);
}

/** Does what a request to a room's tabs asks, once what it sent parses. */
async function tabsRequest(request: Request, env: Env, roomId: RoomId, action: (body: unknown) => TabAction | string, readsBody = true): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const parsed = action(readsBody ? await jsonBodyOf(request) : null);
  if (typeof parsed === "string") return problem(422, parsed);
  return actOnTabs(env, credentials, roomId, parsed);
}

/**
 * `PUT /api/rooms/<id>/tabs/<tabId>/canvas`, a `CanvasSave`: a canvas sent whole, over the version it was
 * changed from, as an editor without the room's socket, or a page going away, sends it. It goes through
 * the room's object, as people may be writing the canvas together there (canvas-sessions.ts).
 */
async function saveCanvas(request: Request, env: Env, roomId: RoomId, tabId: string): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const save = parseCanvasSave(await jsonBodyOf(request));
  if (typeof save === "string") return problem(422, save);
  const writer = await workspace(env).canvasWriter(credentials, roomId, tabId);
  if (!writer) return problem(401, NOT_SIGNED_IN);
  if (writer === "not found") return problem(404, TAB_NOT_FOUND);
  if (writer === "forbidden") return problem(403, "You can't change this room's tabs");
  const answer = await env.CHAT_ROOM.getByName(roomId).saveCanvas(roomId, tabId, writer.actor, save);
  if (answer === "not found") return problem(404, TAB_NOT_FOUND);
  if ("conflict" in answer) return Response.json({ error: CANVAS_CHANGED, canvas: answer.conflict satisfies Canvas }, { status: 409 });
  return json({ tab: await shownTab(writer.tab, await signer(env)), canvas: answer.canvas } satisfies OpenedTab);
}

const orParsed =<T>(parsed: T | string, action: (value: T) => TabAction): TabAction | string => (typeof parsed === "string" ? parsed : action(parsed));

/** A path segment as text, or null for a malformed escape. */
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** What answers a request to the library's routes, if one of them takes it. */
export function libraryAction(request: Request, env: Env, pathname: string): (() => Promise<Response>) | null {
  const { method } = request;
  if (pathname === FILES_API_PATH && method === "GET") return () => listFiles(request, env);
  if (pathname === FILE_MARKS_API_PATH && method === "PUT") return () => markFile(request, env);
  const match = pathname.match(/^\/api\/rooms\/([^/]+)\/(library|tabs)(?:\/([^/]+))?(?:\/(canvas|items)(?:\/([^/]+))?)?$/);
  if (!match) return null;
  const [, roomId, area, tab, part, itemId] = match as unknown as [string, string, string, string | undefined, string | undefined, string | undefined];
  const tabId = tab === undefined ? undefined : decoded(tab);
  if (!isRoomId(roomId) || tabId === null) return () => Promise.resolve(problem(404, ROOM_NOT_FOUND));
  if (area === "library") return tab === undefined && method === "GET" ? () => roomLibrary(request, env, roomId) : null;
  if (tabId === undefined) {
    if (method === "GET") return () => tabsRequest(request, env, roomId, () => ({ act: "list" }), false);
    if (method === "POST") return () => addTo(request, env, roomId, null);
    return null;
  }
  if (part === undefined) {
    if (tabId === "order" && method === "PUT") return () => tabsRequest(request, env, roomId, (body) => orParsed(parseTabOrder(body), (tabIds) => ({ act: "order", tabIds })));
    if (method === "GET") return () => tabsRequest(request, env, roomId, () => ({ act: "open", tabId }), false);
    if (method === "PATCH") return () => tabsRequest(request, env, roomId, (body) => orParsed(parseTabChange(body), (change) => ({ act: "change", tabId, change })));
    if (method === "DELETE") return () => tabsRequest(request, env, roomId, () => ({ act: "remove", tabId }), false);
    return null;
  }
  if (part === "canvas" && itemId === undefined && method === "PUT") return () => saveCanvas(request, env, roomId, tabId);
  if (part === "items" && itemId === undefined && method === "POST") return () => addTo(request, env, roomId, tabId);
  if (part === "items" && itemId !== undefined && method === "DELETE")
    return () => tabsRequest(request, env, roomId, () => ({ act: "remove-item", tabId, itemId }), false);
  return null;
}
