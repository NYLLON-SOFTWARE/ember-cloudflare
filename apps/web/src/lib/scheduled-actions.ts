import { parseServerFrame, type RoomId, type ScheduledMessage, type ServerFrame, type UserId } from "@ember/protocol";
import { roomSocketUrl } from "./api";
import { draftPrefixOf, tellDraftsChanged } from "./draft-keys";
import { frameOf, isMade, keepScheduling, takeScheduling, type Restoring, type ScheduledChange } from "./scheduled-restoring";
import { reconnectingSocket } from "./reconnecting-socket";

/** How long a room has to let the socket in and answer before a change is taken not to have gone. */
export const SCHEDULED_CHANGE_TIMEOUT_MS = 10_000;

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

/** Where it went, once it's done: scheduled again, or, refused, as when its time has passed, into its composer's draft. */
export type Restored = "restored" | "drafted";

/**
 * Schedules `restoring` again for `userId`, as Undo does, keeping it in this browser until its room has it
 * or has refused it, so it can be sent again (`restoringOf`), as the room keeps it once by its id. One the
 * room refuses goes back to where it was written, as a draft, after any written there since, and only
 * once, however many times it was sent. Answers where it went, or null when the room couldn't be reached,
 * and it's kept to send again.
 */
export async function restoreScheduled(userId: UserId, restoring: Restoring): Promise<Restored | null> {
  keepScheduling(userId, restoring);
  const answer = await changeScheduled(restoring.roomId, { type: "restore", message: restoring.message, clientMessageId: restoring.clientMessageId });
  if (answer === null) return null;
  const taken = takeScheduling(userId, restoring.clientMessageId);
  if (answer === REFUSED && taken) draftAgain(userId, taken);
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

// What the composer keeps, said again here for Drafts & sent.
export { forgetScheduled, keepScheduling, restoringOf, scheduleFrameOf, takeScheduling, type Restoring, type ScheduledChange } from "./scheduled-restoring";
