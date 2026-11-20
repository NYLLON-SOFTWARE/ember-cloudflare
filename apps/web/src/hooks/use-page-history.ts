import { useSyncExternalStore } from "react";
import { isSearchable, normalizedSearch, searchOfQuery, searchPath, type UserId } from "@ember/protocol";
import { HUDDLES_PATH, personPath, roomPath, threadPath, type Route } from "./use-route";

// The pages this browser has shown someone lately, newest first, for the top bar's History, as Slack's
// lists the places its window showed. Each person's are kept apart, as their drafts are, so whoever signs
// in here next doesn't see where they went, and every tab of the browser adds to the one list.

/** How many pages History keeps. */
export const HISTORY_KEPT = 20;

/** A page History lists: its address, and when it was last shown, in milliseconds since 1970. */
export interface Visit {
  address: string;
  at: number;
}

const keyOf = (userId: UserId) => `ember:history:${userId}`;

/**
 * The address History keeps for a page: a room's or a DM's, a thread's, a search's, someone's page, or
 * Huddles. A permalink keeps its room's, or its thread's, and a search drops its order, so each place is
 * listed once. Null for the pages it leaves out: settings, an empty search, and those that go on to another.
 */
export function historyAddressOf(route: Route, query: string): string | null {
  switch (route.page) {
    case "room":
      return route.threadId === undefined ? roomPath(route.roomId) : threadPath(route.roomId, route.threadId);
    case "person":
      return personPath(route.userId);
    case "search": {
      const { search } = searchOfQuery(new URLSearchParams(query));
      return isSearchable(search) ? searchPath(normalizedSearch(search)) : null;
    }
    case "huddles":
      return HUDDLES_PATH;
    default:
      return null;
  }
}

/** `visits` with `address` first, shown `at`, and no older visit to it, keeping the newest `HISTORY_KEPT`. */
export function withVisit(visits: readonly Visit[], address: string, at: number): Visit[] {
  return [{ address, at }, ...visits.filter((visit) => visit.address !== address)].slice(0, HISTORY_KEPT);
}

const isVisit = (value: unknown): value is Visit =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Visit).address === "string" &&
  (value as Visit).address.startsWith("/") &&
  Number.isFinite((value as Visit).at);

/** The visits kept under `key`, or null when storage is refused, as in some private windows. */
function stored(key: string): readonly Visit[] | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter(isVisit).slice(0, HISTORY_KEPT) : [];
  } catch (error) {
    return error instanceof SyntaxError ? [] : null;
  }
}

const listeners = new Set<() => void>();
// The lists last read or recorded, by key, while History listens for what other tabs record. They hold
// what storage can't: everything where it's refused, and what this tab showed after it filled up.
const lists = new Map<string, readonly Visit[]>();

function visitsOf(key: string): readonly Visit[] {
  let visits = lists.get(key);
  if (visits === undefined) lists.set(key, (visits = stored(key) ?? []));
  return visits;
}

const tell = () => listeners.forEach((listener) => listener());

function heard(event: StorageEvent) {
  // A null key is storage cleared.
  if (event.key === null) lists.clear();
  else if (!lists.delete(event.key)) return;
  tell();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", heard);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.removeEventListener("storage", heard);
    // Unheard, other tabs' visits would be missed, so the lists are read from storage again next time.
    lists.clear();
  };
}

/** Lists `address` first in `userId`'s History, shown `at`, over what any tab has listed since. */
export function recordVisit(userId: UserId, address: string, at = Date.now()): void {
  const key = keyOf(userId);
  const visits = withVisit(visitsOf(key), address, at);
  lists.set(key, visits);
  try {
    localStorage.setItem(key, JSON.stringify(visits));
  } catch {
    // Storage can be refused, or full, and then History goes on with what this tab showed.
  }
  tell();
}

/** The pages `userId`'s History lists, newest first, as every tab of the browser records them. */
export function usePageHistory(userId: UserId): readonly Visit[] {
  return useSyncExternalStore(subscribe, () => visitsOf(keyOf(userId)));
}
