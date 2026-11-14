import type { Room, RoomId } from "@ember/protocol";

// The last room this browser showed, for `/` and Go Back to return to, as Campfire keeps it in a
// permanent `last_room` cookie (TrackedRoomVisit). Like the cookie, it's the browser's, whoever signs
// in, and only a room they're in counts.

const KEY = "ember:last-room";

function storedLastRoom(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Remembers the room shown, writing only when it changes. */
export function rememberLastRoom(roomId: RoomId): void {
  try {
    if (localStorage.getItem(KEY) !== roomId) localStorage.setItem(KEY, roomId);
  } catch {
    // Storage can be refused, and then `/` goes to the oldest room.
  }
}

/** Where the last room shown that wasn't a DM is kept, for Home, which lists no DMs, to return to. */
const CHANNEL_KEY = "ember:last-channel";

/** Remembers the room shown, when it isn't a DM, writing only when it changes. */
export function rememberLastChannel(roomId: RoomId): void {
  try {
    if (localStorage.getItem(CHANNEL_KEY) !== roomId) localStorage.setItem(CHANNEL_KEY, roomId);
  } catch {
    // Storage can be refused, and then Home goes to the oldest room.
  }
}

/**
 * The room Home goes to: the last room shown that isn't a DM, while it's one of `rooms`, or else the
 * last room visited, if it isn't a DM, or else the oldest room that isn't one. Null when there are none.
 */
export function lastChannelVisited(rooms: Room[]): Room | null {
  const channels = rooms.filter((room) => room.kind !== "direct");
  let lastChannelId: string | null = null;
  try {
    lastChannelId = localStorage.getItem(CHANNEL_KEY);
  } catch {
    // None, then.
  }
  return channels.find((room) => room.id === lastChannelId) ?? lastRoomVisited(channels);
}

/**
 * The last room visited, as Campfire's `last_room_visited` finds it: the last room shown, while it's one
 * of `rooms`, or else the oldest of them, since they come in the order they were made. Null when there
 * are none.
 */
export function lastRoomVisited(rooms: Room[]): Room | null {
  const lastRoomId = storedLastRoom();
  return rooms.find((room) => room.id === lastRoomId) ?? rooms[0] ?? null;
}
