import type { PendingMessage } from "./room-state";

// What's written but not yet in the room, kept in this browser, so that a reload, or a tab closed while
// the room is away, loses none of it: the next view of the room, or of the thread, takes it back and
// sends it, and the room, which knows each message by its id for the app, posts none twice. Files go
// over HTTP once the room is there, so they aren't kept.
//
// Every tab of the room keeps what it has under the same key, alongside the other tabs', and takes out only
// what it has sent or deleted, which tells the others to forget it too.

/** Where what `userId` hasn't sent in room `roomId`'s timeline, or the thread of its message `parentId`, is kept. */
const keyOf = (roomId: string, userId: string, parentId?: string) => `unsent-${userId}-${roomId}${parentId === undefined ? "" : `-${parentId}`}`;

/** What of `messages` is kept: messages, not files, waiting to go, gone without the room saying it has them, or not sent. */
const keepable = (messages: readonly PendingMessage[]) => messages.filter((m) => !m.upload).map(({ sentOver: _, ...m }) => m);

const byWritten = (a: PendingMessage, b: PendingMessage) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

/** The messages in what's kept under a key, `stored`, leaving out anything else. */
function parsed(stored: string | null): PendingMessage[] {
  try {
    const kept = JSON.parse(stored ?? "[]") as unknown;
    return Array.isArray(kept) ? (kept as PendingMessage[]).filter(isKept) : [];
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

function write(key: string, messages: readonly PendingMessage[]): void {
  try {
    if (messages.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(messages));
  } catch {
    // Not kept, then: they still go while this page is open.
  }
}

/**
 * Keeps `messages`, those of a view that aren't in the room yet, in place of what it kept before,
 * `keptBefore`, and beside what other tabs keep for the same view. Answers what it kept, for next time.
 */
export function keepUnsent(roomId: string, userId: string, parentId: string | undefined, messages: readonly PendingMessage[], keptBefore: readonly string[] = []): string[] {
  const key = keyOf(roomId, userId, parentId);
  const kept = keepable(messages);
  const replaced = new Set([...keptBefore, ...kept.map((m) => m.clientMessageId)]);
  write(key, [...read(key).filter((m) => !replaced.has(m.clientMessageId)), ...kept].sort(byWritten));
  return kept.map((m) => m.clientMessageId);
}

/** Forgets `messages`, which the room has, wherever their views kept them. */
export function forgetUnsent(roomId: string, messages: readonly PendingMessage[]): void {
  const keys = new Set(messages.map((m) => keyOf(roomId, m.creator.id, m.parentId)));
  const ids = new Set(messages.map((m) => m.clientMessageId));
  for (const key of keys) write(key, read(key).filter((m) => !ids.has(m.clientMessageId)));
}

/**
 * What was kept for a view, to send again: what was waiting, and what went without an answer, which the
 * room, knowing it has it, doesn't post again. What showed as not sent still does.
 */
export function keptUnsent(roomId: string, userId: string, parentId?: string): PendingMessage[] {
  return read(keyOf(roomId, userId, parentId)).map((m) => (m.failed ? m : { ...m, queued: true }));
}

/**
 * Hears what another tab takes out of what's kept for a view, having sent it or deleted it, until the
 * function it answers is called.
 */
export function onTakenElsewhere(roomId: string, userId: string, parentId: string | undefined, taken: (clientMessageIds: string[]) => void): () => void {
  const key = keyOf(roomId, userId, parentId);
  const heard = (event: StorageEvent) => {
    if (event.key !== key) return;
    const left = new Set(parsed(event.newValue).map((m) => m.clientMessageId));
    const gone = parsed(event.oldValue).flatMap((m) => (left.has(m.clientMessageId) ? [] : [m.clientMessageId]));
    if (gone.length > 0) taken(gone);
  };
  window.addEventListener("storage", heard);
  return () => window.removeEventListener("storage", heard);
}

/** The keys under which `userId` may keep something for room `roomId`: its timeline's, and its threads'. */
function keysIn(roomId: string, userId: string): string[] {
  const timeline = keyOf(roomId, userId);
  try {
    return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => key === timeline || key?.startsWith(`${timeline}-`) === true);
  } catch {
    return [];
  }
}

/**
 * Everything `userId` kept for room `roomId`, in its timeline and its threads, in the order it was written.
 * A key can only start like the room's, as another room's id might, so what's kept is checked for the room.
 */
export function keptInRoom(roomId: string, userId: string): PendingMessage[] {
  return keysIn(roomId, userId)
    .flatMap(read)
    .filter((m) => m.roomId === roomId)
    .sort(byWritten);
}

/** Forgets what `userId` kept for room `roomId` among `clientMessageIds`, in its timeline or its threads. */
export function forgetInRoom(roomId: string, userId: string, clientMessageIds: readonly string[]): void {
  const forgotten = (m: PendingMessage) => m.roomId === roomId && clientMessageIds.includes(m.clientMessageId);
  for (const key of keysIn(roomId, userId)) write(key, read(key).filter((m) => !forgotten(m)));
}

/** Whether what was read back is a message this page wrote, rather than something else under the key. */
const isKept = (m: Partial<PendingMessage> | null): m is PendingMessage =>
  typeof m === "object" && m !== null && m.pending === true && typeof m.clientMessageId === "string" && typeof m.body === "string" && typeof m.createdAt === "string";
