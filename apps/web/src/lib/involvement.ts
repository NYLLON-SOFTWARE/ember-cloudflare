import type { Involvement, Room, SidebarRoom } from "@ember/protocol";

/** What each level's button says it does, Campfire's `HUMANIZE_INVOLVEMENT`. */
export const INVOLVEMENT_LABELS: Record<Involvement, string> = {
  mentions: "Notifying about @ mentions",
  everything: "Notifying about all messages",
  nothing: "Notifications are off",
  invisible: "Notifications are off and room invisible in sidebar",
};

/** Each level's name where it's picked from a list: Preferences › Notifications, and a room's details on a phone. */
export const LEVEL_NAMES: Record<Involvement, string> = { everything: "All messages", mentions: "Mentions", nothing: "Nothing", invisible: "Hidden" };

const ROOM_LEVELS: Involvement[] = ["mentions", "everything", "nothing", "invisible"];
const DIRECT_LEVELS: Involvement[] = ["everything", "nothing"];

/**
 * The level after `involvement` in `room`, as its button goes round them, Campfire's
 * `next_involvement_for`: @mentions, all messages, off, then off and hidden in a room, and all messages
 * and off in a DM, starting again from the first after the last or any other.
 */
export function nextInvolvement(room: Room, involvement: Involvement): Involvement {
  const levels = room.kind === "direct" ? DIRECT_LEVELS : ROOM_LEVELS;
  return levels[(levels.indexOf(involvement) + 1) % levels.length]!;
}

/** Whether someone has hidden `room` from their sidebar, which still lists it for them to open. */
export const isHidden = (room: SidebarRoom) => room.involvement === "invisible";
