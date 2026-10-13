import type { ChatRoom } from "./chat-room";
import type { Workspace } from "./workspace";

export type StorageBackend = "do-sqlite" | "d1";

export interface Env {
  ASSETS: Fetcher;
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  WORKSPACE: DurableObjectNamespace<Workspace>;
  /** Only bound when D1 is configured in wrangler.jsonc. */
  DB?: D1Database;
  STORAGE_BACKEND: StorageBackend;
  /**
   * Comma-separated addresses of rooms from before the Workspace kept a list, which it registers as
   * open rooms so their messages stay reachable. Only the preview sets it.
   */
  LEGACY_ROOMS?: string;
  SESSION_SECRET: string;
  /** "true" lets anyone sign in with just a name, for tests and demos. Leave it unset otherwise. */
  EMBER_GUEST_SIGN_IN?: string;
}
