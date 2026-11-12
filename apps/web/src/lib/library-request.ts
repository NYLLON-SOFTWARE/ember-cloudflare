import { ApiError } from "./api";

// The library's requests (library.ts and room-tabs.ts), answering their JSON, or failing with an ApiError.

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: init.body ? { "Content-Type": "application/json" } : {} });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`);
  return data;
}

export const sending = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
