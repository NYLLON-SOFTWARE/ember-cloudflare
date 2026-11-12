import {
  isMessageTooLong,
  isRoomId,
  isRemindableAt,
  MAX_NOTE_FILE_SIZE,
  MESSAGE_TOO_LONG,
  NOTE_FILE_TOO_LARGE,
  parseNewSavedItem,
  parseSavedChange,
  REMINDER_NOT_AHEAD,
  SAVED_LIST_FULL,
  SAVED_LISTS,
  type Message,
  type NoteFile,
  type RoomId,
  type SavedItem,
  type SavedItems,
  type SavedList,
  type SavedMarks,
  type User,
  type UserId,
} from "@ember/protocol";
import { prepareBody, userIdFromSgid, userIdsIn } from "@ember/richtext";
import { credentialsOf } from "./auth";
import { jsonBodyOf } from "./bodies";
import type { Env } from "./env";
import { fileSigner } from "./files/addresses";
import { objectKey } from "./files/blobs";
import { sanitizedFilename } from "./files/filename";
import { identifiedOf, keptAs } from "./files/uploads";
import { base36 } from "./ids";
import { urlOf } from "./request-url";
import type { KeptNoteFile, StoredSavedChange, StoredSavedItem } from "./saved-store";
import { messagesOf } from "./kept-messages";
import { workspace, type Credentials } from "./workspace";

// To-dos and Saved over HTTP: each person's lists, which the Workspace keeps, with each item's message
// read from its room as it is now, and the files of the notes people keep in To-dos, which go straight to
// R2, as a room's do, but in one request, and are served at the same signed addresses.

const problem = (status: number, message: string) => Response.json({ error: message }, { status });

const NOT_SIGNED_IN = "Not signed in";
const ITEM_NOT_FOUND = "That item isn't in your lists";
const MESSAGE_NOT_FOUND = "Message not found or inaccessible";
const NO_STORAGE = "Ember isn't set up to store files";
const FILE_NOT_FOUND = "That file isn't one of yours";
const EMPTY_NOTE = "Write something or add a file";
const NOTES_STAY = "Only To-dos holds notes of your own";

/** The length of a file's R2 key, as a room's files have (`KEY` in files/serving.ts). */
const KEY_LENGTH = 28;

const isList = (value: string | null): value is SavedList => SAVED_LISTS.includes(value as SavedList);

/** The messages `items` keep, as their rooms have them now, by id, for those whose rooms their person can see. */
function messagesKept(env: Env, items: StoredSavedItem[]): Promise<Map<string, Message>> {
  return messagesOf(
    env,
    items.flatMap(({ available, roomId, messageId }) => (available && roomId !== null && messageId !== null ? [{ roomId, messageId }] : [])),
  );
}

/** A note's files as the app shows them, their addresses signed under `secret`. */
async function noteFilesOf(files: KeptNoteFile[], secret: string): Promise<NoteFile[]> {
  if (files.length === 0) return [];
  const sign = await fileSigner(secret);
  return Promise.all(
    files.map(async ({ key, name, contentType, byteSize, width, height }) => ({
      id: key,
      name,
      contentType,
      byteSize,
      ...(width !== undefined && height !== undefined && { width, height }),
      ...(await sign(key, name)),
    })),
  );
}

/** `item` as its person's lists show it, with its message from `messages`, null once it's deleted. */
async function shownItem(env: Env, item: StoredSavedItem, messages: Map<string, Message>): Promise<SavedItem> {
  const shown: SavedItem = {
    id: item.id,
    list: item.list,
    kind: item.kind,
    completedAt: item.completedAt,
    remindAt: item.remindAt === null ? null : new Date(item.remindAt).toISOString(),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
  if (item.kind === "note") return { ...shown, body: item.body ?? "", plainText: item.plainText ?? "", files: await noteFilesOf(item.files, env.SESSION_SECRET) };
  const kept = { ...shown, roomId: item.roomId!, messageId: item.messageId! };
  if (!item.available) return { ...kept, unavailable: true };
  const message = messages.get(item.messageId!);
  return { ...kept, message: message && !message.deleted ? message : null };
}

async function shownItems(env: Env, items: StoredSavedItem[]): Promise<SavedItem[]> {
  const messages = await messagesKept(env, items);
  return Promise.all(items.map((item) => shownItem(env, item, messages)));
}

/** `GET /api/saved?list=todo|saved`: the list's items, newest first, each message as its room has it now. */
export async function listSaved(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const list = urlOf(request).searchParams.get("list");
  if (!isList(list)) return problem(422, "Ask for To-dos or Saved");
  const items = await workspace(env).savedItems(credentials, list);
  if (!items) return problem(401, NOT_SIGNED_IN);
  return Response.json({ items: await shownItems(env, items) } satisfies SavedItems, { headers: { "Cache-Control": "no-store" } });
}

/** `GET /api/saved/marks`: the messages you keep in either list, so each message's actions say Add or Remove, and how many to-dos are open. */
export async function savedMarks(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const marks = credentials && (await workspace(env).savedMarks(credentials));
  if (!marks) return problem(401, NOT_SIGNED_IN);
  return Response.json(marks satisfies SavedMarks, { headers: { "Cache-Control": "no-store" } });
}

/** `GET /api/saved/<id>`: one of your items, as `GET /api/saved` lists it. */
export async function showSaved(request: Request, env: Env, id: string): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const item = credentials && (await workspace(env).savedItem(credentials, id));
  if (!item) return problem(401, NOT_SIGNED_IN);
  if (item === "missing") return problem(404, ITEM_NOT_FOUND);
  return Response.json((await shownItems(env, [item]))[0], { headers: { "Cache-Control": "no-store" } });
}

