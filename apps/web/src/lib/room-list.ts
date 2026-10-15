import type { Favorites, Room, RoomId, Sidebar, SidebarRoom } from "@ember/protocol";

// Someone's rooms keep the order `GET /api/sidebar` gives them, the order they were made, which `/` and
// `/rooms` go by. The sidebar lists the rooms they've starred first, in the order they starred them,
// then the rest by name, as ember-rust's channel_order_controller.js sorts its rows: each name
// lowercased and compared as `localeCompare` compares it, in the browser's language, then by id.

const collator = new Intl.Collator();

const byId = (a: Room, b: Room) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * `rooms` in the sidebar's order, the rooms in `favorites` first, each room's place and name worked out
 * once rather than at every comparison.
 */
export function inSidebarOrder<T extends Room>(rooms: T[], favorites: RoomId[]): T[] {
  const places = new Map(favorites.map((id, place) => [id, place]));
  return (
    rooms
      .map((room) => ({ room, place: places.get(room.id) ?? Infinity, name: room.name.toLowerCase() }))
      // Two rooms that aren't starred are Infinity - Infinity apart, which is NaN, so they go by name.
      .sort((a, b) => a.place - b.place || collator.compare(a.name, b.name) || byId(a.room, b.room))
      .map(({ room }) => room)
  );
}

/**
 * `order` with `roomId` moved to just before `beforeId`, or last when that's null, as
 * channel_order_controller.js moves a starred room's row.
 */
export function movedBefore(order: RoomId[], roomId: RoomId, beforeId: RoomId | null): RoomId[] {
  const others = order.filter((id) => id !== roomId);
  const place = beforeId === null ? -1 : others.indexOf(beforeId);
  return place === -1 ? [...others, roomId] : [...others.slice(0, place), roomId, ...others.slice(place)];
}

/**
 * Whether the sidebar marks `room` unread, as rooms_list_controller.js marks its row: never the room
 * the tab shows, `currentRoomId`, which counts as read while it's open.
 */
export const markedUnread = (room: SidebarRoom, currentRoomId: RoomId | null) => room.unread && room.id !== currentRoomId;

/**
 * `rooms` with `room` as it is now, in place of what it was, keeping its mark, or last and read, as the
 * room made most recently, which a room someone has just been put in counts as until the list loads again.
 */
export function withRoom(rooms: SidebarRoom[], room: Room): SidebarRoom[] {
  return rooms.some((r) => r.id === room.id)
    ? rooms.map((r) => (r.id === room.id ? { ...room, unread: r.unread } : r))
    : [...rooms, { ...room, unread: false }];
}

/**
 * A change to someone's rooms, which the server's list shows the next time it's asked: a room as it was
 * saved, here or anywhere else, one that's gone for this person, deleted or no longer theirs, a room the
 * workspace socket says has been marked unread or read, or their stars, as a star saved in any of their
 * tabs leaves them.
 */
export type RoomChange =
  | { type: "saved"; room: Room }
  | { type: "gone"; roomId: RoomId }
  | { type: "marked"; roomId: RoomId; unread: boolean }
  | { type: "starred"; favorites: Favorites };

/** What the server answers a change to a room with: the room as saved, or gone for this person. */
export type RoomAnswer = Extract<RoomChange, { type: "saved" | "gone" }>;

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
    // A room that's gone takes its star with it, as the server's stars leave out the rooms someone can't
    // star, so an order saved next lists the stars it knows.
    case "gone": {
      const stars = list.favorites.rooms;
      const favorites = stars.includes(change.roomId) ? { ...list.favorites, rooms: stars.filter((id) => id !== change.roomId) } : list.favorites;
      return { ...list, rooms: list.rooms.filter((room) => room.id !== change.roomId), favorites };
    }
    case "marked":
      return { ...list, rooms: list.rooms.map((room) => (room.id === change.roomId ? { ...room, unread: change.unread } : room)) };
    case "join code":
      return { ...list, invitation: list.invitation && { ...list.invitation, joinCode: change.joinCode } };
    // Stars come from a star's answer, the socket and the list itself, in whatever order they arrive,
    // so the newest stands.
    case "starred":
      return change.favorites.version > list.favorites.version ? { ...list, favorites: change.favorites } : list;
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
      return { list: state.list ?? { rooms: [], favorites: { rooms: [], version: 0 }, invitation: null }, pending: null };
    default:
      return { list: state.list && changed(state.list, action), pending: state.pending && [...state.pending, action] };
  }
}
