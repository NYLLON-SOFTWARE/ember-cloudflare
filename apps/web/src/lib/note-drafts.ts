import { MAX_NOTE_FILES, type NoteFile, type SavedItem, type UserId } from "@ember/protocol";

// To-dos of your own being written: what's typed and attached and not yet saved, kept in this browser,
// as a message's draft is, through a reload or signing out, until it's saved.

/** Where a new to-do's unsaved text is kept in this browser, or a note's being changed, by `userId`. */
export const draftKeyOf = (userId: UserId, itemId?: string) => `${draftPrefixOf(userId)}${itemId === undefined ? "" : `-${itemId}`}`;
const draftPrefixOf = (userId: UserId) => `todo-draft-${userId}`;

/** A draft: its text and files, and the note as of when it was started, which it's a change to. */
export interface Draft {
  /** Its text, or "" for the note's own. */
  html: string;
  files: NoteFile[];
  /** What the note it was written over held, as `baseOf` has it. */
  base: string;
}

/**
 * What a note holds, which a draft of it is a change to: its text and its files, or "" for a new to-do.
 * A reminder, or marking it completed, isn't a change to it.
 */
export const baseOf = (item: SavedItem | undefined) => (item ? JSON.stringify([item.body ?? "", (item.files ?? []).map(({ id }) => id)]) : "");

/** The ids of the files the note a draft was written over held. */
function filesOfBase(base: string): string[] {
  try {
    const [, ids] = JSON.parse(base) as [string, string[]];
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

/** The draft kept at `key`, or null with none, or where storage can't be reached. */
export function readDraft(key: string): Draft | null {
  try {
    const kept = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<Draft> | null;
    const html = typeof kept?.html === "string" ? kept.html : "";
    const files = Array.isArray(kept?.files) ? kept.files : [];
    return html !== "" || files.length > 0 ? { html, files, base: kept?.base ?? "" } : null;
  } catch {
    return null;
  }
}

/** Keeps `draft` at `key`, or forgets the draft there for null. */
export function keepDraft(key: string, draft: Draft | null): void {
  try {
    if (draft) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch {
    // Unkept, then.
  }
}

/** A note's text and files to start from: its draft, if it was written over the note as it is now, or else the note's own. */
export function startingDraft(key: string, item: SavedItem | undefined): { html: string; files: NoteFile[] } {
  const draft = readDraft(key);
  if (draft && draft.base === baseOf(item)) return { html: draft.html || (item?.body ?? ""), files: draft.files };
  // Changed since, here or elsewhere: what's saved now wins over an older draft.
  if (draft) keepDraft(key, null);
  return { html: item?.body ?? "", files: item?.files ?? [] };
}

/**
 * Makes the draft of a note that's gone a new to-do's, after any new to-do's draft already there, saying
 * whether there was one.
 */
export function rescueDraft(from: string, to: string): boolean {
  const draft = readDraft(from);
  if (!draft) return false;
  const existing = readDraft(to);
  // The note's own files went with it, but those added since are still waiting for one.
  const noteFiles = new Set(filesOfBase(draft.base));
  const files = [...(existing?.files ?? []), ...draft.files.filter(({ id }) => !noteFiles.has(id))].slice(0, MAX_NOTE_FILES);
  keepDraft(to, { html: (existing?.html ?? "") + draft.html, files, base: "" });
  keepDraft(from, null);
  return true;
}

/** Forgets `userId`'s drafts of notes that aren't among `ids`, as when they were cleared in another tab, except `open`'s. */
export function forgetDraftsOfGone(userId: UserId, ids: ReadonlySet<string>, open: string | undefined): void {
  const prefix = `${draftPrefixOf(userId)}-`;
  try {
    const gone = Object.keys(localStorage).filter((key) => key.startsWith(prefix) && !ids.has(key.slice(prefix.length)) && key.slice(prefix.length) !== open);
    for (const key of gone) localStorage.removeItem(key);
  } catch {
    // Kept, then.
  }
}
