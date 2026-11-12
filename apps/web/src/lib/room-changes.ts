import type { RoomId } from "@ember/protocol";

// What the room shown tells the rest of the tab of its messages changing in place, edited or deleted,
// which the workspace socket says nothing of, so a list that previews them, as the DMs page's does, can
// ask for them again.

/** The event a room's messages changing in place sends, with the room's id. */
export const ROOM_MESSAGES_CHANGED = "ember:room-messages-changed";

/** Tells the tab room `roomId`'s messages have changed in place. */
export const tellRoomMessagesChanged = (roomId: RoomId) => void window.dispatchEvent(new CustomEvent(ROOM_MESSAGES_CHANGED, { detail: roomId }));

/** The event a message's deletion sends, with its id, as Forward message, open on it, says it's gone. */
export const MESSAGE_DELETED = "ember:message-deleted";

/** Tells the tab message `messageId` has been deleted. */
export const tellMessageDeleted = (messageId: string) => void window.dispatchEvent(new CustomEvent(MESSAGE_DELETED, { detail: messageId }));
