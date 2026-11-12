import type { RoomId, UserId } from "@ember/protocol";
import { draftPrefixOf as prefixOf, tellDraftsChanged } from "./draft-keys";

// The drafts the composer keeps in this browser for each person, of what they've written in a room, or
// in one of its threads, and not sent (`draftKey` in composer.tsx), for Drafts & sent to list.

/** What someone has written in a room, or one of its threads, and not sent, as markup. */
export interface Draft {
  /** Where the composer keeps it. */
  key: string;
  roomId: RoomId;
  /** The thread it's a reply in, or undefined for one in the room. */
  threadId?: string;
  body: string;
}


/** The draft kept under `key` with `body`, if it's `userId`'s and has something written in it. */
export function draftOf(userId: UserId, key: string, body: string | null): Draft | null {
  const prefix = prefixOf(userId);
  if (!key.startsWith(prefix) || body === null || body.trim() === "") return null;
  const [roomId, threadId] = key.slice(prefix.length).split("/threads/");
  if (!roomId) return null;
  return threadId ? { key, roomId, threadId, body } : { key, roomId, body };
}

/** Every draft of `userId`'s this browser keeps, in the order storage lists them. Storage can be unavailable, and then there are none. */
export function draftsOf(userId: UserId): Draft[] {
  try {
    const drafts: Draft[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const draft = key === null ? null : draftOf(userId, key, localStorage.getItem(key));
      if (draft) drafts.push(draft);
    }
    return drafts;
  } catch {
    return [];
  }
}

/** Forgets a draft, as sending it would. */
export function discardDraft(draft: Draft): void {
  try {
    localStorage.removeItem(draft.key);
    tellDraftsChanged();
  } catch {
    // Storage that can't be reached holds nothing to forget.
  }
}
