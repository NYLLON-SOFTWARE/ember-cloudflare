import type { UserId } from "@ember/protocol";

// Where the composer keeps each person's drafts in this browser (`draftKey` in composer.tsx), apart from
// lib/drafts.ts, which reads them, so the count Drafts & sent shows loads without it.

/** Where a draft of `userId`'s keys start: `composer-draft-<user id>-`, then the room's id, and `/threads/<id>` for a reply. */
export const draftPrefixOf = (userId: UserId) => `composer-draft-${userId}-`;

/** How many drafts of `userId`'s this browser keeps with something written in them, or none when storage can't be reached. */
export function draftCountOf(userId: UserId): number {
  const prefix = draftPrefixOf(userId);
  let count = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix) && key.length > prefix.length && localStorage.getItem(key)?.trim()) count++;
    }
  } catch {
    // None, then.
  }
  return count;
}