/**
 * What the Workspace keeps of a note's markup, naming the people it mentions as they are now, or why it
 * keeps nothing. A note may be empty when it has files.
 */
async function noteBodyOf(env: Env, markup: string): Promise<{ body: string; plainText: string } | string> {
  const ids = userIdsIn(markup);
  const people = new Map<UserId, User>(ids.length === 0 ? [] : (await workspace(env).mentionedPeople(ids)).map((person) => [person.id, person]));
  const prepared = prepareBody(markup, (sgid) => people.get(userIdFromSgid(sgid) ?? ""));
  if (prepared === null) return "Ember couldn't read that to-do";
  if (isMessageTooLong(prepared.plainText)) return MESSAGE_TOO_LONG;
  return prepared.blank ? { body: "", plainText: "" } : { body: prepared.html, plainText: prepared.plainText };
}

/** The files `ids` names, which have to be ones `userId` sent `NOTE_FILES_PATH`, as R2 keeps them, or null if one isn't. */
async function ownFiles(env: Env, userId: UserId, ids: string[]): Promise<KeptNoteFile[] | null> {
  if (ids.length === 0) return [];
  if (!env.FILES) return null;
  const files = env.FILES;
  const heads = await Promise.all(ids.map((id) => (/^[0-9a-z]{28}$/.test(id) ? files.head(objectKey(id)) : null)));
  const kept: KeptNoteFile[] = [];
  for (const [i, head] of heads.entries()) {
    if (!head || head.customMetadata?.owner !== userId) return null;
    const { filename = "", width, height } = head.customMetadata;
    kept.push({
      key: ids[i]!,
      name: filename,
      contentType: head.httpMetadata?.contentType ?? "application/octet-stream",
      byteSize: head.size,
      ...(width && height && { width: Number(width), height: Number(height) }),
    });
  }
  return kept;
}

/** Who `credentials` signs in, or null. */
async function userOf(env: Env, credentials: Credentials | null): Promise<User | null> {
  return credentials && workspace(env).authenticate(credentials);
}

/**
 * `POST /api/saved`, a `NewSavedItem`: keeps a message in To-dos or Saved, or moves your item that keeps
 * it there, answering 201 with the item, or keeps a note of your own in To-dos. A file message keeps its
 * file. A message you can't see answers 404, and a full list 422.
 */
export async function keepSaved(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const user = await userOf(env, credentials);
  if (!user) return problem(401, NOT_SIGNED_IN);
  const asked = parseNewSavedItem(await jsonBodyOf(request));
  if (typeof asked === "string") return problem(422, asked);
  const space = workspace(env);
  if ("messageId" in asked) {
    // The room is asked only once it's known to be theirs, so no request makes a room nobody may open.
    const access = isRoomId(asked.roomId) ? await space.roomAccess(credentials!, asked.roomId) : null;
    if (!access?.member) return problem(404, MESSAGE_NOT_FOUND);
    const [message] = await env.CHAT_ROOM.getByName(asked.roomId).messagesWithIds(asked.roomId, [asked.messageId]);
    if (!message || message.roomId !== asked.roomId || message.deleted) return problem(404, MESSAGE_NOT_FOUND);
    const kind = message.attachment ? "file" : "message";
    const kept = await space.keepMessage(credentials!, asked.list, { roomId: asked.roomId, messageId: asked.messageId, kind });
    if (!kept) return problem(401, NOT_SIGNED_IN);
    if (kept === "forbidden") return problem(404, MESSAGE_NOT_FOUND);
    if (kept === "full") return problem(422, SAVED_LIST_FULL);
    return Response.json(await shownItem(env, kept, new Map([[message.id, message]])), { status: 201 });
  }
  const body = await noteBodyOf(env, asked.body);
  if (typeof body === "string") return problem(422, body);
  const files = await ownFiles(env, user.id, asked.fileIds ?? []);
  if (!files) return problem(422, FILE_NOT_FOUND);
  if (body.body === "" && files.length === 0) return problem(422, EMPTY_NOTE);
  const remindAt = asked.remindAt === undefined ? null : asked.remindAt;
  if (remindAt !== null && !isRemindableAt(remindAt, Date.now())) return problem(422, REMINDER_NOT_AHEAD);
  const kept = await space.keepNote(credentials!, { ...body, files, remindAt: remindAt === null ? null : Date.parse(remindAt) });
  if (!kept) return problem(401, NOT_SIGNED_IN);
  if (kept === "full") return problem(422, SAVED_LIST_FULL);
  return Response.json(await shownItem(env, kept, new Map()), { status: 201 });
}

