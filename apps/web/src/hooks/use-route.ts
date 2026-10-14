import { useMemo, useSyncExternalStore } from "react";
import { KIND_SEGMENTS, workspacePageOf, type RoomAccess, type RoomId, type RoomKind, type WorkspacePage } from "@ember/protocol";

// The app's few pages, at ember-rust's addresses, which @ember/protocol lists for the Worker too: a
// small typed router over the History API rather than a library. A page with changes to lose can
// hold the app on it, as ember-rust's settings.js holds Turbo, by guarding against leaving.

export { WORKSPACE_SETTINGS_PATH } from "@ember/protocol";

/** Whether a room's form makes it open to everyone or private, as the form's address says. */
export type Access = RoomAccess;

/** What a signed-in page shows. */
export type Route = WorkspacePage;

export const roomPath = (roomId: RoomId) => `/rooms/${encodeURIComponent(roomId)}`;
export const newRoomPath = (access: Access) => `/rooms/${KIND_SEGMENTS[access]}/new`;
/** A room's settings page, at the address for its kind, as ember-rust's `edit_path` gives it. */
export const roomSettingsPath = (kind: RoomKind, roomId: RoomId) => `/rooms/${KIND_SEGMENTS[kind]}/${encodeURIComponent(roomId)}/edit`;

/**
 * Asked before the app leaves the page shown, with the path it's going to, or null for leaving the app,
 * as signing out does. It answers true to hold the app on the page, and then calls `proceed` if the
 * person decides to go after all, which for leaving the app settles with whether it left.
 */
export type LeaveGuard = (path: string | null, proceed: () => unknown) => boolean;

let guard: LeaveGuard | null = null;

/** Has `leaveGuard` asked before the app leaves the page shown, until the function returned is called. */
export function guardLeaving(leaveGuard: LeaveGuard): () => void {
  guard = leaveGuard;
  return () => {
    if (guard === leaveGuard) guard = null;
  };
}

/**
 * Leaves the app with `go`, as signing out does, once the page's guard lets it. `go` settles with
 * whether the app left, since signing out can fail and leave the page as it was.
 */
export function leave(go: () => Promise<boolean>): void {
  if (!guard?.(null, go)) void go();
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const notify = () => listeners.forEach((listener) => listener());

/** The number the app gave a history entry, or null for one it didn't number. */
function positionOf(state: unknown): number | null {
  const position = (state as { position?: unknown } | null)?.position;
  return typeof position === "number" ? position : null;
}

// Each entry the app adds to this tab's history is numbered one past the entry it follows, so the
// distance Back or Forward went is known, and the guard can go back by it, as ember-rust reads Turbo's
// restorationIndex. The browser keeps the numbers through a reload.
let position = positionOf(history.state) ?? 0;
history.replaceState({ ...history.state, position }, "");

// While the guard turns Back or Forward around, the address briefly names where the person was going,
// and the app goes on showing the page it was on.
let turningBack = false;
let shown = location.pathname;

/** The path of the page the app shows. */
function shownPath(): string {
  if (!turningBack) shown = location.pathname;
  return shown;
}

// Each page asked for is numbered, so what's to follow the last one asked for runs only if the app goes
// there: not while the page's guard holds it, nor if the person stays or another page is asked for.
let asked = 0;
let gone = 0;
let followUp: (() => void) | null = null;

// The guard's own trips through the history: back to the page it holds, which changes nothing the app
// shows, and on again once the person decides to go.
let returning = false;
let proceeding = false;

window.addEventListener("popstate", (event) => {
  if (returning) {
    returning = false;
    turningBack = false;
    return;
  }
  const next = positionOf(event.state);
  const distance = next === null ? 0 : next - position;
  const proceed = () => {
    proceeding = true;
    history.go(distance);
  };
  if (!proceeding && distance !== 0 && guard?.(location.pathname, proceed)) {
    turningBack = true;
    returning = true;
    history.go(-distance);
    return;
  }
  proceeding = false;
  if (next !== null) position = next;
  followUp = null;
  notify();
});

/**
 * Shows `path`, as a new entry in the browser's history unless `replace` says to take the current one's
 * place, once the page's guard lets it.
 */
export function navigate(path: string, { replace = false } = {}): void {
  const navigation = ++asked;
  followUp = null;
  if (shownPath() === path) {
    gone = navigation;
    return;
  }
  const go = () => {
    if (replace) history.replaceState({ position }, "", path);
    else history.pushState({ position: ++position }, "", path);
    gone = navigation;
    if (navigation === asked) {
      followUp?.();
      followUp = null;
    }
    notify();
  };
  if (!guard?.(path, go)) go();
}

/**
 * Calls `then` once the app shows the page `navigate` was last asked for: now, if it does already, or
 * when the page's guard lets it go there, but never if the person stays or another page is asked for.
 */
export function afterNavigating(then: () => void): void {
  if (gone === asked) then();
  else followUp = then;
}

/** The room id in a /rooms/:id path, or null. */
export function roomIdFromPath(pathname: string): string | null {
  const route = workspacePageOf(pathname);
  return route?.page === "room" ? route.roomId : null;
}

/**
 * The page a signed-in path shows. The Worker answers 404 for a path that names none, so home stands
 * in only at the join and setup pages, which someone signed in leaves for home, and under Vite's dev
 * server, which serves the app at every path.
 */
export const routeOf = (pathname: string): Route => workspacePageOf(pathname) ?? { page: "home" };

/** The page the address shows, re-rendering when it changes. */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, shownPath);
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
  return joinCodeFromPath(useSyncExternalStore(subscribe, shownPath));
}

/** Whether the address is `path`, re-rendering only when that changes. */
export function useIsAt(path: string): boolean {
  return useSyncExternalStore(subscribe, () => shownPath() === path);
}
