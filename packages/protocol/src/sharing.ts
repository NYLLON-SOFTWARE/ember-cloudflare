import type { RoomId } from "./index.ts";
import { MAX_ID_LENGTH } from "./pages.ts";

// Sharing what's in one room in another, as Files in Ember and Forward do: before it goes, the app asks
// whether it would reach people who can't see the room it's from, to warn first, as Slack does.

/** Where the app asks whether sharing from one room in another widens who sees it. */
export const SHARE_CHECK_PATH = "/api/share-check";

/** What the app asks: whether sharing from `sourceRoomId` in `targetRoomId` reaches anyone new. */
export interface ShareCheck {
  sourceRoomId: RoomId;
  targetRoomId: RoomId;
}

/**
 * The answer: whether anyone in the target room can't see the source room, how many, counted from who's
 * in each, and the names of up to `NAMED_NEW_VIEWERS` of them, by name, for the warning to say who'll see it,
 * who are in the target room, which the asker is in, so nothing about the source room's people. A room open
 * to everyone widens nothing.
 */
export interface ShareWidening {
  widens: boolean;
  newViewers: number;
  names: string[];
}

/**
 * Whether sharing as `now` would reach anyone the warning didn't name or count as it was answered, `accepted`,
 * or anyone at all where it wasn't asked: more people, or someone else in place of one it named.
 */
export function reachesMore(now: ShareWidening, accepted?: ShareWidening): boolean {
  if (!now.widens) return false;
  if (!accepted) return true;
  return now.newViewers > accepted.newViewers || now.names.some((name) => !accepted.names.includes(name));
}

/** How many of the people sharing would reach the warning names, beyond which it counts them. */
export const NAMED_NEW_VIEWERS = 3;

/** Parses an untrusted `ShareCheck`, or returns why it's refused. */
export function parseShareCheck(data: unknown): ShareCheck | string {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "Expected a JSON object";
  const { sourceRoomId, targetRoomId } = data as Record<string, unknown>;
  const isId = (id: unknown): id is RoomId => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH;
  if (!isId(sourceRoomId) || !isId(targetRoomId)) return "A share check needs the room it's from and the room it's to";
  return { sourceRoomId, targetRoomId };
}
