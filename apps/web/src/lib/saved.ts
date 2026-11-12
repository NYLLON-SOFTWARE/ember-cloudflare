import { useSyncExternalStore } from "react";
import type { NewSavedItem, SavedItem, SavedList, SavedMark, SavedMarks } from "@ember/protocol";
import { ApiError } from "./api";

// To-dos and Saved: the requests that read and change your lists, and what you keep, which each
// message's actions read to say Add or Remove. Every tab hears what changes (`saved.changed`), which
// `heardSaved` takes, and the lists' pages load again.

export async function dataOf<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`);
  return data;
}

export const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function keepItem(item: NewSavedItem): Promise<SavedItem> {
  return dataOf<SavedItem>(await fetch("/api/saved", json("POST", item)));
}

/** Clears item `id`, which another tab may have cleared already, which is as good. */
export async function clearItem(id: string): Promise<void> {
  const response = await fetch(`/api/saved/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) await dataOf(response);
}

/** How many to-dos are in progress, how many of those are overdue, and how many items are saved. */
export type KeptCounts = Omit<SavedMarks, "marks">;

const NO_COUNTS: KeptCounts = { openTodos: 0, overdueTodos: 0, savedItems: 0 };

/** What you keep, by message, the lists' counts, and a count of the changes heard, which lists' pages load again on. */
interface SavedState {
  marks: Map<string, SavedMark>;
  counts: KeptCounts;
  version: number;
}

let state: SavedState = { marks: new Map(), counts: NO_COUNTS, version: 0 };
const listeners = new Set<() => void>();

function publish(next: SavedState) {
  state = next;
  for (const listener of listeners) listener();
}

/** Takes what the Workspace says you keep now, from this tab or another. */
export function heardSaved({ marks, ...counts }: SavedMarks): void {
  publish({ marks: new Map(marks.map((mark) => [mark.messageId, mark])), counts, version: state.version + 1 });
}

/** Loads what you keep afresh, as a workspace socket that has just connected may have missed a change. */
export async function reloadSaved(): Promise<void> {
  heardSaved(await dataOf<SavedMarks>(await fetch("/api/saved/marks")));
}

/** Forgets what the last person signed in kept. */
export function forgetSaved(): void {
  publish({ marks: new Map(), counts: NO_COUNTS, version: state.version + 1 });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Where `messageId` is kept, if it is. */
export function useSavedMark(messageId: string): SavedMark | undefined {
  return useSyncExternalStore(subscribe, () => state.marks.get(messageId));
}

/** How many to-dos are in progress and overdue, and how many items are saved, for the cards that link to their pages. */
export function useKeptCounts(): KeptCounts {
  return useSyncExternalStore(subscribe, () => state.counts);
}

/** How many times what you keep has changed, which a list's page loads again on. */
export function useSavedVersion(): number {
  return useSyncExternalStore(subscribe, () => state.version);
}

/**
 * Keeps message `messageId` of `roomId` in `list`, or takes it out if it's there already, as the
 * message's Add to to-dos and Save do, marking it at once rather than waiting to hear back.
 */
export async function toggleKept(list: SavedList, roomId: string, messageId: string): Promise<void> {
  const mark = state.marks.get(messageId);
  if (mark?.list === list) {
    const marks = new Map(state.marks);
    marks.delete(messageId);
    publish({ ...state, marks });
    try {
      await clearItem(mark.id);
    } catch (error) {
      void reloadSaved().catch(() => {});
      throw error;
    }
    return;
  }
  const item = await keepItem({ list, roomId, messageId });
  publish({ ...state, marks: new Map(state.marks).set(messageId, { id: item.id, list, messageId }) });
}
