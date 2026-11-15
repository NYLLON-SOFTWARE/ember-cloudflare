import type { PendingMessage } from "./room-state";

// What's written but not yet in the room, kept in this browser, so that a reload, or a tab closed while
// the room is away, loses none of it: the next view of the room, or of the thread, takes it back and
// sends it, and the room, which knows each message by its id for the app, posts none twice. Files go
// over HTTP once the room is there, so they aren't kept.
//
// Each message is kept under a key of its own, so that tabs of the same room, keeping theirs side by side,
// never write over each other's. A tab takes out only what it has sent or deleted, which tells the others
// to forget it too.

/**
 * Where what `userId` hasn't sent in room `roomId`'s timeline, or the thread of its message `parentId`,
 * is kept: an earlier release kept it all under this key, and now each message's key starts with it.
 */
const keyOf = (roomId: string, userId: string, parentId?: string) => `unsent-${userId}-${roomId}${parentId === undefined ? "" : `-${parentId}`}`;

/** Where the message `clientMessageId` that `userId` hasn't sent in a view is kept. */
const keyOfMessage = (roomId: string, userId: string, parentId: string | undefined, clientMessageId: string) => `${keyOf(roomId, userId, parentId)}:${clientMessageId}`;

/** Where `m`, as it was read back, is kept. */
const keyOfKept = (m: PendingMessage) => keyOfMessage(m.roomId, m.creator.id, m.parentId, m.clientMessageId);

/** What of `messages` is kept: messages, not files, waiting to go, gone without the room saying it has them, or not sent. */
const keepable = (messages: readonly PendingMessage[]) => messages.filter((m) => !m.upload).map(({ sentOver: _, ...m }) => m);

const byWritten = (a: PendingMessage, b: PendingMessage) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

/** The messages in what's kept under a key, `stored`: one, or an earlier release's list of them, leaving out anything else. */
function parsed(stored: string | null): PendingMessage[] {
  try {
    const kept = JSON.parse(stored ?? "[]") as unknown;
    return (Array.isArray(kept) ? (kept as unknown[]) : [kept]).filter(isKept);
  } catch {
    return [];
  }
}

function read(key: string): PendingMessage[] {
  try {
    return parsed(localStorage.getItem(key));
  } catch {
    return [];
  }
}

function write(key: string, m: PendingMessage): void {
  try {
    localStorage.setItem(key, JSON.stringify(m));
  } catch {
    // Not kept, then: it still goes while this page is open.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing was kept, then.
  }
}

