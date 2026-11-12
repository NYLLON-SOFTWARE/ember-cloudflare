import { useSyncExternalStore } from "react";
import type { NewSavedItem, SavedItem, SavedList, SavedMark } from "@ember/protocol";
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

export async function clearItem(id: string): Promise<void> {
  const response = await fetch(`/api/saved/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) await dataOf(response);
}

/** What you keep, by message, and a count of the changes heard, which lists' pages load again on. */
interface SavedState {
  marks: Map<string, SavedMark>;
  version: number;
}

let state: SavedState = { marks: new Map(), version: 0 };
const listeners = new Set<() => void>();

function publish(next: SavedState) {
  state = next;
  for (const listener of listeners) listener();
}

/** Takes what the Workspace says you keep now, from this tab or another. */
export function heardSaved(marks: SavedMark[]): void {
  publish({ marks: new Map(marks.map((mark) => [mark.messageId, mark])), version: state.version + 1 });
}

/** Loads what you keep afresh, as a workspace socket that has just connected may have missed a change. */
export async function reloadSaved(): Promise<void> {
  const { marks } = await dataOf<{ marks: SavedMark[] }>(await fetch("/api/saved/marks"));
  heardSaved(marks);
}

/** Forgets what the last person signed in kept. */
export function forgetSaved(): void {
  publish({ marks: new Map(), version: state.version + 1 });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Where `messageId` is kept, if it is. */
export function useSavedMark(messageId: string): SavedMark | undefined {
  return useSyncExternalStore(subscribe, () => state.marks.get(messageId));
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
