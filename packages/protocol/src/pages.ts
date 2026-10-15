import type { RoomId, RoomKind, UserId } from "./index.ts";

// The app's pages, at ember-rust's addresses (crates/ember/src/controllers.rs). The app's router reads
// a path with `workspacePageOf`, and the Worker serves the app only where `isAppPage` says it shows a
// page, so any other path answers 404 with Campfire's page, as ember-rust's router does.

/** Whether a room's form makes it open to everyone or private, as the form's address says. */
export type RoomAccess = Exclude<RoomKind, "direct">;

/** What a signed-in page shows. */
export type WorkspacePage =
  /** `/`: the last room visited, or a page saying there are no rooms yet. */
  | { page: "home" }
  /** `/rooms`: the room made most recently. */
  | { page: "newest-room" }
  /** A room, at `/rooms/<id>`, or at one of its messages' permalinks, `/rooms/<id>/@<message id>`. */
  | { page: "room"; roomId: RoomId }
  /** A room at the address for a kind of room, such as `/rooms/opens/<id>`, which goes on to the room's own. */
  | { page: "room-of-kind"; kind: RoomKind; roomId: RoomId }
  | { page: "new-room"; access: RoomAccess }
  | { page: "room-settings"; access: RoomAccess; roomId: RoomId }
  /** New direct message, at `/rooms/directs/new`, which opens over the last room visited. */
  | { page: "new-direct" }
  /** A DM's settings, at `/rooms/directs/<id>/edit`: its members, and Delete. */
  | { page: "direct-settings"; roomId: RoomId }
  | { page: "workspace-settings" }
  /** The Custom CSS page, which only administrators may open. */
  | { page: "custom-styles" }
  /** Your profile, at `/users/me/profile`, or at any other person's id in its place, as ember-rust ignores it. */
  | { page: "profile" }
  /** Someone's page, at `/users/<id>`, whatever their status. */
  | { page: "person"; userId: UserId };

/** Rails' names for each kind of room's controller, which ember-rust's addresses keep. */
export const KIND_SEGMENTS = { open: "opens", closed: "closeds", direct: "directs" } as const satisfies Record<RoomKind, string>;

const SIGN_IN_PATH = "/session/new";
export const WORKSPACE_SETTINGS_PATH = "/account/edit";
export const CUSTOM_STYLES_PATH = "/account/custom_styles/edit";
export const NEW_DIRECT_PATH = "/rooms/directs/new";
export const PROFILE_PATH = "/users/me/profile";

/** A path segment as text, or null for a malformed escape, which names nothing. */
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

const accessOf = (segment: string): RoomAccess => (segment === KIND_SEGMENTS.open ? "open" : "closed");

const kindOf = (segment: string): RoomKind => (segment === KIND_SEGMENTS.direct ? "direct" : accessOf(segment));

/** The page a signed-in path shows, or null for a path that names none. */
export function workspacePageOf(pathname: string): WorkspacePage | null {
  if (pathname === "/") return { page: "home" };
  if (pathname === NEW_DIRECT_PATH) return { page: "new-direct" };
  if (pathname === WORKSPACE_SETTINGS_PATH) return { page: "workspace-settings" };
  if (pathname === CUSTOM_STYLES_PATH) return { page: "custom-styles" };
  if (/^\/users\/[^/]+\/profile$/.test(pathname)) return { page: "profile" };
  const person = pathname.match(/^\/users\/([^/]+)$/);
  const personId = person && decoded(person[1]!);
  if (personId) return { page: "person", userId: personId };
  if (pathname === "/rooms") return { page: "newest-room" };
  const newRoom = pathname.match(/^\/rooms\/(opens|closeds)\/new$/);
  if (newRoom) return { page: "new-room", access: accessOf(newRoom[1]!) };
  const settings = pathname.match(/^\/rooms\/(opens|closeds)\/([^/]+)\/edit$/);
  const settingsRoomId = settings && decoded(settings[2]!);
  if (settingsRoomId) return { page: "room-settings", access: accessOf(settings[1]!), roomId: settingsRoomId };
  const directSettings = pathname.match(/^\/rooms\/directs\/([^/]+)\/edit$/);
  const directSettingsRoomId = directSettings && decoded(directSettings[1]!);
  if (directSettingsRoomId) return { page: "direct-settings", roomId: directSettingsRoomId };
  const ofKind = pathname.match(/^\/rooms\/(opens|closeds|directs)\/([^/]+)$/);
  const ofKindRoomId = ofKind && decoded(ofKind[2]!);
  if (ofKindRoomId) return { page: "room-of-kind", kind: kindOf(ofKind[1]!), roomId: ofKindRoomId };
  // ember-rust matches /rooms/new, one of Rails' unused resource actions, before /rooms/<id>, and
  // answers 404 for it.
  const room = pathname.match(/^\/rooms\/([^/]+)(?:\/@[^/]+)?$/);
  const roomId = room && room[1] !== "new" && decoded(room[1]!);
  return roomId ? { page: "room", roomId } : null;
}

/**
 * Whether the app shows a page at `pathname`: sign-in, or one of the workspace's. The Worker answers
 * setup's and the join link's addresses itself.
 */
export const isAppPage = (pathname: string) => pathname === SIGN_IN_PATH || workspacePageOf(pathname) !== null;

/**
 * A sign-in link's address, as ember-rust's `session_transfer` route has it: opening it signs whoever
 * does in as the person it was made for, until it expires.
 */
export const transferPath = (transferId: string) => `/session/transfers/${transferId}`;

/**
 * The id in a sign-in link's path, `/session/transfers/<id>`, or null if `pathname` isn't one. Ids are
 * letters, digits, dots, dashes and underscores, which nothing escapes, so the path holds them as they are.
 */
export const transferIdFromPath = (pathname: string) => pathname.match(/^\/session\/transfers\/([^/]+)$/)?.[1] ?? null;
