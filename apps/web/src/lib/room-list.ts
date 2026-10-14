import type { Room, RoomId, Sidebar, SidebarRoom } from "@ember/protocol";

// Someone's rooms keep the order `GET /api/sidebar` gives them, the order they were made, which `/` and
// `/rooms` go by. The sidebar lists them by name, as ember-rust's does (membership.rs), compared as
// SQLite's NOCASE compares it, folding only ASCII letters, then by id. Workspace settings list people
// the same way, as ember-rust's `LOWER(name)` does (presenters/accounts.rs).

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

/** Rooms or people in the sidebar's order, by name, each name and id read once rather than at every comparison. */
export function byName<T extends { id: string; name: string }>(named: T[]): T[] {
  return named
    .map((item) => ({ item, name: codePoints(folded(item.name)), id: codePoints(item.id) }))
    .sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id))
    .map(({ item }) => item);
}

/**
 * `rooms` with `room` as it is now, in place of what it was, keeping its mark, or last, as the room made
 * most recently, and read.
 */
export function withRoom(rooms: SidebarRoom[], room: Room): SidebarRoom[] {
  return rooms.some((r) => r.id === room.id)
    ? rooms.map((r) => (r.id === room.id ? { ...room, unread: r.unread } : r))
    : [...rooms, { ...room, unread: false }];
}

/**
 * A change to someone's rooms, which the server's list shows the next time it's asked: a room saved
 * here, one that's gone for this person, deleted or no longer theirs, or a room the workspace socket
 * says has been marked unread or read.
 */
export type RoomChange = { type: "saved"; room: Room } | { type: "gone"; roomId: RoomId } | { type: "marked"; roomId: RoomId; unread: boolean };

/** A change to the list: to someone's rooms, or the join link's new code, made here for the welcome card. */
export type SidebarChange = RoomChange | { type: "join code"; joinCode: string };

/**
 * Someone's rooms: the server's list, once it arrives, with the changes made since it was asked for,
 * which it may not show. Asked for again, it keeps the list it has until the new one arrives. It
 * follows one list on its way at a time, so it's asked for again only once the last has come or failed to.
 */
export interface RoomListState {
  list: Sidebar | null;
  /** While a list is on its way, the changes made since it was asked for, which it may not show; otherwise null. */
  pending: SidebarChange[] | null;
}

export const NO_ROOM_LIST: RoomListState = { list: null, pending: [] };

/** A change, or the list asked for, arriving, or failing to. */
export type RoomListAction = SidebarChange | { type: "asked" } | { type: "loaded"; list: Sidebar } | { type: "unanswered" };

function changed(list: Sidebar, change: SidebarChange): Sidebar {
  switch (change.type) {
    case "saved":
      return { ...list, rooms: withRoom(list.rooms, change.room) };
    case "gone":
      return { ...list, rooms: list.rooms.filter((room) => room.id !== change.roomId) };
    case "marked":
      return { ...list, rooms: list.rooms.map((room) => (room.id === change.roomId ? { ...room, unread: change.unread } : room)) };
    case "join code":
      return { ...list, invitation: list.invitation && { ...list.invitation, joinCode: change.joinCode } };
  }
}

export function roomListReducer(state: RoomListState, action: RoomListAction): RoomListState {
  switch (action.type) {
    case "asked":
      return { ...state, pending: [] };
    case "loaded":
      return { list: (state.pending ?? []).reduce(changed, action.list), pending: null };
    // When the first list fails to arrive, there are no rooms to show, rather than a list loading for good.
    case "unanswered":
      return { list: state.list ?? { rooms: [], invitation: null }, pending: null };
    default:
      return { list: state.list && changed(state.list, action), pending: state.pending && [...state.pending, action] };
  }
}
