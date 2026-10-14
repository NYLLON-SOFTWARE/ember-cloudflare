import type { Bootstrap, NewWorkspace, PasswordSignIn, Room, RoomList, SignUp, User } from "@ember/protocol";

// The session lives in an HttpOnly cookie, which the browser sends with every request and room
// socket, so nothing here handles a token.

export type { Room, RoomList };

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; field?: string; redirect?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`, data.field, data.redirect);
  return data;
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
export async function joinWorkspace(joinCode: string, person: SignUp): Promise<User> {
  return (await request<{ user: User }>(`/api/join/${joinCode}`, { method: "POST", body: JSON.stringify(person) })).user;
}

/** Signs in with an email address and password. */
export async function signIn(credentials: PasswordSignIn): Promise<User> {
  return (await request<{ user: User }>("/api/session", { method: "POST", body: JSON.stringify(credentials) })).user;
}

/** Signs in with just a name, as someone new. */
export async function signInAsGuest(name: string): Promise<User> {
  return (await request<{ user: User }>("/api/session", { method: "POST", body: JSON.stringify({ name }) })).user;
}

/** Ends this browser's session. */
export async function signOut(): Promise<void> {
  await request("/api/session", { method: "DELETE" });
}

/** Who this browser is signed in as. Fails with a 401 ApiError when it isn't signed in. */
export async function fetchMe(): Promise<User> {
  return (await request<{ user: User }>("/api/me")).user;
}

/** The rooms this person is in, and the welcome card's invitation when they're in its room. */
export async function fetchRooms(): Promise<RoomList> {
  return request<RoomList>("/api/rooms");
}

export function roomSocketUrl(roomId: string): string {
  const url = new URL(`/api/rooms/${encodeURIComponent(roomId)}/socket`, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** Forgets the session earlier versions of the app kept in localStorage, which nothing reads now. */
export function forgetStoredSession(): void {
  try {
    localStorage.removeItem("ember:session");
  } catch {
    // Private windows can refuse storage, and then there's nothing to forget.
  }
}
