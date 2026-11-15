import { useEffect, useSyncExternalStore } from "react";
import type { RoomId, ScheduledMessage, UserId } from "@ember/protocol";
import type { RoomFrames } from "./use-room";

// The messages you've scheduled in each room, as its socket tells your tabs of them (`scheduled` frames),
// kept here so a thread's composer has them as the room's does, however late it opens. They're one
// person's: signing in as someone else in this tab forgets the last one's.

const NONE: ScheduledMessage[] = [];
/** Whose the lists are. */
let owner: UserId | null = null;
const lists = new Map<RoomId, ScheduledMessage[]>();
const subscribers = new Set<() => void>();

/** `userId`'s scheduled messages in room `roomId`, as this tab last heard, and none of anyone else's. */
const listOf = (userId: UserId, roomId: RoomId) => (owner === userId ? (lists.get(roomId) ?? NONE) : NONE);

function keep(userId: UserId, roomId: RoomId, messages: ScheduledMessage[]) {
  if (owner !== userId) {
    owner = userId;
    lists.clear();
  } else if (lists.get(roomId) === messages) return;
  lists.set(roomId, messages);
  for (const subscriber of subscribers) subscriber();
}

const subscribe = (subscriber: () => void) => {
  subscribers.add(subscriber);
  return () => void subscribers.delete(subscriber);
};

/** What a composer schedules: its body, when it goes, and, in a thread, the thread's message and whether it goes to the room too. */
export interface NewScheduled {
  body: string;
  sendAt: number;
  parentId?: string;
  alsoSend?: boolean;
}

export interface Scheduled {
  /** Your scheduled messages in the room, soonest first. */
  messages: ScheduledMessage[];
  move(id: string, sendAt: number): boolean;
  sendNow(id: string): boolean;
  remove(id: string): boolean;
}

/**
 * `userId`'s scheduled messages in room `roomId`, kept as `frames` tells of them, and what changes them. A
 * room's opening says nothing when you have none there, so each opening empties the list until it does.
 */
export function useScheduled(userId: UserId, roomId: RoomId, frames: RoomFrames | undefined): Scheduled {
  const messages = useSyncExternalStore(subscribe, () => listOf(userId, roomId));

  useEffect(
    () =>
      frames?.listen((frame) => {
        if (frame.type === "welcome" || frame.type === "resumed") keep(userId, roomId, NONE);
        else if (frame.type === "scheduled") keep(userId, roomId, frame.messages);
      }),
    [frames, userId, roomId],
  );

  const send = (frame: Parameters<RoomFrames["send"]>[0]) => frames?.send(frame) ?? false;
  return {
    messages,
    move: (id, sendAt) => send({ type: "scheduled.update", id, sendAt }),
    sendNow: (id) => send({ type: "scheduled.send", id }),
    remove: (id) => send({ type: "scheduled.delete", id }),
  };
}

/** A message you've scheduled, with the room it's in. */
export interface RoomScheduled {
  roomId: RoomId;
  message: ScheduledMessage;
}

const NO_ROOM_SCHEDULED: RoomScheduled[] = [];
let all: RoomScheduled[] = NO_ROOM_SCHEDULED;
let allOf: Map<RoomId, ScheduledMessage[]> | null = null;

/** Every room's scheduled messages of `userId`'s this tab has heard of, soonest first, kept as one list while none change. */
function everyScheduled(userId: UserId): RoomScheduled[] {
  if (owner !== userId) return NO_ROOM_SCHEDULED;
  const current = new Map(lists);
  if (allOf && allOf.size === current.size && [...current].every(([roomId, messages]) => allOf!.get(roomId) === messages)) return all;
  allOf = current;
  all = [...current].flatMap(([roomId, messages]) => messages.map((message) => ({ roomId, message }))).sort((a, b) => a.message.sendAt - b.message.sendAt);
  return all;
}

/**
 * Every message `userId` has scheduled that this tab has heard of, in the rooms it has opened, soonest
 * first, read only, for Drafts & sent's Scheduled to list. A room's are known once its socket tells of them.
 */
export function useAllScheduled(userId: UserId): RoomScheduled[] {
  return useSyncExternalStore(subscribe, () => everyScheduled(userId));
}
