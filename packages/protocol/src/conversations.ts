import type { Message, RoomId } from "./index.ts";

// What the DMs page and the Threads page ask the Worker for: each DM's latest message and how many have
// come since it was marked unread, and the threads someone follows, each with the messages around its end.

/** `GET /api/directs`: one of your DMs, with its latest message, not counting replies in threads, and how many unread. */
export interface DirectPreview {
  roomId: RoomId;
  /** Its latest message, or null when it has none the search index has taken. */
  latest: Message | null;
  /** How many messages others have written in it since it was marked unread, or 0 when it isn't. */
  unread: number;
}

export interface DirectPreviews {
  previews: DirectPreview[];
}

/** How many of a thread's latest replies the Threads page shows under its first message. */
export const THREAD_CONTEXT = 6;

/** How many threads a page of `GET /api/threads` lists, at most. */
export const THREADS_LIMIT = 20;

/**
 * A thread you follow: one you started, wrote in, or were mentioned in, in a room you're in, with its
 * first message and its latest replies, oldest first, up to `THREAD_CONTEXT`.
 */
export interface FollowedThread {
  roomId: RoomId;
  parent: Message;
  replies: Message[];
  /** How many replies it has in all. */
  count: number;
}

/** `GET /api/threads?cursor=`: a page of the threads you follow, latest active first, and the next page's cursor, or null. */
export interface FollowedThreads {
  threads: FollowedThread[];
  next: number | null;
}
