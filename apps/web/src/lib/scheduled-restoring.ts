import type { ClientFrame, RoomId, ScheduledMessage, UserId } from "@ember/protocol";

// What you're scheduling, kept in this browser until its room has it (`keepScheduling`), which the composer
// sends again as its room comes back, apart from making changes to scheduled messages over a socket of their
// own (scheduled-actions.ts), which only Drafts & sent's Scheduled does, and which loads with it.

/** What can be done to one of your scheduled messages from a page that doesn't have its room open. */
export type ScheduledChange =
  | { type: "send"; id: string }
  | { type: "move"; id: string; sendAt: number }
  | { type: "delete"; id: string }
  /** Schedules again one that was deleted, as Undo does, with the id it goes with, which the room keeps it once by. */
  | { type: "restore"; message: ScheduledMessage; clientMessageId: string };

export function frameOf(change: ScheduledChange): ClientFrame {
  switch (change.type) {
    case "send":
      return { type: "scheduled.send", id: change.id };
    case "move":
      return { type: "scheduled.update", id: change.id, sendAt: change.sendAt };
    case "delete":
      return { type: "scheduled.delete", id: change.id };
    case "restore": {
      const { body, sendAt, parentId, alsoSend } = change.message;
      const frame = { type: "scheduled.create" as const, clientMessageId: change.clientMessageId, body, sendAt };
      return parentId === undefined ? frame : { ...frame, parentId, alsoSend: alsoSend === true };
    }
  }
}

/** Whether `scheduled`, what the room says you have scheduled, shows `change` made. */
export function isMade(change: ScheduledChange, scheduled: ScheduledMessage[]): boolean {
  switch (change.type) {
    case "send":
    case "delete":
      return !scheduled.some(({ id }) => id === change.id);
    case "move":
      return scheduled.some(({ id, sendAt }) => id === change.id && sendAt === change.sendAt);
    case "restore": {
      const { body, sendAt, parentId } = change.message;
      return scheduled.some((message) => message.body === body && message.sendAt === sendAt && message.parentId === parentId);
    }
  }
}

/**
 * A message being scheduled, from the composer or by Undo, kept in this browser until its room has it, so
 * that it isn't lost to a dropped socket, a reload or a closed tab while the room is still being reached.
 */
export interface Restoring {
  roomId: RoomId;
  message: ScheduledMessage;
  clientMessageId: string;
}

const restoringKey = (userId: UserId) => `ember:scheduled-restoring:${userId}`;

// What's kept where storage can't be written, as in some private windows: for as long as this tab is open.
const unstored = new Map<UserId, Restoring[]>();

/** What `userId` is scheduling and its room doesn't have yet. */
export function restoringOf(userId: UserId): Restoring[] {
  const inTab = unstored.get(userId);
  if (inTab) return inTab;
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(restoringKey(userId)) ?? "[]");
    return Array.isArray(kept) ? (kept as Restoring[]) : [];
  } catch {
    return [];
  }
}

function keepRestoring(userId: UserId, restoring: Restoring[]) {
  try {
    if (restoring.length === 0) localStorage.removeItem(restoringKey(userId));
    else localStorage.setItem(restoringKey(userId), JSON.stringify(restoring));
    unstored.delete(userId);
  } catch {
    unstored.set(userId, restoring);
  }
}

/** Keeps `restoring` until its room has it or refuses it, in place of any kept with its id. */
export function keepScheduling(userId: UserId, restoring: Restoring) {
  keepRestoring(userId, [...restoringOf(userId).filter(({ clientMessageId }) => clientMessageId !== restoring.clientMessageId), restoring]);
}

/**
 * Takes the one kept with `clientMessageId` out of what's kept, answering it, or undefined when it's gone
 * already, as when another tab, or another answer to the same frame, took it first: so one the room refuses
 * goes back to its draft once.
 */
export function takeScheduling(userId: UserId, clientMessageId: string): Restoring | undefined {
  const kept = restoringOf(userId);
  const taken = kept.find((restoring) => restoring.clientMessageId === clientMessageId);
  if (taken) keepRestoring(userId, kept.filter((restoring) => restoring !== taken));
  return taken;
}

/**
 * Forgets what's kept for room `roomId` that `scheduled`, what the room says you have scheduled there,
 * shows it has, and any `posted` says the room has posted since.
 */
export function forgetScheduled(userId: UserId, roomId: RoomId, scheduled: ScheduledMessage[], posted: (restoring: Restoring) => boolean = () => false) {
  const kept = restoringOf(userId);
  const left = kept.filter((restoring) => restoring.roomId !== roomId || !(isMade({ type: "restore", ...restoring }, scheduled) || posted(restoring)));
  if (left.length < kept.length) keepRestoring(userId, left);
}

/** The frame that schedules `restoring`, with the id the room keeps it once by, however often it's sent. */
export const scheduleFrameOf = ({ message, clientMessageId }: Restoring): ClientFrame => frameOf({ type: "restore", message, clientMessageId });
