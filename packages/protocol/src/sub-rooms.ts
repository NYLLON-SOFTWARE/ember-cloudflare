import type { RoomIconName, RoomId, UserId } from "./index.ts";

// Sub-rooms: rooms nested under a room, exactly one level deep. A sub-room is an open or private room
// in every way but one: who can be in it. Access to a sub-room needs access to its parent, so its
// members are always some of its parent's, and a sub-room open to "Everyone" takes in everyone in its
// parent, rather than the whole workspace. A room with sub-rooms can't become one, a sub-room can't
// have its own, and a DM is neither. Deleting a parent makes its sub-rooms rooms of their own.

/** The room a sub-room is under, with its name as it was when the sub-room was read. */
export interface RoomParent {
  id: RoomId;
  name: string;
}

/**
 * A room someone could put a room under, as New room and a room's settings offer them: a room of theirs
 * that isn't a sub-room or a DM. Its people are everyone active when `everyone` is true, or else the ones
 * `memberIds` names, which the forms offer a sub-room's access to.
 */
export interface ParentChoice {
  id: RoomId;
  name: string;
  /** Null for the default `#`. */
  icon: RoomIconName | null;
  everyone: boolean;
  memberIds: UserId[];
}

/** What separates a parent's name from its sub-room's where a sub-room is named on its own: "Strata – Sales". */
export const SUB_ROOM_SEPARATOR = " – ";

/** What the server says when a room can't go under the parent asked for. */
export const SUB_ROOM_REFUSED = "A room can only go under a room you're in that isn't a sub-room itself, and a room with sub-rooms can't become one";

/**
 * A shared room's name as it reads on its own, outside its parent's list: "Strata – Sales" for a
 * sub-room, and its own name for any other. `parentName` gives the parent's name as it is now, when the
 * reader knows it, in place of the name the room was read with.
 */
export function subRoomName(room: { name: string; parent?: RoomParent }, parentName?: string): string {
  return room.parent ? `${parentName ?? room.parent.name}${SUB_ROOM_SEPARATOR}${room.name}` : room.name;
}

/**
 * The parent a request names: undefined when it's left out, which keeps the parent, null for none, or a
 * room's id. Anything else is refused, as false.
 */
export function parentIdOf(value: unknown, isRoomId: (value: string) => boolean): RoomId | null | undefined | false {
  if (value === undefined || value === null) return value;
  return typeof value === "string" && isRoomId(value) ? value : false;
}
