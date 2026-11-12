import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { ClientFrame, User } from "@ember/protocol";
import { createFrame, takeBack, takeBackAll } from "@/lib/outbox";
import { initialRoomState, isPending, isQueued, UNSENT_KEPT_MS, type PendingMessage, type RoomAction, type RoomState } from "@/lib/room-state";
import { forgetInRoom, keepUnsent, keptInRoom, keptUnsent, onTakenElsewhere } from "@/lib/unsent-store";

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
 * Keeps `state`'s unsent messages in this browser as they change, beside other tabs', shows those that have
 * waited too long without a connection as not sent, and answers Retry and Delete, sending a retried message
 * at once where `send` can.
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
  const { messages, status, offline, connections } = state;
  // What this view kept last, which it takes out of what's kept once it's sent or deleted.
  const keptHere = useRef<string[]>([]);
  useEffect(() => () => void (keptHere.current = []), [roomId, me.id, parentId]);
  useEffect(() => {
    // Until the view has taken back what was kept, it has nothing to keep in its place. In a room that's
    // gone, what didn't go stays kept, shown as not sent, for what shows in the room's place to show.
    if (messages === initialRoomState.messages) return;
    keptHere.current = keepUnsent(roomId, me.id, parentId, messages.filter(isPending), keptHere.current);
  }, [roomId, me.id, parentId, messages]);

  // What another tab has sent or deleted goes from this one too, rather than being sent again, or coming back.
  useEffect(() => onTakenElsewhere(roomId, me.id, parentId, (clientMessageIds) => dispatch({ type: "taken-elsewhere", clientMessageIds })), [roomId, me.id, parentId, dispatch]);

  // What another tab left waiting, as when it closed before the room let it in, goes as this view connects.
  // If that tab is still open and sends it too, the room posts it once.
  const sendLeftElsewhere = useEffectEvent(() => {
    const here = new Set(latestMessages().map((m) => m.clientMessageId));
    const left = keptUnsent(roomId, me.id, parentId).filter((m) => m.queued && !here.has(m.clientMessageId));
    if (left.length === 0) return;
    dispatch({ type: "kept", messages: left });
    const sent = left.filter((m) => send(createFrame(m))).map((m) => m.clientMessageId);
    if (sent.length > 0) dispatch({ type: "sent", clientMessageIds: sent });
  });
  useEffect(() => {
    if (status === "open") sendLeftElsewhere();
  }, [status, connections]);

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

/**
 * What `me` wrote in room `roomId`, in its timeline or its threads, that the room never had, once the room
 * is gone for them, deleted or no longer theirs: for what shows in the room's place to show, to be copied,
 * and to `forget`, which takes it out of this browser.
 */
export function useUnsentInGoneRoom(roomId: string, me: User): { messages: PendingMessage[]; forget: (clientMessageId: string) => void } {
  const [messages, setMessages] = useState<PendingMessage[]>([]);
  useEffect(() => {
    // The outbox stops sending to the room, and what it had stays in this browser instead, or, where this
    // browser keeps nothing, in this page.
    const left = takeBackAll(roomId, me.id);
    for (const m of left) keepUnsent(roomId, me.id, m.parentId, [m]);
    const kept = keptInRoom(roomId, me.id);
    const ids = new Set(kept.map((m) => m.clientMessageId));
    setMessages([...kept, ...left.filter((m) => !ids.has(m.clientMessageId))]);
  }, [roomId, me.id]);
  const forget = useCallback(
    (clientMessageId: string) => {
      forgetInRoom(roomId, me.id, [clientMessageId]);
      setMessages((messages) => messages.filter((m) => m.clientMessageId !== clientMessageId));
    },
    [roomId, me.id],
  );
  return { messages, forget };
}
