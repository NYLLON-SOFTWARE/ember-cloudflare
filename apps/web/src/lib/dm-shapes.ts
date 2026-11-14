import type { DirectPreview, RoomId, UserId } from "@ember/protocol";

// How tall each DM's row was when this browser last listed it, so the DMs list draws each row as it will
// be before its message comes, rather than growing or shrinking as it does: none said in it, a line, or
// two. It keeps the shape alone, never what was said.

/** None said in a DM, a line of its latest message, or two. */
export type DirectShape = 0 | 1 | 2;

/** About how much of a message fits a line of a phone's DMs list, past which it takes two. */
const LINE = 38;

const keyOf = (userId: UserId) => `ember:dm-shapes:${userId}`;

/** The shape a DM's preview gives its row. */
export const shapeOf = (preview: DirectPreview): DirectShape => (preview.latest === null ? 0 : preview.latest.plainText.trim().length > LINE ? 2 : 1);

/** The shapes this browser last kept of `userId`'s DMs, by room. */
export function keptShapes(userId: UserId): ReadonlyMap<RoomId, DirectShape> {
  try {
    const kept = JSON.parse(localStorage.getItem(keyOf(userId)) ?? "{}") as Record<RoomId, DirectShape>;
    return new Map(Object.entries(kept).filter(([, shape]) => shape === 0 || shape === 1 || shape === 2));
  } catch {
    return new Map();
  }
}

/** Keeps the shapes `previews` give `userId`'s DMs, in place of those kept before. */
export function keepShapes(userId: UserId, previews: ReadonlyMap<RoomId, DirectPreview>): void {
  try {
    localStorage.setItem(keyOf(userId), JSON.stringify(Object.fromEntries([...previews].map(([roomId, preview]) => [roomId, shapeOf(preview)]))));
  } catch {
    // Not kept, then: rows wait for their messages to know their shape.
  }
}
