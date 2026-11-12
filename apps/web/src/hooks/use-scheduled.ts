import { useEffect, useEffectEvent, useSyncExternalStore } from "react";
import type { RoomId, ScheduledMessage } from "@ember/protocol";
import type { RoomFrames } from "./use-room";

// The messages you've scheduled in each room, as its socket tells your tabs of them (`scheduled` frames),
// kept here so a thread's composer has them as the room's does, however late it opens.

const NONE: ScheduledMessage[] = [];
const lists = new Map<RoomId, ScheduledMessage[]>();
const subscribers = new Set<() => void>();

function keep(roomId: RoomId, messages: ScheduledMessage[]) {
  if (lists.get(roomId) === messages) return;
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
  /** Schedules a message, answering the id it went with, or null when it couldn't go, as while the room is away. */
  schedule(message: NewScheduled): string | null;
  move(id: string, sendAt: number): boolean;
  sendNow(id: string): boolean;
  remove(id: string): boolean;
}

/**
 * Your scheduled messages in room `roomId`, kept as `frames` tells of them, and what changes them. A
 * room's opening says nothing when you have none there, so each opening empties the list until it does.
 * `onRefused` hears of a message the room wouldn't schedule, with why, by the id this gave it.
 */
export function useScheduled(roomId: RoomId, frames: RoomFrames | undefined, onRefused?: (clientMessageId: string, why: string) => void): Scheduled {
  const messages = useSyncExternalStore(subscribe, () => lists.get(roomId) ?? NONE);
  const refused = useEffectEvent((clientMessageId: string, why: string) => onRefused?.(clientMessageId, why));

  useEffect(
    () =>
      frames?.listen((frame) => {
        if (frame.type === "welcome" || frame.type === "resumed") keep(roomId, NONE);
        else if (frame.type === "scheduled") keep(roomId, frame.messages);
        else if (frame.type === "error" && frame.failed === "scheduled.create" && frame.clientMessageId !== undefined) refused(frame.clientMessageId, frame.message);
      }),
    [frames, roomId],
  );

  const send = (frame: Parameters<RoomFrames["send"]>[0]) => frames?.send(frame) ?? false;
  return {
    messages,
    schedule: ({ body, sendAt, parentId, alsoSend }) => {
      const clientMessageId = crypto.randomUUID();
      const frame = { type: "scheduled.create" as const, clientMessageId, body, sendAt };
      return send(parentId === undefined ? frame : { ...frame, parentId, alsoSend: alsoSend === true }) ? clientMessageId : null;
    },
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

/** Every room's scheduled messages this tab has heard of, soonest first, kept as one list while none change. */
function everyScheduled(): RoomScheduled[] {
  const current = new Map(lists);
  if (allOf && allOf.size === current.size && [...current].every(([roomId, messages]) => allOf!.get(roomId) === messages)) return all;
  allOf = current;
  all = [...current].flatMap(([roomId, messages]) => messages.map((message) => ({ roomId, message }))).sort((a, b) => a.message.sendAt - b.message.sendAt);
  return all;
}

/**
 * Every message you've scheduled that this tab has heard of, in the rooms it has opened, soonest first,
 * read only, for Drafts & sent's Scheduled to list. A room's are known once its socket tells of them.
 */
export function useAllScheduled(): RoomScheduled[] {
  return useSyncExternalStore(subscribe, everyScheduled);
}
