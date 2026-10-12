import type { User } from "@ember/protocol";

export interface Room {
  id: string;
  name: string;
  kind: "open" | "closed" | "direct";
}

export interface Session {
  user: User;
  token: string;
}

const SESSION_KEY = "ember:session";

export function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private windows can refuse storage; the session then lasts for this tab only.
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`);
  return data;
}

export function signIn(name: string): Promise<Session> {
  return request<Session>("/api/session", { method: "POST", body: JSON.stringify({ name }) });
}

export async function fetchRooms(token: string): Promise<Room[]> {
  return (await request<{ rooms: Room[] }>("/api/rooms", { token })).rooms;
}

export function roomSocketUrl(roomId: string, token: string): string {
  const url = new URL(`/api/rooms/${encodeURIComponent(roomId)}/socket`, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}
