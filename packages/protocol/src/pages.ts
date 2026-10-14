import type { RoomId, RoomKind } from "./index.ts";

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
  /** A room, at `/rooms/<id>`. */
  | { page: "room"; roomId: RoomId }
  /** A room at the address for a kind of room, such as `/rooms/opens/<id>`, which goes on to the room's own. */
  | { page: "room-of-kind"; kind: RoomKind; roomId: RoomId }
  | { page: "new-room"; access: RoomAccess }
  | { page: "room-settings"; access: RoomAccess; roomId: RoomId }
  | { page: "workspace-settings" };

/** Rails' names for each kind of room's controller, which ember-rust's addresses keep. */
export const KIND_SEGMENTS = { open: "opens", closed: "closeds", direct: "directs" } as const satisfies Record<RoomKind, string>;

const SIGN_IN_PATH = "/session/new";
export const WORKSPACE_SETTINGS_PATH = "/account/edit";

/**
 * Pages the app links to before it has them, which go home until they come: the installed app's My
 * profile shortcut (`users.profile`), New direct message (`dms.picker`) and a direct message's
 * settings (`dms.naming`).
 */
const PAGES_TO_COME = [/^\/users\/me\/profile$/, /^\/rooms\/directs\/new$/, /^\/rooms\/directs\/[^/]+\/edit$/];

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
  if (pathname === "/" || PAGES_TO_COME.some((page) => page.test(pathname))) return { page: "home" };
  if (pathname === WORKSPACE_SETTINGS_PATH) return { page: "workspace-settings" };
  if (pathname === "/rooms") return { page: "newest-room" };
  const newRoom = pathname.match(/^\/rooms\/(opens|closeds)\/new$/);
  if (newRoom) return { page: "new-room", access: accessOf(newRoom[1]!) };
  const settings = pathname.match(/^\/rooms\/(opens|closeds)\/([^/]+)\/edit$/);
  const settingsRoomId = settings && decoded(settings[2]!);
  if (settingsRoomId) return { page: "room-settings", access: accessOf(settings[1]!), roomId: settingsRoomId };
  const ofKind = pathname.match(/^\/rooms\/(opens|closeds|directs)\/([^/]+)$/);
  const ofKindRoomId = ofKind && decoded(ofKind[2]!);
  if (ofKindRoomId) return { page: "room-of-kind", kind: kindOf(ofKind[1]!), roomId: ofKindRoomId };
  // ember-rust matches /rooms/new, one of Rails' unused resource actions, before /rooms/<id>, and
  // answers 404 for it.
  const room = pathname.match(/^\/rooms\/([^/]+)$/);
  const roomId = room && room[1] !== "new" && decoded(room[1]!);
  return roomId ? { page: "room", roomId } : null;
}

/**
 * Whether the app shows a page at `pathname`: sign-in, or one of the workspace's. The Worker answers
 * setup's and the join link's addresses itself.
 */
export const isAppPage = (pathname: string) => pathname === SIGN_IN_PATH || workspacePageOf(pathname) !== null;
