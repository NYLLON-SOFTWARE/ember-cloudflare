import type { Room } from "@ember/protocol";

// The sidebar's rooms keep the order `GET /api/rooms` gives them: by name, compared as SQLite's
// NOCASE compares it, folding only ASCII letters, then by id.

const folded = (name: string) => name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const byName = (a: Room, b: Room) => compare(folded(a.name), folded(b.name)) || compare(a.id, b.id);

/** `rooms` with `room` as it is now, added or in place of what it was, in the server's order. */
export function withRoom(rooms: Room[], room: Room): Room[] {
  return [...rooms.filter((r) => r.id !== room.id), room].sort(byName);
}
