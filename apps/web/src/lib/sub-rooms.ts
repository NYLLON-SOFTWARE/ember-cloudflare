import { subRoomName, type ParentChoice, type Room, type RoomId, type SharedRoom, type User, type UserId } from "@ember/protocol";

// Sub-rooms, as the app shows them (`@ember/protocol`'s sub-rooms.ts says what they are): nested under
// their parent in the sidebar and in workspace settings' room order, and named "Strata – Sales" wherever
// a sub-room is named on its own.

/**
 * A shared room's name as it reads on its own: "Strata – Sales" for a sub-room, with its parent's name
 * as `rooms` has it now, if it has the parent, and its own name for any other room.
 */
export function roomDisplayName(room: SharedRoom, rooms: readonly Room[] = []): string {
  const parent = room.parent && rooms.find((r) => r.id === room.parent!.id);
  return subRoomName(room, parent && parent.kind !== "direct" ? parent.name : undefined);
}

/** A row of a room list nested one level deep: a room, and the sub-rooms listed under it. */
export interface RoomBranch<T extends SharedRoom> {
  room: T;
  subRooms: T[];
}

/**
 * `rooms`, in the order given, as a list one level deep: each sub-room under its parent, in the order
 * given, when the parent's listed too, and otherwise in its own place, as a room of its own would be.
 */
export function roomTree<T extends SharedRoom>(rooms: readonly T[]): RoomBranch<T>[] {
  const listed = new Set(rooms.map((room) => room.id));
  const nested = (room: T) => room.parent !== undefined && listed.has(room.parent.id);
  const children = new Map<RoomId, T[]>();
  for (const room of rooms.filter(nested)) children.set(room.parent!.id, [...(children.get(room.parent!.id) ?? []), room]);
  return rooms.filter((room) => !nested(room)).map((room) => ({ room, subRooms: children.get(room.id) ?? [] }));
}

/** The ids of a tree's rooms, each parent followed by its sub-rooms, as the shared order saves them. */
export const flattened = <T extends SharedRoom>(tree: readonly RoomBranch<T>[]): RoomId[] =>
  tree.flatMap(({ room, subRooms }) => [room.id, ...subRooms.map((sub) => sub.id)]);

/** The people a room under `parent` can take in: everyone in `people` for a parent open to everyone, or else the ones in it. */
export function peopleIn<P extends User>(people: readonly P[], parent: ParentChoice | null | undefined): P[] {
  if (!parent || parent.everyone) return [...people];
  const members = new Set(parent.memberIds);
  return people.filter((person) => members.has(person.id));
}

/** Of `memberIds`, the people moving a room under `parent` would take out of it, not being in the parent. */
export function leavingFor(memberIds: Iterable<UserId>, parent: ParentChoice | null | undefined): UserId[] {
  if (!parent || parent.everyone) return [];
  const members = new Set(parent.memberIds);
  return [...memberIds].filter((id) => !members.has(id));
}

const COLLAPSED_KEY = "ember:collapsed-rooms";

/** The parents whose sub-rooms this browser keeps collapsed in the sidebar. */
export function collapsedRooms(): Set<RoomId> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((id): id is RoomId => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/** Remembers the parents whose sub-rooms this browser keeps collapsed. */
export function keepCollapsed(roomIds: ReadonlySet<RoomId>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...roomIds]));
  } catch {
    // Storage that's full or turned off forgets it with the page.
  }
}
