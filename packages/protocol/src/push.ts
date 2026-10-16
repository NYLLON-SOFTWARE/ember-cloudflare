// Web Push subscriptions, as `/api/push-subscriptions` takes and lists them, and signing out forgets
// this browser's: ember-rust's `push_subscriptions` (crates/ember/src/controllers/users/push_subscriptions.rs)
// and `sessions#destroy` (crates/ember/src/controllers/sessions.rs).

/** The longest endpoint saved. Push services' are a few hundred characters. */
export const MAX_PUSH_ENDPOINT_LENGTH = 2048;
/** The longest key saved. A browser's P-256 key is 87 characters of Base64, and its auth secret 22. */
export const MAX_PUSH_KEY_LENGTH = 256;

/** A browser's push subscription, as `POST /api/push-subscriptions` takes it from `PushSubscription.toJSON()`. */
export interface PushSubscriptionKeys {
  endpoint: string;
  /** The browser's P-256 public key, which pushes are encrypted for, in URL-safe Base64. */
  p256dhKey: string;
  /** The browser's authentication secret, in URL-safe Base64. */
  authKey: string;
}

/** One of your saved subscriptions, as `GET /api/push-subscriptions` lists them. */
export interface SavedPushSubscription {
  id: number;
  endpoint: string;
  /** The user agent of the browser that saved it, if it sent one. */
  userAgent: string | null;
}

/** What `GET /api/push-subscriptions` answers: your subscriptions, oldest first. */
export interface PushSubscriptions {
  subscriptions: SavedPushSubscription[];
}

/** What `DELETE /api/session` may send: the endpoint of the push subscription this browser just ended. */
export interface SignOut {
  pushSubscriptionEndpoint?: string;
}

/**
 * Parses what `POST /api/push-subscriptions` takes. Returns why it's refused instead: the endpoint and
 * both keys are required and have to be text, where ember-rust saves a missing key as none at all.
 */
export function parsePushSubscription(data: unknown): PushSubscriptionKeys | string {
  const { endpoint, p256dhKey, authKey } = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  if (typeof endpoint !== "string" || typeof p256dhKey !== "string" || typeof authKey !== "string") {
    return "A push subscription needs its endpoint and keys";
  }
  if (endpoint.length > MAX_PUSH_ENDPOINT_LENGTH) return `Endpoint can't be longer than ${MAX_PUSH_ENDPOINT_LENGTH} characters`;
  if (p256dhKey.length > MAX_PUSH_KEY_LENGTH || authKey.length > MAX_PUSH_KEY_LENGTH) return `Keys can't be longer than ${MAX_PUSH_KEY_LENGTH} characters`;
  return { endpoint, p256dhKey, authKey };
}

/**
 * The endpoint a sign-out names, whose subscriptions of yours go with the session, or null when it
 * names none an endpoint could be.
 */
export function signOutEndpointOf(data: unknown): string | null {
  const { pushSubscriptionEndpoint: endpoint } = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  return typeof endpoint === "string" && endpoint !== "" && endpoint.length <= MAX_PUSH_ENDPOINT_LENGTH ? endpoint : null;
}
