import {
  NOTIFICATIONS_API_PATH,
  NOTIFICATIONS_RESET_API_PATH,
  roomSocketQuery,
  WORKSPACE_PRELOADS,
  type ActivityMarks,
  type ActivityPage,
  type Bootstrap,
  type DirectRoom,
  type Directory,
  type Favorites,
  type Involvement,
  type NotificationChanges,
  type NotificationSettings,
  type LinkPreview,
  type LinkSignIn,
  type Me,
  type MemberfulConnection,
  type NewDirect,
  type PasswordSignIn,
  type PersonAnswer,
  type PushSubscriptionKeys,
  type PushSubscriptionSave,
  type ReleaseCheck,
  type Room,
  type RoomId,
  type RoomSettings,
  type RoomSocketParams,
  type ShareWidening,
  type Sidebar,
  type SignOut,
  type StartedDirect,
  type UserId,
  SHARE_CHECK_PATH,
} from "@ember/protocol";
import type { LogoVariants } from "@/lib/previews";

// The session lives in an HttpOnly cookie, which the browser sends with every request and socket,
// so nothing here handles a token.

export type { Room, Sidebar };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The form field the error is about, when it's about one. */
    readonly field?: string,
    /** The page to go to instead, when the server names one. */
    readonly redirect?: string,
    /** Whether an app's server refused for want of a sign-in, which Ember can begin. */
    readonly signIn?: boolean,
    /** Whether an app's sign-in wants a client ID that Ember can't get itself, which the app's form then asks for. */
    readonly client?: boolean,
  ) {
    super(message);
  }
}

/** Whether `error` says this browser's session has ended, which matters whatever page is showing. */
export const isSignedOut = (error: unknown) => error instanceof ApiError && error.status === 401;

