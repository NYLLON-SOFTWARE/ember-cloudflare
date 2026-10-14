import { useMemo, useSyncExternalStore } from "react";
import type { RoomId, RoomKind } from "@ember/protocol";

// The app's few pages, at ember-rust's addresses (crates/ember/src/controllers.rs): a small typed
// router over the History API rather than a library.

/** Whether a room's form makes it open to everyone or private, as the form's address says. */
export type Access = Exclude<RoomKind, "direct">;

/** What a signed-in page shows. */
export type Route =
  /** A room, or with no id, as at /, the first room. */
  | { page: "room"; roomId: RoomId | null }
  | { page: "new-room"; access: Access }
  | { page: "room-settings"; access: Access; roomId: RoomId }
  | { page: "workspace-settings" };

/** Rails' names for each kind of room's controller, which ember-rust's addresses keep. */
const KIND_SEGMENTS = { open: "opens", closed: "closeds", direct: "directs" } as const satisfies Record<RoomKind, string>;

export const roomPath = (roomId: RoomId) => `/rooms/${encodeURIComponent(roomId)}`;
export const newRoomPath = (access: Access) => `/rooms/${KIND_SEGMENTS[access]}/new`;
/** A room's settings page, at the address for its kind, as ember-rust's `edit_path` gives it. */
export const roomSettingsPath = (kind: RoomKind, roomId: RoomId) => `/rooms/${KIND_SEGMENTS[kind]}/${encodeURIComponent(roomId)}/edit`;
export const WORKSPACE_SETTINGS_PATH = "/account/edit";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

/** Shows `path`, as a new entry in the browser's history unless `replace` says to take the current one's place. */
export function navigate(path: string, { replace = false } = {}): void {
  if (location.pathname === path) return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  listeners.forEach((listener) => listener());
}

/** A path segment as text, or null for a malformed escape, which names nothing. */
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The room id in a /rooms/:id path, or null. */
export function roomIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/rooms\/([^/]+)$/);
  // A malformed escape names no room, so the workspace falls back to the first one.
  return match ? decoded(match[1]!) : null;
}

const accessOf = (segment: string): Access => (segment === KIND_SEGMENTS.open ? "open" : "closed");

/** The page a signed-in path shows: anything it doesn't name shows the first room. */
export function routeOf(pathname: string): Route {
  if (pathname === WORKSPACE_SETTINGS_PATH) return { page: "workspace-settings" };
  const newRoom = pathname.match(/^\/rooms\/(opens|closeds)\/new$/);
  if (newRoom) return { page: "new-room", access: accessOf(newRoom[1]!) };
  const settings = pathname.match(/^\/rooms\/(opens|closeds)\/([^/]+)\/edit$/);
  const settingsRoomId = settings && decoded(settings[2]!);
  if (settingsRoomId) return { page: "room-settings", access: accessOf(settings[1]!), roomId: settingsRoomId };
  return { page: "room", roomId: roomIdFromPath(pathname) };
}

/** The page the address shows, re-rendering when it changes. */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => location.pathname);
  return useMemo(() => routeOf(pathname), [pathname]);
}

/**
 * The join code in a join link's path, `/join/<code>`, or null. It's the path's own segment, as the
 * Worker matched it before serving the page: codes are letters, digits and dashes, which nothing escapes.
 */
export function joinCodeFromPath(pathname: string): string | null {
  return pathname.match(/^\/join\/([^/]+)$/)?.[1] ?? null;
}

export function useJoinRoute(): string | null {
  return joinCodeFromPath(useSyncExternalStore(subscribe, () => location.pathname));
}

/** Whether the address is `path`, re-rendering only when that changes. */
export function useIsAt(path: string): boolean {
  return useSyncExternalStore(subscribe, () => location.pathname === path);
}
