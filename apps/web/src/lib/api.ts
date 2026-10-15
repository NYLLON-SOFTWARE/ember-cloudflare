import {
  roomSocketQuery,
  type Account,
  type AccountChanges,
  type Bootstrap,
  type ChangedPerson,
  type CustomStyles,
  type Directory,
  type DirectoryUser,
  type Favorites,
  type Me,
  type NewJoinCode,
  type NewRoom,
  type NewRoomForm,
  type NewWorkspace,
  type PasswordSignIn,
  type PersonRole,
  type Profile,
  type ProfileAnswer,
  type ProfileChanges,
  type Room,
  type RoomChanges,
  type RoomId,
  type RoomSettings,
  type RoomSocketParams,
  type Sidebar,
  type SignUp,
  type UserId,
  type WorkspaceSettings,
} from "@ember/protocol";

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
  ) {
    super(message);
  }
}

/** Whether `error` says this browser's session has ended, which matters whatever page is showing. */
export const isSignedOut = (error: unknown) => error instanceof ApiError && error.status === 401;

/** What an answer carries, or the ApiError it says why it failed with. */
async function dataOf<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; field?: string; redirect?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`, data.field, data.redirect);
  return data;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  return dataOf<T>(await fetch(path, { ...init, headers }));
}

/** Whether Ember is set up yet, and who this browser is signed in as. */
export async function fetchBootstrap(): Promise<Bootstrap> {
  return request<Bootstrap>("/api/bootstrap");
}

/** Sets up the workspace with its first administrator, and signs this browser in as them. */
export async function setUpWorkspace(administrator: SignUp): Promise<NewWorkspace> {
  return request<NewWorkspace>("/api/first_run", { method: "POST", body: JSON.stringify(administrator) });
}

/**
 * Joins the workspace with the code from its join link, as someone new, and signs this browser in as
 * them. The code is the link's own path segment, which needs no escaping.
 */
export async function joinWorkspace(joinCode: string, person: SignUp): Promise<Me> {
  return (await request<{ user: Me }>(`/api/join/${joinCode}`, { method: "POST", body: JSON.stringify(person) })).user;
}

/** Signs in with an email address and password. */
export async function signIn(credentials: PasswordSignIn): Promise<Me> {
  return (await request<{ user: Me }>("/api/session", { method: "POST", body: JSON.stringify(credentials) })).user;
}

/** Signs in with just a name, as someone new. */
export async function signInAsGuest(name: string): Promise<Me> {
  return (await request<{ user: Me }>("/api/session", { method: "POST", body: JSON.stringify({ name }) })).user;
}

/** Ends this browser's session. */
export async function signOut(): Promise<void> {
  await request("/api/session", { method: "DELETE" });
}

/** Who this browser is signed in as. Fails with a 401 ApiError when it isn't signed in. */
export async function fetchMe(): Promise<Me> {
  return (await request<{ user: Me }>("/api/me")).user;
}

/** Your profile: your name, email address and bio, for the profile page. */
export async function fetchProfile(): Promise<Profile> {
  return (await request<ProfileAnswer>("/api/users/me/profile")).profile;
}

/**
 * Changes your profile, answering it as it is then. A blank password keeps the one you have. Fails with
 * a 422 ApiError for an email address someone else has.
 */
export async function changeProfile(changes: ProfileChanges): Promise<Profile> {
  return (await request<ProfileAnswer>("/api/users/me/profile", { method: "PATCH", body: JSON.stringify(changes) })).profile;
}

/** Workspace settings: the workspace, its join code, and whether this person can change it. */
export async function fetchWorkspaceSettings(): Promise<WorkspaceSettings> {
  return request<WorkspaceSettings>("/api/account");
}

/** Changes the workspace, answering it as it is then. Fails with a 403 ApiError for anyone but an administrator. */
export async function changeAccount(changes: AccountChanges): Promise<Account> {
  return (await request<{ account: Account }>("/api/account", { method: "PATCH", body: JSON.stringify(changes) })).account;
}

/** The workspace's custom CSS, for the Custom CSS page. Fails with a 403 ApiError for anyone but an administrator. */
export async function fetchCustomStyles(): Promise<string> {
  return (await request<CustomStyles>("/api/account/custom_styles")).customStyles;
}

/** Saves the workspace's custom CSS, answering the workspace as it is then. Fails with a 403 ApiError for anyone but an administrator. */
export async function changeCustomStyles(customStyles: string): Promise<Account> {
  return (await request<{ account: Account }>("/api/account/custom_styles", { method: "PATCH", body: JSON.stringify({ customStyles }) })).account;
}

/** Gives the join link a new code, answering it. Fails with a 403 ApiError for anyone but an administrator. */
export async function regenerateJoinCode(): Promise<string> {
  return (await request<NewJoinCode>("/api/account/join_code", { method: "POST" })).joinCode;
}

/**
 * Makes someone an administrator or a member, answering them as the people directory then lists them.
 * Fails with a 403 ApiError for anyone but an administrator, and for their own role or a bot's.
 */
export async function changeRole(userId: UserId, role: PersonRole): Promise<DirectoryUser> {
  return (await request<ChangedPerson>(`/api/account/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify({ role }) })).user;
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