/** What an answer carries, or the ApiError it says why it failed with. */
async function dataOf<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; field?: string; redirect?: string; signIn?: unknown; client?: unknown };
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`, data.field, data.redirect, data.signIn === true || undefined, data.client === true || undefined);
  }
  return data;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // A form says its own type, with the boundary between its parts.
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  return dataOf<T>(await fetch(path, { ...init, headers }));
}

/** A photo chosen for an avatar, with the variant made of it, or null where none could be made (`avatarVariantOf`). */
export interface ChosenPhoto {
  file: File;
  variant: Blob | null;
}

/** Whether Ember is set up yet, and who this browser is signed in as. */
export async function fetchBootstrap(): Promise<Bootstrap> {
  return request<Bootstrap>("/api/bootstrap");
}

/**
 * Takes what the page preloaded of the workspace (`WORKSPACE_PRELOADS`) and drops it, once the page
 * finds that the session its cookie named has ended, so that what was preloaded only says so. A request
 * takes a preloaded answer once, so otherwise the workspace's first, once someone signs in on this page,
 * would take those and go straight back to sign in.
 */
export function dropWorkspacePreloads(): void {
  for (const path of WORKSPACE_PRELOADS) void fetch(path).then((response) => response.body?.cancel(), () => {});
}

/**
 * Signs in with an email address and password: who signed in, or, for a member whose password checks out
 * while Memberful is members only, until they've connected their Memberful account, where to connect it,
 * which signs them in and opens the page `credentials.returnTo` names.
 */
export async function signIn(credentials: PasswordSignIn): Promise<Me | MemberfulConnection> {
  const answer = await request<{ user: Me } | MemberfulConnection>("/api/session", { method: "POST", body: JSON.stringify(credentials) });
  return "memberfulConnection" in answer ? answer : answer.user;
}

/**
 * Signs in with a sign-in link's id, as whoever it was made for, replacing any session this browser has.
 * The id goes in the body, so no request's address holds it. Fails with a 400 ApiError for a link
 * that's expired, tampered with, or for someone no longer active.
 */
export async function signInWithLink(transferId: string): Promise<Me> {
  const body: LinkSignIn = { transferId };
  return (await request<{ user: Me }>("/api/session/transfers", { method: "POST", body: JSON.stringify(body) })).user;
}

/**
 * Ends this browser's session, and forgets your push subscriptions with `pushSubscriptionEndpoint`, the
 * endpoint of the one this browser just ended, if it had one.
 */
export async function signOut(pushSubscriptionEndpoint: string | null = null): Promise<void> {
  const body: SignOut = pushSubscriptionEndpoint === null ? {} : { pushSubscriptionEndpoint };
  await request("/api/session", { method: "DELETE", body: JSON.stringify(body) });
}

/**
 * Saves this browser's push subscription for you, so that pushes reach it, or records that it was saved
 * again, replacing your subscription with the P-256 key `replacing`, if given.
 */
export async function savePushSubscription(subscription: PushSubscriptionKeys, replacing: string | null = null): Promise<void> {
  const body: PushSubscriptionSave = replacing === null ? subscription : { ...subscription, replacing };
  await request("/api/push-subscriptions", { method: "POST", body: JSON.stringify(body) });
}

/** Who this browser is signed in as. Fails with a 401 ApiError when it isn't signed in. */
export async function fetchMe(): Promise<Me> {
  return (await request<{ user: Me }>("/api/me")).user;
}

/**
 * Someone, whatever their status, for their page, with their email address and a new sign-in link for
 * them if you're an administrator. Fails with a 404 ApiError when nobody has id `userId`.
 */
export async function fetchPerson(userId: UserId): Promise<PersonAnswer> {
  return request<PersonAnswer>(`/api/users/${encodeURIComponent(userId)}`);
}

/**
 * The release this Ember is, and the newest one GitHub names, as General settings says, null when GitHub
 * didn't name one, as GitHub last told the Worker, which asks it again every six hours. Fails with a 403
 * ApiError for anyone but an administrator.
 */
export async function checkForRelease(): Promise<ReleaseCheck> {
  return request<ReleaseCheck>("/api/account/release");
}

/** The same, once the Worker has asked GitHub again, as opening Admin has it do, unless it asked in the last minute. */
export async function checkForReleaseAfresh(): Promise<ReleaseCheck> {
  return request<ReleaseCheck>("/api/account/release_checks", { method: "POST" });
}

/** A logo chosen for the workspace, with the variants made of it, or null where none could be made (`logoVariantsOf`). */
export interface ChosenLogo {
  file: File;
  variants: LogoVariants | null;
}

/** A copy of someone's sidebar, and the ETag the server sent it with. */
export interface SidebarCopy {
  sidebar: Sidebar;
  etag: string | null;
}

/**
 * This person's sidebar, or `copy` while it's still current. The server keeps the sidebar out of the
 * browser's cache, since it can hold the join code, so the app keeps its own copy, and says which it has
 * with the copy's ETag.
 */
export async function fetchSidebar(copy: SidebarCopy | null): Promise<SidebarCopy> {
  const response = await fetch("/api/sidebar", copy?.etag ? { headers: { "If-None-Match": copy.etag } } : {});
  if (copy && response.status === 304) return copy;
  return { sidebar: await dataOf<Sidebar>(response), etag: response.headers.get("ETag") };
}

/** Dismisses the welcome card for this person, for good: their sidebar, on any device, has no invitation from then on. */
export async function dismissInvitation(): Promise<void> {
  await request("/api/sidebar/invitation", { method: "DELETE" });
}

/** A copy of the people directory, and the ETag the server sent it with. */
export interface DirectoryCopy {
  directory: Directory;
  etag: string | null;
}

/** Everyone in the workspace, or `copy` while it's still current, kept out of the browser's cache as the sidebar is. */
export async function fetchDirectory(copy: DirectoryCopy | null): Promise<DirectoryCopy> {
  const response = await fetch("/api/users", copy?.etag ? { headers: { "If-None-Match": copy.etag } } : {});
  if (copy && response.status === 304) return copy;
  return { directory: await dataOf<Directory>(response), etag: response.headers.get("ETag") };
}

/** Opens the DM between this person and the people `userIds` names, starting it if the group has none, and answers it. */
export async function startDirect(userIds: UserId[]): Promise<DirectRoom> {
  return (await request<StartedDirect>("/api/directs", { method: "POST", body: JSON.stringify({ userIds } satisfies NewDirect) })).room;
}

/** A room's settings. Fails with a 404 ApiError for a room this person isn't in, or a DM. */
export async function fetchRoomSettings(roomId: RoomId): Promise<RoomSettings> {
  return request<RoomSettings>(`/api/rooms/${encodeURIComponent(roomId)}/settings`);
}

/**
 * Stars a room for this person, or unstars it, answering their stars as they are then. Fails with a
 * 403 ApiError for a room they can't star: a DM, or one they've hidden or aren't in.
 */
export async function setFavorite(roomId: RoomId, favorite: boolean): Promise<Favorites> {
  return (await request<{ favorites: Favorites }>(`/api/rooms/${encodeURIComponent(roomId)}/favorite`, { method: "PUT", body: JSON.stringify({ favorite }) })).favorites;
}

/**
 * Gives this person level `involvement` in a room, answering it. Fails with a 404 ApiError for a room
 * they aren't in.
 */
/** What you're notified about, when your paused notifications come back, and where you picked a level. */
export const fetchNotificationSettings = () => request<NotificationSettings>(NOTIFICATIONS_API_PATH);

/** Changes what you're notified about, or pauses or resumes notifications, answering the settings as they are now. */
export const changeNotifications = (changes: NotificationChanges) =>
  request<NotificationSettings>(NOTIFICATIONS_API_PATH, { method: "PATCH", body: JSON.stringify(changes) });

/** Has every room and DM you haven't hidden follow what you're notified about again. */
export const resetNotificationLevels = () => request<NotificationSettings>(NOTIFICATIONS_RESET_API_PATH, { method: "POST" });

/** Gives you `involvement` in a room, or with "default", what you're notified about there again, answering the level it has now. */
export async function setInvolvement(roomId: RoomId, involvement: Involvement | "default"): Promise<Involvement> {
  return (await request<{ involvement: Involvement }>(`/api/rooms/${encodeURIComponent(roomId)}/involvement`, { method: "PUT", body: JSON.stringify({ involvement }) }))
    .involvement;
}

/**
 * Puts this person's starred rooms in the order `roomIds` lists them, answering their stars as they are
 * then. Fails with a 403 ApiError unless it lists exactly the rooms they've starred.
 */
export async function setFavoriteOrder(roomIds: RoomId[]): Promise<Favorites> {
  return (await request<{ favorites: Favorites }>("/api/sidebar/order", { method: "PUT", body: JSON.stringify({ roomIds }) })).favorites;
}

/**
 * The preview of the page `url` goes to, for a link pasted in the composer, or null when it has none, as
 * Campfire's unfurl_controller.js asks for it. The page has none when it answers 204.
 */
export async function fetchLinkPreview(url: string, signal: AbortSignal): Promise<LinkPreview | null> {
  const preview = await request<Partial<LinkPreview>>("/api/unfurl", { method: "POST", body: JSON.stringify({ url }), signal });
  return preview.title && preview.url ? (preview as LinkPreview) : null;
}

/** Whether sharing from room `sourceRoomId` in `targetRoomId` would reach people who can't see it now, to warn first. */
export async function checkShare(sourceRoomId: RoomId, targetRoomId: RoomId): Promise<ShareWidening> {
  return request<ShareWidening>(SHARE_CHECK_PATH, { method: "POST", body: JSON.stringify({ sourceRoomId, targetRoomId }) });
}

/**
 * Where a room's @ prompt asks for the people it offers: Lexxy adds what's typed after the @ as
 * `filter`, and the answer is its prompt items.
 */
export const mentionPromptSrc = (roomId: RoomId) => `/api/autocompletable/users?room_id=${encodeURIComponent(roomId)}`;

/** The address of a socket at `path` on this page's host, over wss on https pages. */
export function socketUrl(path: string): string {
  const url = new URL(path, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** The address of a room's socket, which tells the room what `params` says about the tab. */
export const roomSocketUrl = (roomId: string, params: RoomSocketParams) => socketUrl(`/api/rooms/${encodeURIComponent(roomId)}/socket${roomSocketQuery(params)}`);

/** The address of a tab's workspace socket, which carries what changes outside the room it shows. */
export const workspaceSocketUrl = () => socketUrl(`/api/socket${timeZoneQuery()}`);

/** The time zone this browser is in, for the local time others see on your profile, as the workspace socket's query. */
function timeZoneQuery(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone ? `?tz=${encodeURIComponent(zone)}` : "";
}

/** A page of your Activity, newest first: the newest, or the one older than item `before`. */
export async function fetchActivity(before: number | null = null): Promise<ActivityPage> {
  return request<ActivityPage>(`/api/activity${before === null ? "" : `?before=${before}`}`);
}

/** Marks items of your Activity read or unread, or all of them read. */
export async function markActivity(marks: ActivityMarks): Promise<void> {
  await request("/api/activity/marks", { method: "POST", body: JSON.stringify(marks) });
}

/** Forgets the session earlier versions of the app kept in localStorage, which nothing reads now. */
export function forgetStoredSession(): void {
  try {
    localStorage.removeItem("ember:session");
  } catch {
    // Private windows can refuse storage, and then there's nothing to forget.
  }
}
