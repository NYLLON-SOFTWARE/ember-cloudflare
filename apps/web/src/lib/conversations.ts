import type { DirectPreviews, ListedThreads } from "@ember/protocol";
import { ApiError } from "./api";

// What the DMs page and the Threads page ask the Worker for.

/** What `path` answers, or the ApiError it says why it failed with. */
async function fetched<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`);
  return data;
}

/** Each of your DMs' latest message and how many unread. */
export const fetchDirectPreviews = () => fetched<DirectPreviews>("/api/directs");

/** A page of the threads in your rooms and DMs, latest active first, from `cursor` on. */
export const fetchThreads = (cursor: number | null = null) => fetched<ListedThreads>(cursor === null ? "/api/threads" : `/api/threads?cursor=${cursor}`);
