import type { Message, RoomId } from "@ember/protocol";
import { eachAtMost, ROOMS_AT_ONCE } from "./at-once";
import { sharedDb } from "./db";
import type { Env } from "./env";
import { messagesAnywhereWithIds } from "./store";

/** A message by its room and id, as a to-do or saved item, or its reminder, names it. */
export interface MessageRef {
  roomId: RoomId;
  messageId: string;
}

/**
 * The messages `refs` names, as their rooms have them now, by id: from D1 at once, where every room keeps
 * them, or else from each room once. A message read from D1 counts only in the room its ref names.
 */
export async function messagesOf(env: Env, refs: MessageRef[]): Promise<Map<string, Message>> {
  if (refs.length === 0) return new Map();
  const db = sharedDb(env);
  const messages: Message[] = [];
  if (db) messages.push(...(await messagesAnywhereWithIds(db, refs.map(({ messageId }) => messageId), env.SESSION_SECRET)));
  else
    await eachAtMost([...Map.groupBy(refs, ({ roomId }) => roomId)], ROOMS_AT_ONCE, async ([roomId, inRoom]) => {
      messages.push(...(await env.CHAT_ROOM.getByName(roomId).messagesWithIds(roomId, inRoom.map(({ messageId }) => messageId))));
    });
  const rooms = new Map(refs.map(({ messageId, roomId }) => [messageId, roomId]));
  return new Map(messages.filter((message) => rooms.get(message.id) === message.roomId).map((message) => [message.id, message]));
}
