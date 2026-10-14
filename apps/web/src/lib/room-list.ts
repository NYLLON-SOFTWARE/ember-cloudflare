import type { Room, RoomId, RoomList } from "@ember/protocol";

// Someone's rooms keep the order `GET /api/rooms` gives them, the order they were made, which `/` and
// `/rooms` go by. The sidebar lists them by name, as ember-rust's does (membership.rs), compared as
// SQLite's NOCASE compares it, folding only ASCII letters, then by id.

const folded = (name: string) => name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

const codePoints = (text: string) => Array.from(text, (character) => character.codePointAt(0)!);

/**
 * Compares by code point, as SQLite compares UTF-8. JavaScript's `<` compares UTF-16 units instead,
 * which puts an emoji, a pair of surrogates, before characters such as "Ａ" that come before it.
 */
function compare(x: number[], y: number[]): number {
  for (let i = 0; i < x.length && i < y.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

/** `rooms` in the sidebar's order, by name, each name and id read once rather than at every comparison. */
export function byName(rooms: Room[]): Room[] {
  return rooms
    .map((room) => ({ room, name: codePoints(folded(room.name)), id: codePoints(room.id) }))
    .sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id))
    .map(({ room }) => room);
}

/** `rooms` with `room` as it is now, in place of what it was, or last, as the room made most recently. */
export function withRoom(rooms: Room[], room: Room): Room[] {
  return rooms.some((r) => r.id === room.id) ? rooms.map((r) => (r.id === room.id ? room : r)) : [...rooms, room];
}

/**
 * A change made here to someone's rooms, which the server's list shows the next time it's asked: a
 * room saved, or one that's gone for this person, deleted or no longer theirs.
 */
export type RoomChange = { type: "saved"; room: Room } | { type: "gone"; roomId: RoomId };

/**
 * Someone's rooms: the server's list, once it arrives, with the changes made here since it was asked
 * for. Asked for again, it keeps the list it has until the new one arrives.
 */
export interface RoomListState {
  list: RoomList | null;
  /** While a list is on its way, the changes made since it was asked for, which it may not show; otherwise null. */
  pending: RoomChange[] | null;
}

export const NO_ROOM_LIST: RoomListState = { list: null, pending: [] };

/** A change made here, or the list asked for, arriving, or failing to. */
export type RoomListAction = RoomChange | { type: "asked" } | { type: "loaded"; list: RoomList } | { type: "unanswered" };

const changed = (list: RoomList, change: RoomChange): RoomList => ({
  ...list,
  rooms: change.type === "saved" ? withRoom(list.rooms, change.room) : list.rooms.filter((room) => room.id !== change.roomId),
});

export function roomListReducer(state: RoomListState, action: RoomListAction): RoomListState {
  switch (action.type) {
    case "asked":
      return { ...state, pending: [] };
    case "loaded":
      return { list: (state.pending ?? []).reduce(changed, action.list), pending: null };
    case "unanswered":
      return { ...state, pending: null };
    default:
      return { list: state.list && changed(state.list, action), pending: state.pending && [...state.pending, action] };
  }
}
