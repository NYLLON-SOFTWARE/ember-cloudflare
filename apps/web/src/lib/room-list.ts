import type { Room, RoomId, RoomList } from "@ember/protocol";

// The sidebar's rooms keep the order `GET /api/rooms` gives them: by name, compared as SQLite's
// NOCASE compares it, folding only ASCII letters, then by id.

const folded = (name: string) => name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

const codePoints = (text: string) => Array.from(text, (character) => character.codePointAt(0)!);

/**
 * Compares by code point, as SQLite compares UTF-8. JavaScript's `<` compares UTF-16 units instead,
 * which puts an emoji, a pair of surrogates, before characters such as "Ａ" that come before it.
 */
function compare(a: string, b: string): number {
  const [x, y] = [codePoints(a), codePoints(b)];
  for (let i = 0; i < x.length && i < y.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

const byName = (a: Room, b: Room) => compare(folded(a.name), folded(b.name)) || compare(a.id, b.id);

/** `rooms` with `room` as it is now, added or in place of what it was, in the server's order. */
export function withRoom(rooms: Room[], room: Room): Room[] {
  return [...rooms.filter((r) => r.id !== room.id), room].sort(byName);
}

/**
 * A change made here to the sidebar's rooms, which the server's list shows the next time it's asked: a
 * room saved, or one that's gone for this person, deleted or no longer theirs.
 */
export type RoomChange = { type: "saved"; room: Room } | { type: "gone"; roomId: RoomId };

/** The sidebar's rooms: the server's list, once it arrives, with the changes made here since it was asked for. */
export interface RoomListState {
  list: RoomList | null;
  /** Changes made before the list arrived, which it may not show. */
  pending: RoomChange[];
}

export const NO_ROOM_LIST: RoomListState = { list: null, pending: [] };

const changed = (list: RoomList, change: RoomChange): RoomList => ({
  ...list,
  rooms: change.type === "saved" ? withRoom(list.rooms, change.room) : list.rooms.filter((room) => room.id !== change.roomId),
});

export function roomListReducer(state: RoomListState, action: RoomChange | { type: "loaded"; list: RoomList }): RoomListState {
  if (action.type === "loaded") return { list: state.pending.reduce(changed, action.list), pending: [] };
  return state.list ? { ...state, list: changed(state.list, action) } : { ...state, pending: [...state.pending, action] };
}
