import type { ChatRoom } from "./chat-room";

export type StorageBackend = "do-sqlite" | "d1";

export interface Env {
  ASSETS: Fetcher;
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  /** Only bound when D1 is configured in wrangler.jsonc. */
  DB?: D1Database;
  STORAGE_BACKEND: StorageBackend;
  /** Comma-separated room slugs shown in every sidebar. */
  DEFAULT_ROOMS: string;
  SESSION_SECRET: string;
}
