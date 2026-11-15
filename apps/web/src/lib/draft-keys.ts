import type { Room, RoomId, UserId } from "@ember/protocol";
import { writtenBody } from "@ember/richtext/dom";

// Where the composer keeps each person's drafts in this browser (`draftKey` in composer.tsx), apart from
// lib/drafts.ts, which reads them, so the count Drafts & sent shows loads without it.

/** Where a draft of `userId`'s keys start: `composer-draft-<user id>-`, then the room's id, and `/threads/<id>` for a reply. */
export const draftPrefixOf = (userId: UserId) => `composer-draft-${userId}-`;

/** The room a draft kept under `key`, after `prefix`, was written in. */
const roomOfKey = (key: string, prefix: string): RoomId => key.slice(prefix.length).split("/threads/")[0]!;

/** Whether a draft's markup, `body`, has something written in it, as Drafts & sent lists one. */
export const hasWritten = (body: string) => writtenBody(body).plainText.trim() !== "";

/**
 * How many drafts of `userId`'s this browser keeps that Drafts & sent lists: with something written in
 * them, in one of `rooms`, the ones they're in, or in any room until those have loaded. None when storage
 * can't be reached.
 */
export function draftCountOf(userId: UserId, rooms: readonly Room[] | null): number {
  const prefix = draftPrefixOf(userId);
  const listed = rooms && new Set(rooms.map(({ id }) => id));
  let count = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix) || key.length === prefix.length) continue;
      if (listed && !listed.has(roomOfKey(key, prefix))) continue;
      const body = localStorage.getItem(key);
      if (body !== null && hasWritten(body)) count++;
    }
  } catch {
    // None, then.
  }
  return count;
}

/**
 * The event this tab hears when a draft is kept or forgotten here, as storage's own `storage` event tells
 * only the other tabs.
 */
export const DRAFTS_CHANGED = "ember:drafts-changed";

/** Tells this tab a draft has been kept or forgotten. */
export const tellDraftsChanged = () => void window.dispatchEvent(new Event(DRAFTS_CHANGED));
