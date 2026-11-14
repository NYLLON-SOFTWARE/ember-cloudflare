import { parseServerFrame, type ClientFrame, type RoomId, type ScheduledMessage, type ServerFrame, type UserId } from "@ember/protocol";
import { roomSocketUrl } from "./api";
import { draftPrefixOf, tellDraftsChanged } from "./draft-keys";
import { reconnectingSocket } from "./reconnecting-socket";

/** How long a room has to let the socket in and answer before a change is taken not to have gone. */
export const SCHEDULED_CHANGE_TIMEOUT_MS = 10_000;

/** What can be done to one of your scheduled messages from a page that doesn't have its room open. */
export type ScheduledChange =
  | { type: "send"; id: string }
  | { type: "move"; id: string; sendAt: number }
  | { type: "delete"; id: string }
  /** Schedules again one that was deleted, as Undo does, with the id it goes with, which the room keeps it once by. */
  | { type: "restore"; message: ScheduledMessage; clientMessageId: string };

/** What a change the room refused answers, as opposed to one it never heard, which answers null. */
export const REFUSED = "refused";

/**
 * Makes `change` to one of your scheduled messages in room `roomId`, as Drafts & sent's Scheduled does for
 * rooms it doesn't have open, over a socket of its own: a hidden tab's, so the room reads nothing for it.
 * The room lets it in, says what you have scheduled there, then answers the change with what you have
 * scheduled now, or with why it refused it. Answers the message as the room had it before the change,
 * which Undo schedules again; REFUSED when the room refused it, as for one gone already; or null when the
 * room couldn't be reached in time, so the change may not have gone.
 */
export function changeScheduled(roomId: RoomId, change: ScheduledChange): Promise<ScheduledMessage | typeof REFUSED | null> {
  const frame = frameOf(change);
  return new Promise((resolve) => {
    let before: ScheduledMessage | undefined = change.type === "restore" ? change.message : undefined;
    const done = (answer: ScheduledMessage | typeof REFUSED | null) => {
      clearTimeout(timer);
      socket.close();
      resolve(answer);
    };
    const hear = (heard: ServerFrame) => {
      if (heard.type === "welcome" || heard.type === "resumed") {
        socket.connected();
        if (!socket.send(frame)) done(null);
      } else if (heard.type === "error" && heard.failed === frame.type) {
        done(REFUSED);
      } else if (heard.type === "scheduled") {
        before ??= heard.messages.find(({ id }) => change.type !== "restore" && id === change.id);
        if (before && isMade(change, heard.messages)) done(before);
      }
    };
    const socket = reconnectingSocket({
      url: () => roomSocketUrl(roomId, { visible: false }),
      onMessage: (data) => {
        const heard = parseServerFrame(data);
        if (heard) hear(heard);
      },
      onClose: () => {
        done(null);
        return false;
      },
    });
    const timer = setTimeout(() => done(null), SCHEDULED_CHANGE_TIMEOUT_MS);
  });
}

function frameOf(change: ScheduledChange): ClientFrame {
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
function isMade(change: ScheduledChange, scheduled: ScheduledMessage[]): boolean {
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
 * A deleted message Undo is scheduling again, kept in this browser until its room has it, so that Undo
 * isn't lost to a reload or a closed tab while the room is still being reached.
 */
export interface Restoring {
  roomId: RoomId;
  message: ScheduledMessage;
  clientMessageId: string;
}

const restoringKey = (userId: UserId) => `ember:scheduled-restoring:${userId}`;

/** What `userId`'s Undos are scheduling again, which storage that can't be read keeps none of. */
export function restoringOf(userId: UserId): Restoring[] {
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
  } catch {
    // Storage that can't be reached keeps nothing: the Undo waits only on the socket.
  }
}

/** Where it went, once it's done: scheduled again, or, refused, as when its time has passed, into its composer's draft. */
export type Restored = "restored" | "drafted";

/**
 * Schedules `restoring` again for `userId`, as Undo does, keeping it in this browser until its room has it
 * or has refused it, so it can be sent again (`restoringOf`), as the room keeps it once by its id. One the
 * room refuses goes back to where it was written, as a draft, after any written there since. Answers where
 * it went, or null when the room couldn't be reached, and it's kept to send again.
 */
export async function restoreScheduled(userId: UserId, restoring: Restoring): Promise<Restored | null> {
  const others = () => restoringOf(userId).filter(({ clientMessageId }) => clientMessageId !== restoring.clientMessageId);
  keepRestoring(userId, [...others(), restoring]);
  const answer = await changeScheduled(restoring.roomId, { type: "restore", message: restoring.message, clientMessageId: restoring.clientMessageId });
  if (answer === null) return null;
  if (answer === REFUSED) draftAgain(userId, restoring);
  keepRestoring(userId, others());
  return answer === REFUSED ? "drafted" : "restored";
}

function draftAgain(userId: UserId, { roomId, message }: Restoring) {
  const key = `${draftPrefixOf(userId)}${roomId}${message.parentId === undefined ? "" : `/threads/${message.parentId}`}`;
  try {
    localStorage.setItem(key, (localStorage.getItem(key) ?? "") + message.body);
    tellDraftsChanged();
  } catch {
    // Nowhere to keep it.
  }
}
