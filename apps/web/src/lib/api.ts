import type { Bootstrap, FirstRun, NewWorkspace, Room, User } from "@ember/protocol";

// The session lives in an HttpOnly cookie, which the browser sends with every request and room
// socket, so nothing here handles a token.

export type { Room };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The form field the error is about, when it's about one. */
    readonly field?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; field?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`, data.field);
  return data;
}

/** Whether Ember is set up yet, and who this browser is signed in as. */
export async function fetchBootstrap(): Promise<Bootstrap> {
  return request<Bootstrap>("/api/bootstrap");
}

/** Sets up the workspace with its first administrator, and signs this browser in as them. */
export async function setUpWorkspace(firstRun: FirstRun): Promise<NewWorkspace> {
  return request<NewWorkspace>("/api/first_run", { method: "POST", body: JSON.stringify(firstRun) });
}

/** Signs in with just a name, as someone new. */
export async function signIn(name: string): Promise<User> {
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

/** The rooms this person is in. */
export async function fetchRooms(): Promise<Room[]> {
  return (await request<{ rooms: Room[] }>("/api/rooms")).rooms;
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
