import type { ChatRoom } from "./chat-room";
import type { PasswordHasher } from "./passwords";
import type { SearchIndex } from "./search-index";
import type { Unfurler } from "./unfurl";
import type { Workspace } from "./workspace";

export type StorageBackend = "do-sqlite" | "d1";

export interface Env {
  ASSETS: Fetcher;
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  WORKSPACE: DurableObjectNamespace<Workspace>;
  PASSWORD_HASHER: DurableObjectNamespace<PasswordHasher>;
  UNFURLER: DurableObjectNamespace<Unfurler>;
  SEARCH_INDEX: DurableObjectNamespace<SearchIndex>;
  /** Only bound when D1 is configured in wrangler.jsonc. */
  DB?: D1Database;
  STORAGE_BACKEND: StorageBackend;
  /**
   * Comma-separated addresses of rooms from before the Workspace kept a list, which it registers as
   * open rooms so their messages stay reachable. Only the old preview Worker, `ember-preview`, was
   * deployed with it.
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
  /**
   * 64 lowercase hex characters (`openssl rand -hex 32`) that let apps/worker/scripts/reset-password.ts
   * reset anyone's password. Unset, nothing can, so set it only while it's needed.
   */
  EMBER_RECOVERY_TOKEN?: string;
  /**
   * The public half of the P-256 key pair that signs push notifications (VAPID), as ember-rust takes
   * it: the point, compressed or not, in URL-safe Base64. `pnpm vapid:keys` makes a pair. Without both
   * halves, or with a pair that doesn't match, push notifications are off. Browsers subscribe with it,
   * so changing it orphans every subscription.
   */
  VAPID_PUBLIC_KEY?: string;
  /** The private half of the VAPID key pair: its scalar, up to 32 bytes, in URL-safe Base64. */
  VAPID_PRIVATE_KEY?: string;
  /**
   * Whom push services may contact about this deployment's pushes, a `mailto:` or `https:` address, as
   * ember-rust's `VAPID_SUBJECT` says it. Unset, it's this project's address.
   */
  VAPID_SUBJECT?: string;
  /** What to call this deployment's version, as ember-rust's `APP_VERSION` does. */
  APP_VERSION?: string;
  /** The commit deployed, which stands in for the version when APP_VERSION isn't set. */
  GIT_REVISION?: string;
  /**
   * Any value but a blank one lets plain HTTP through rather than redirecting it to HTTPS, and leaves
   * out HSTS, as ember-rust's `DISABLE_SSL` does. Loopback addresses, where `wrangler dev` serves,
   * never need it.
   */
  DISABLE_SSL?: string;
}
