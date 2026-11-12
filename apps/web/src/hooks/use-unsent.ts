import { useCallback, useEffect } from "react";
import type { ClientFrame, User } from "@ember/protocol";
import { createFrame, takeBack } from "@/lib/outbox";
import { initialRoomState, isPending, isQueued, UNSENT_KEPT_MS, type PendingMessage, type RoomAction, type RoomState } from "@/lib/room-state";
import { keepUnsent, keptUnsent } from "@/lib/unsent-store";

// What a view of a room's timeline, or of a thread, does with what's written but not yet in the room, as
// Slack does: it waits through a connection's dropping, shown as sending, kept in this browser through a
// reload, and goes once the room lets a connection in, in the order it was written. Only what's waited
// five minutes, or the room refuses, shows as not sent, to send again with Retry, write again with Edit,
// or forget with Delete.

/**
 * What this page left unsent in the timeline of room `roomId`, or the thread of its message `parentId`:
 * what the outbox kept as the view went, and what this browser kept through a reload, each once.
 */
export function takeBackUnsent(roomId: string, me: User, parentId?: string): PendingMessage[] {
  const fromOutbox = takeBack(roomId, me, parentId);
  const taken = new Set(fromOutbox.map((m) => m.clientMessageId));
  return [...fromOutbox, ...keptUnsent(roomId, me.id, parentId).filter((m) => !taken.has(m.clientMessageId))];
}

/** Retry and Delete for a message shown as not sent, which Edit uses too, having written it in the composer. */
export interface UnsentActions {
  retry: (clientMessageId: string) => void;
  discard: (clientMessageId: string) => void;
}

/**
 * Keeps `state`'s unsent messages in this browser as they change, shows those that have waited too long
 * without a connection as not sent, and answers Retry and Delete, sending a retried message at once where
 * `send` can.
 */
export function useUnsent(
  roomId: string,
  me: User,
  parentId: string | undefined,
  state: RoomState,
  dispatch: (action: RoomAction) => void,
  /** The view's messages as they are now, which a callback made before they changed reads. */
  latestMessages: () => RoomState["messages"],
  send: (frame: ClientFrame) => boolean,
): UnsentActions {
  const { messages, status, offline } = state;
  useEffect(() => {
    // Until the view has taken back what was kept, it has nothing to keep in its place.
    if (messages === initialRoomState.messages) return;
    // A room that's gone takes nothing more.
    keepUnsent(roomId, me.id, parentId, status === "gone" ? [] : messages.filter(isPending));
  }, [roomId, me.id, parentId, messages, status]);

  const oldestWaiting = offline ? messages.filter(isQueued).map((m) => m.queuedAt ?? m.createdAt).sort()[0] : undefined;
  useEffect(() => {
    if (oldestWaiting === undefined) return;
    const giveUp = () => dispatch({ type: "give-up", before: new Date(Date.now() - UNSENT_KEPT_MS + 1).toISOString() });
    const timer = setTimeout(giveUp, Math.max(0, Date.parse(oldestWaiting) + UNSENT_KEPT_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [oldestWaiting, dispatch]);

  const retry = useCallback(
    (clientMessageId: string) => {
      const message = latestMessages().find((m): m is PendingMessage => isPending(m) && m.failed === true && m.clientMessageId === clientMessageId);
      if (!message) return;
      dispatch({ type: "retry", clientMessageId });
      if (send(createFrame(message))) dispatch({ type: "sent", clientMessageIds: [clientMessageId] });
    },
    [dispatch, latestMessages, send],
  );
  const discard = useCallback((clientMessageId: string) => dispatch({ type: "discard", clientMessageId }), [dispatch]);
  return { retry, discard };
}