/** Who the New room forms list: everyone active, by name. */
export async function fetchNewRoomForm(): Promise<NewRoomForm> {
  return request<NewRoomForm>("/api/rooms/new");
}

/** Creates a room, answering it. */
export async function createRoom(room: NewRoom): Promise<Room> {
  return (await request<{ room: Room }>("/api/rooms", { method: "POST", body: JSON.stringify(room) })).room;
}

/** A room's settings. Fails with a 404 ApiError for a room this person isn't in, or a DM. */
export async function fetchRoomSettings(roomId: RoomId): Promise<RoomSettings> {
  return request<RoomSettings>(`/api/rooms/${encodeURIComponent(roomId)}/settings`);
}

/** Changes a room, answering it as it is then. */
export async function changeRoom(roomId: RoomId, changes: RoomChanges): Promise<Room> {
  return (await request<{ room: Room }>(`/api/rooms/${encodeURIComponent(roomId)}`, { method: "PATCH", body: JSON.stringify(changes) })).room;
}

/**
 * Stars a room for this person, or unstars it, answering their stars as they are then. Fails with a
 * 403 ApiError for a room they can't star: a DM, or one they've hidden or aren't in.
 */
export async function setFavorite(roomId: RoomId, favorite: boolean): Promise<Favorites> {
  return (await request<{ favorites: Favorites }>(`/api/rooms/${encodeURIComponent(roomId)}/favorite`, { method: "PUT", body: JSON.stringify({ favorite }) })).favorites;
}

/**
 * Puts this person's starred rooms in the order `roomIds` lists them, answering their stars as they are
 * then. Fails with a 403 ApiError unless it lists exactly the rooms they've starred.
 */
export async function setFavoriteOrder(roomIds: RoomId[]): Promise<Favorites> {
  return (await request<{ favorites: Favorites }>("/api/sidebar/order", { method: "PUT", body: JSON.stringify({ roomIds }) })).favorites;
}

/** Deletes a room, with its messages. */
export async function deleteRoom(roomId: RoomId): Promise<void> {
  await request(`/api/rooms/${encodeURIComponent(roomId)}`, { method: "DELETE" });
}

/**
 * Where a room's @ prompt asks for the people it offers, as ember-rust's `mention_prompt_src`: Lexxy adds
 * what's typed after the @ as `filter`, and the answer is its prompt items.
 */
export const mentionPromptSrc = (roomId: RoomId) => `/api/autocompletable/users?room_id=${encodeURIComponent(roomId)}`;

/** The address of a socket at `path` on this page's host, over wss on https pages. */
function socketUrl(path: string): string {
  const url = new URL(path, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** The address of a room's socket, which tells the room what `params` says about the tab. */
export const roomSocketUrl = (roomId: string, params: RoomSocketParams) => socketUrl(`/api/rooms/${encodeURIComponent(roomId)}/socket${roomSocketQuery(params)}`);

/** The address of a tab's workspace socket, which carries what changes outside the room it shows. */
export const workspaceSocketUrl = () => socketUrl("/api/socket");

/** Forgets the session earlier versions of the app kept in localStorage, which nothing reads now. */
export function forgetStoredSession(): void {
  try {
    localStorage.removeItem("ember:session");
  } catch {
    // Private windows can refuse storage, and then there's nothing to forget.
  }
}
