import { parseServerFrame, type ClientFrame, type RoomId, type ScheduledMessage, type ServerFrame } from "@ember/protocol";
import { roomSocketUrl } from "./api";
import { reconnectingSocket } from "./reconnecting-socket";

/** How long a room has to let the socket in and answer before a change is taken not to have gone. */
export const SCHEDULED_CHANGE_TIMEOUT_MS = 10_000;

/** What can be done to one of your scheduled messages from a page that doesn't have its room open. */
export type ScheduledChange =
  | { type: "send"; id: string }
  | { type: "move"; id: string; sendAt: number }
  | { type: "delete"; id: string }
  /** Schedules again one that was deleted, as Undo does. */
  | { type: "restore"; message: ScheduledMessage };

/**
 * Makes `change` to one of your scheduled messages in room `roomId`, as Drafts & sent's Scheduled does for
 * rooms it doesn't have open, over a socket of its own: a hidden tab's, so the room reads nothing for it.
 * The room lets it in, says what you have scheduled there, then answers the change with what you have
 * scheduled now, or with why it refused it. Answers the message as the room had it before the change,
 * which Undo schedules again, or null when the change didn't go, as when the room refused it, it was gone
 * already, or the room couldn't be reached in time.
 */
export function changeScheduled(roomId: RoomId, change: ScheduledChange): Promise<ScheduledMessage | null> {
  const frame = frameOf(change);
  return new Promise((resolve) => {
    let before: ScheduledMessage | undefined = change.type === "restore" ? change.message : undefined;
    const done = (answer: ScheduledMessage | null) => {
      clearTimeout(timer);
      socket.close();
      resolve(answer);
    };
    const hear = (heard: ServerFrame) => {
      if (heard.type === "welcome" || heard.type === "resumed") {
        socket.connected();
        if (!socket.send(frame)) done(null);
      } else if (heard.type === "error" && heard.failed === frame.type) {
        done(null);
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
      const frame = { type: "scheduled.create" as const, clientMessageId: crypto.randomUUID(), body, sendAt };
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
