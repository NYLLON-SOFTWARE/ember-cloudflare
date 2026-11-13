import { useEffect, useState } from "react";
import type { ScheduledMessage } from "@ember/protocol";
import type { RoomFrames } from "./use-room";

const bySendAt = (a: ScheduledMessage, b: ScheduledMessage) => (a.sendAt < b.sendAt ? -1 : a.sendAt > b.sendAt ? 1 : a.id < b.id ? -1 : 1);

/**
 * This person's messages waiting in the room, kept in step with the room socket: listed as the room
 * opens, and as they schedule, cancel, or as one is posted.
 */
export function useScheduled(frames: RoomFrames | undefined): ScheduledMessage[] {
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  useEffect(() => {
    if (!frames) return;
    setScheduled([]);
    const list = () => frames.send({ type: "scheduled.list" });
    list();
    return frames.listen((frame) => {
      if (frame.type === "welcome" || frame.type === "resumed") list();
      if (frame.type === "scheduled.listed") setScheduled(frame.scheduled);
      if (frame.type === "scheduled.created") {
        setScheduled((list) => [...list.filter((item) => item.id !== frame.scheduled.id), frame.scheduled].sort(bySendAt));
      }
      if (frame.type === "scheduled.cancelled" || frame.type === "scheduled.sent") {
        setScheduled((list) => list.filter((item) => item.id !== frame.scheduledId));
      }
    });
  }, [frames]);
  return scheduled;
}
