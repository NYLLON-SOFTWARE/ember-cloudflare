import { useCallback, useEffect, useMemo, useState } from "react";
import type { Message, User } from "@ember/protocol";
import type { RoomFrames } from "./use-room";

/** A pin, as this page keeps it: whose message, who pinned it and when the room has said. */
export interface Pin {
  messageId: string;
  by: User;
  /** When they pinned it, or null since a pin came in that the room hasn't listed yet. */
  at: string | null;
}

/** The listed messages with `id`'s gone, as when it's deleted and takes its pin. */
const forget = (listed: ReadonlyMap<string, Message>, id: string) => {
  if (!listed.has(id)) return listed;
  const rest = new Map(listed);
  rest.delete(id);
  return rest;
};

/** The listed messages with `message` as the room has it now, or as they were when it's none of theirs. */
const retold = (listed: ReadonlyMap<string, Message>, message: Message) => (listed.has(message.id) ? new Map(listed).set(message.id, message) : listed);

/** The listed messages with the boosts of `id`'s as `boosts` makes them, as a reaction comes and goes. */
const withBoosts = (listed: ReadonlyMap<string, Message>, id: string, boosts: (given: Message["boosts"]) => Message["boosts"]) => {
  const message = listed.get(id);
  return message ? retold(listed, { ...message, boosts: boosts(message.boosts) }) : listed;
};

/**
 * A room's pins, over its socket, `frames`: the pins themselves, oldest pinned first, and the messages
 * the room has listed, by id, which the Pinned panel shows. The room is asked for its pins as the page
 * opens and whenever it lets it in again; a pin made or taken away while nobody's asked keeps only its
 * who, whose `at` the next listing says — which the panel asks for, as it opens and as a pin changes
 * while it's open. A deleted message takes its pin, whether it went outright or was kept for its
 * thread's replies, as the room keeps none of one. Each listed message keeps pace with the room, as an
 * edit of, a reaction to or the going of one of theirs comes.
 */
export function usePins(roomId: string, frames: RoomFrames) {
  const [pins, setPins] = useState<Pin[] | null>(null);
  const [listed, setListed] = useState<ReadonlyMap<string, Message>>(new Map());

  useEffect(() => {
    let closed = false;
    const refresh = () => frames.send({ type: "pins.list" });
    const stop = frames.listen((frame) => {
      if (closed) return;
      switch (frame.type) {
        case "welcome":
        case "resumed":
          refresh();
          break;
        case "pins.listed":
          setPins(frame.pins.map(({ message, by, at }) => ({ messageId: message.id, by, at })));
          setListed(new Map(frame.pins.map(({ message }) => [message.id, message])));
          break;
        case "pin.created":
          setPins((pins) => (pins?.some(({ messageId }) => messageId === frame.messageId) ? pins : [...(pins ?? []), { messageId: frame.messageId, by: frame.by, at: null }]));
          break;
        case "pin.deleted":
        case "message.deleted":
          setPins((pins) => pins?.filter(({ messageId }) => messageId !== frame.messageId) ?? pins);
          setListed((listed) => forget(listed, frame.messageId));
          break;
        case "message.updated":
          // A message deleted while its thread has replies is kept for them, so its pin's going comes as its update.
          setPins((pins) => (frame.message.deleted ? pins?.filter(({ messageId }) => messageId !== frame.message.id) ?? pins : pins));
          setListed((listed) => (frame.message.deleted ? forget(listed, frame.message.id) : retold(listed, frame.message)));
          break;
        case "boost.created":
          setListed((listed) => withBoosts(listed, frame.boost.messageId, (boosts) => [...boosts, frame.boost]));
          break;
        case "boost.deleted":
          setListed((listed) => withBoosts(listed, frame.messageId, (boosts) => boosts.filter(({ id }) => id !== frame.boostId)));
          break;
      }
    });
    refresh();
    return () => {
      closed = true;
      stop();
    };
  }, [frames, roomId]);

  const pinnedIds = useMemo(() => new Set((pins ?? []).map(({ messageId }) => messageId)), [pins]);
  const refresh = useCallback(() => frames.send({ type: "pins.list" }), [frames]);

  return { pins, pinnedIds, listed, refresh };
}
