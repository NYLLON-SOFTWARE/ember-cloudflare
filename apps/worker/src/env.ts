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
  /**
   * The R2 bucket that keeps the files people upload to rooms, as ember-rust keeps them on disk.
   * Unbound, Ember keeps none: uploading answers 503 and a file's address 404.
   */
  FILES?: R2Bucket;
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
  /** What the Set up Ember form suggests for the administrator's name in place of "Kevin Rose". */
  EMBER_SETUP_NAME_PLACEHOLDER?: string;
  /** What the Set up Ember form suggests for their email address in place of "kevin@kevinrose.com". */
  EMBER_SETUP_EMAIL_PLACEHOLDER?: string;
  /**
   * 64 lowercase hex characters (`openssl rand -hex 32`) that the deploy's setup link carries, which
   * is what lets its holder set Ember up (setup.ts). `pnpm run deploy` makes one for a Worker that has
   * none. Unset, setup is closed, except over loopback, where `wrangler dev` serves.
   */
  EMBER_SETUP_TOKEN?: string;
  /**
   * 64 lowercase hex characters (`openssl rand -hex 32`) that let apps/worker/scripts/reset-password.ts
   * reset anyone's password. Unset, nothing can, so set it only while it's needed.
   */
  EMBER_RECOVERY_TOKEN?: string;
  /**
   * The address of the Memberful site whose members may sign in, such as https://example.memberful.com,
   * once an administrator turns Memberful sign-in on (memberful.ts). Without it, or either of the two
   * keys of the site's custom app below, Memberful sign-in can't be turned on.
   */
  MEMBERFUL_URL?: string;
  /** The OAuth identifier of the Memberful site's custom app, a server-side one. */
  MEMBERFUL_CLIENT_ID?: string;
  /** That app's client secret, which never leaves the Worker. */
  MEMBERFUL_CLIENT_SECRET?: string;
  /**
   * That app's API key, with which the Workspace asks Memberful's admin API whose memberships are
   * active, when a webhook says one changed, and once a day (memberful-api.ts). Without it, only
   * signing in checks a membership, and Memberful's webhooks are refused, as they are without the
   * secret below.
   */
  MEMBERFUL_API_KEY?: string;
  /** The secret Memberful signs its webhooks to `/webhooks/memberful` with, which its Webhooks settings show. */
  MEMBERFUL_WEBHOOK_SECRET?: string;
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

/** Whether people may sign in with just a name, and guests who did may stay signed in. */
export const guestSignIn = (env: Env) => env.EMBER_GUEST_SIGN_IN === "true";