/**
 * `PATCH /api/saved/<id>`, a `SavedChange`: moves your item to the other list, marks it completed or in
 * progress, sets or clears its reminder, or changes a note's text and files, answering it as it is then.
 * Files a note no longer carries are deleted from R2.
 */
export async function changeSaved(request: Request, env: Env, id: string): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const user = await userOf(env, credentials);
  if (!user) return problem(401, NOT_SIGNED_IN);
  const asked = parseSavedChange(await jsonBodyOf(request));
  if (typeof asked === "string") return problem(422, asked);
  const change: StoredSavedChange = {};
  if (asked.list !== undefined) change.list = asked.list;
  if (asked.completed !== undefined) change.completedAt = asked.completed ? new Date().toISOString() : null;
  if (asked.remindAt !== undefined) {
    if (asked.remindAt !== null && !isRemindableAt(asked.remindAt, Date.now())) return problem(422, REMINDER_NOT_AHEAD);
    change.remindAt = asked.remindAt === null ? null : Date.parse(asked.remindAt);
  }
  if (asked.body !== undefined) {
    const body = await noteBodyOf(env, asked.body);
    if (typeof body === "string") return problem(422, body);
    change.note = body;
  }
  const space = workspace(env);
  let dropped: KeptNoteFile[] = [];
  if (asked.fileIds !== undefined) {
    const before = await space.savedItem(credentials!, id);
    if (!before || before === "missing") return problem(before ? 404 : 401, before ? ITEM_NOT_FOUND : NOT_SIGNED_IN);
    const keeping = new Set(asked.fileIds);
    const added = asked.fileIds.filter((fileId) => !before.files.some(({ key }) => key === fileId));
    const files = await ownFiles(env, user.id, added);
    if (!files) return problem(422, FILE_NOT_FOUND);
    change.files = [...before.files.filter(({ key }) => keeping.has(key)), ...files];
    dropped = before.files.filter(({ key }) => !keeping.has(key));
  }
  const changed = await space.changeSavedItem(credentials!, id, change);
  if (!changed) return problem(401, NOT_SIGNED_IN);
  if (changed === "missing") return problem(404, ITEM_NOT_FOUND);
  if (changed === "full") return problem(422, SAVED_LIST_FULL);
  if (changed === "note") return problem(422, NOTES_STAY);
  await forgetFiles(env, dropped);
  return Response.json((await shownItems(env, [changed]))[0]);
}

/** `DELETE /api/saved/<id>`: clears your item from its list, and a note's files from R2. */
export async function clearSaved(request: Request, env: Env, id: string): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const files = await workspace(env).clearSavedItem(credentials, id);
  if (!files) return problem(401, NOT_SIGNED_IN);
  if (files === "missing") return problem(404, ITEM_NOT_FOUND);
  await forgetFiles(env, files);
  return new Response(null, { status: 204 });
}

/** Has R2 delete `files`, logging rather than failing if it can't. */
async function forgetFiles(env: Env, files: KeptNoteFile[]): Promise<void> {
  if (files.length === 0 || !env.FILES) return;
  try {
    await env.FILES.delete(files.map(({ key }) => objectKey(key)));
  } catch (error) {
    console.error("Could not delete a to-do's files from R2", error);
  }
}

/**
 * `POST /api/saved/files?name=<name>`, a file's bytes, `MAX_NOTE_FILE_SIZE` at most: keeps a file in R2
 * for a note of yours, answering 201 with it, its addresses signed, for a new note or a change to name by
 * its id. Its type is what its bytes say, as a room's file's is.
 */
export async function uploadNoteFile(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const user = await userOf(env, credentials);
  if (!user) return problem(401, NOT_SIGNED_IN);
  if (!env.FILES) return problem(503, NO_STORAGE);
  const declared = Number(request.headers.get("Content-Length"));
  if (declared > MAX_NOTE_FILE_SIZE) return problem(413, NOTE_FILE_TOO_LARGE);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_NOTE_FILE_SIZE) return problem(413, NOTE_FILE_TOO_LARGE);
  const name = sanitizedFilename(urlOf(request).searchParams.get("name") ?? "").slice(0, 255) || "file";
  const { contentType, metadata } = identifiedOf(bytes.subarray(0, 64 * 1024), name, request.headers.get("Content-Type") ?? "");
  const { width, height } = JSON.parse(metadata) as { width?: number; height?: number };
  const key = base36(KEY_LENGTH);
  const kept = keptAs(contentType, name);
  const shape: Record<string, string> = width !== undefined && height !== undefined ? { width: String(width), height: String(height) } : {};
  await env.FILES.put(objectKey(key), bytes, { ...kept, customMetadata: { ...kept.customMetadata, owner: user.id, ...shape } });
  const [file] = await noteFilesOf([{ key, name, contentType, byteSize: bytes.length, ...(width !== undefined && height !== undefined && { width, height }) }], env.SESSION_SECRET);
  return Response.json(file, { status: 201 });
}
