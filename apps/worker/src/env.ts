import type { ChatRoom } from "./chat-room";
import type { PasswordHasher } from "./passwords";
import type { Unfurler } from "./unfurl";
import type { Workspace } from "./workspace";

export type StorageBackend = "do-sqlite" | "d1";

export interface Env {
  ASSETS: Fetcher;
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  WORKSPACE: DurableObjectNamespace<Workspace>;
  PASSWORD_HASHER: DurableObjectNamespace<PasswordHasher>;
  UNFURLER: DurableObjectNamespace<Unfurler>;
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
  /**
   * 64 lowercase hex characters (`openssl rand -hex 32`) that keep setup to whoever opens the private
   * link `/first_run/access#token=<token>`. Unset, the first visitor sets up the workspace.
   */
  EMBER_SETUP_TOKEN?: string;
  /** What to call this deployment's version, as ember-rust's `APP_VERSION` does. */
  APP_VERSION?: string;
  /** The commit deployed, which stands in for the version when APP_VERSION isn't set. */
  GIT_REVISION?: string;
}