function isStillKept(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/**
 * Keeps `messages`, those of a view that aren't in the room yet, in place of what it kept before,
 * `keptBefore`, and beside what other tabs keep for the same view. Answers what it kept, for next time.
 */
export function keepUnsent(roomId: string, userId: string, parentId: string | undefined, messages: readonly PendingMessage[], keptBefore: readonly string[] = []): string[] {
  const kept = keepable(messages);
  const ids = new Set(kept.map((m) => m.clientMessageId));
  for (const clientMessageId of keptBefore) if (!ids.has(clientMessageId)) remove(keyOfMessage(roomId, userId, parentId, clientMessageId));
  for (const m of kept) write(keyOfMessage(roomId, userId, parentId, m.clientMessageId), m);
  return [...ids];
}

/** Forgets `messages`, which the room has, wherever their views kept them. */
export function forgetUnsent(roomId: string, messages: readonly PendingMessage[]): void {
  for (const m of messages) remove(keyOfMessage(roomId, m.creator.id, m.parentId, m.clientMessageId));
}

/** Keeps `messages`, which the room refused or never had, as not sent where they're still kept, so that a reload doesn't send them again. */
export function keepNotSent(roomId: string, messages: readonly PendingMessage[]): void {
  for (const m of keepable(messages)) {
    const key = keyOfMessage(roomId, m.creator.id, m.parentId, m.clientMessageId);
    if (isStillKept(key)) write(key, { ...m, failed: true });
  }
}

/**
 * What was kept for a view, to send again: what was waiting, and what went without an answer, which the
 * room, knowing it has it, doesn't post again. What showed as not sent still does.
 */
export function keptUnsent(roomId: string, userId: string, parentId?: string): PendingMessage[] {
  return keptInRoom(roomId, userId)
    .filter((m) => m.parentId === parentId)
    .map((m) => (m.failed ? m : { ...m, queued: true }));
}

/**
 * Hears what another tab takes out of what's kept for a view, having sent it or deleted it, until the
 * function it answers is called.
 */
export function onTakenElsewhere(roomId: string, userId: string, parentId: string | undefined, taken: (clientMessageIds: string[]) => void): () => void {
  return onTaken((m) => m.roomId === roomId && m.creator.id === userId && m.parentId === parentId, taken);
}

/** Hears what another tab takes out of what's kept for room `roomId`, in its timeline and its threads, until the function it answers is called. */
export function onTakenFromRoomElsewhere(roomId: string, taken: (clientMessageIds: string[]) => void): () => void {
  return onTaken((m) => m.roomId === roomId, taken);
}

/**
 * Hears what another tab takes out of what's kept, among the messages `isFor` picks. A message that's
 * still kept, as one is when a tab moves an earlier release's list to a key for each message, isn't taken.
 */
function onTaken(isFor: (m: PendingMessage) => boolean, taken: (clientMessageIds: string[]) => void): () => void {
  const heard = (event: StorageEvent) => {
    if (!event.key?.startsWith("unsent-")) return;
    const left = new Set(parsed(event.newValue).map((m) => m.clientMessageId));
    const gone = parsed(event.oldValue).flatMap((m) => (isFor(m) && !left.has(m.clientMessageId) && !isStillKept(keyOfKept(m)) ? [m.clientMessageId] : []));
    if (gone.length > 0) taken(gone);
  };
  window.addEventListener("storage", heard);
  return () => window.removeEventListener("storage", heard);
}

/** The keys under which `userId` may keep something for room `roomId`, in its timeline and its threads. */
function keysIn(roomId: string, userId: string): string[] {
  const room = keyOf(roomId, userId);
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => key?.startsWith(room) === true);
    return keys.flatMap(movedToOwnKeys);
  } catch {
    return [];
  }
}

/**
 * Moves what an earlier release kept under `key`, a list of a view's messages, to a key for each message,
 * leaving any copy kept there since. Answers the keys what was under `key` is kept under now.
 */
function movedToOwnKeys(key: string): string[] {
  if (!localStorage.getItem(key)?.startsWith("[")) return [key];
  const messages = read(key);
  for (const m of messages) if (!isStillKept(keyOfKept(m))) write(keyOfKept(m), m);
  remove(key);
  return messages.map(keyOfKept);
}

/**
 * Everything `userId` kept for room `roomId`, in its timeline and its threads, in the order it was written.
 * A key can only start like the room's, as another room's id might, so what's kept is checked for the room.
 */
export function keptInRoom(roomId: string, userId: string): PendingMessage[] {
  return keysIn(roomId, userId)
    .flatMap(read)
    .filter((m) => m.roomId === roomId && m.creator.id === userId)
    .sort(byWritten);
}

/** Forgets what `userId` kept for room `roomId` among `clientMessageIds`, in its timeline or its threads. */
export function forgetInRoom(roomId: string, userId: string, clientMessageIds: readonly string[]): void {
  forgetUnsent(roomId, keptInRoom(roomId, userId).filter((m) => clientMessageIds.includes(m.clientMessageId)));
}

/** Whether what was read back is a message this page wrote, rather than something else under the key. */
function isKept(value: unknown): value is PendingMessage {
  const m = value as Partial<PendingMessage> | null;
  return typeof m === "object" && m !== null && m.pending === true && typeof m.clientMessageId === "string" && typeof m.body === "string" && typeof m.createdAt === "string" && typeof m.roomId === "string" && typeof m.creator?.id === "string";
}
