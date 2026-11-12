import type { PendingMessage } from "./room-state";

// What's written but not yet in the room, kept in this browser, so that a reload, or a tab closed while
// the room is away, loses none of it: the next view of the room, or of the thread, takes it back and
// sends it, and the room, which knows each message by its id for the app, posts none twice. Files go
// over HTTP once the room is there, so they aren't kept.

/** Where what `userId` hasn't sent in room `roomId`'s timeline, or the thread of its message `parentId`, is kept. */
const keyOf = (roomId: string, userId: string, parentId?: string) => `unsent-${userId}-${roomId}${parentId === undefined ? "" : `-${parentId}`}`;

/** What of `messages` is kept: messages, not files, waiting to go, gone without the room saying it has them, or not sent. */
const keepable = (messages: readonly PendingMessage[]) => messages.filter((m) => !m.upload).map(({ sentOver: _, ...m }) => m);

/** Keeps `messages`, those of a view that aren't in the room yet, in place of what was kept for it. */
export function keepUnsent(roomId: string, userId: string, parentId: string | undefined, messages: readonly PendingMessage[]): void {
  const key = keyOf(roomId, userId, parentId);
  const kept = keepable(messages);
  try {
    if (kept.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(kept));
  } catch {
    // Not kept, then: they still go while this page is open.
  }
}

/**
 * What was kept for a view, to send again: what was waiting, and what went without an answer, which the
 * room, knowing it has it, doesn't post again. What showed as not sent still does.
 */
export function keptUnsent(roomId: string, userId: string, parentId?: string): PendingMessage[] {
  try {
    const kept = JSON.parse(localStorage.getItem(keyOf(roomId, userId, parentId)) ?? "[]") as unknown;
    if (!Array.isArray(kept)) return [];
    return (kept as PendingMessage[]).filter(isKept).map((m) => (m.failed ? m : { ...m, queued: true }));
  } catch {
    return [];
  }
}

/** Whether what was read back is a message this page wrote, rather than something else under the key. */
const isKept = (m: Partial<PendingMessage> | null): m is PendingMessage =>
  typeof m === "object" && m !== null && m.pending === true && typeof m.clientMessageId === "string" && typeof m.body === "string" && typeof m.createdAt === "string";
