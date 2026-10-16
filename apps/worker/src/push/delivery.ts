import { eachAtMost, PUSHES_AT_ONCE } from "../at-once";
import type { Env } from "../env";
import type { MessagePush, PushDelivery } from "../workspace-store";
import { endpointErrors } from "./endpoints";
import { webPush, type VapidKeys } from "./keys";
import { encodedPush } from "./payload";
import { encryptPush, InvalidPushKeyError, PushArgumentError, vapidAuthorization } from "./web-push";

// Sending pushes as ember-rust's push pool delivers them (crates/ember/src/integrations/web_push.rs and
// web_push/pool.rs): each to its subscription's push service, encrypted for its browser and signed with
// the deployment's key, a few at a time. Nothing is retried. A subscription whose push service says it's
// gone, or whose keys no push can be encrypted for, is forgotten, and any other failure is logged.

/** Whom push services may contact about this deployment's pushes when VAPID_SUBJECT doesn't say: the project. */
export const DEFAULT_VAPID_SUBJECT = "https://github.com/NYLLON-SOFTWARE/ember-cloudflare";

/** How long a push service keeps a push for a browser that's away: four weeks, as the gem's `ttl` has it. */
const TTL_SECONDS = 4 * 7 * 24 * 60 * 60;

/** How long a push may take in all, however slowly its push service answers, as ember-rust's `DELIVERY_DEADLINE`. */
const DEADLINE_MS = 30_000;

const encoder = new TextEncoder();

/**
 * Sends `pushes`, as long as Web Push is on, and answers the subscriptions to forget: those whose push
 * service said they're gone (404 or 410), and those whose keys no push can be encrypted for. An endpoint
 * that's no longer at a permitted push service is skipped. `send` stands in for `fetch` in tests.
 */
export async function sendPushes(env: Env, pushes: MessagePush[], send: typeof fetch = fetch): Promise<number[]> {
  const push = await webPush(env);
  if (!push.on) return [];
  const subject = env.VAPID_SUBJECT?.trim() || DEFAULT_VAPID_SUBJECT;
  const deliveries = pushes.flatMap(({ payload, deliveries }) => deliveries.map((delivery) => ({ message: encodedPush(payload, delivery.badge), delivery })));
  const gone: number[] = [];
  await eachAtMost(deliveries, PUSHES_AT_ONCE, async ({ message, delivery }) => {
    if (await isGone(message, delivery, push.keys, subject, send)) gone.push(delivery.subscriptionId);
  });
  return gone;
}

/** Sends `message` to a subscription, as the gem's `payload_send` does, answering whether to forget the subscription. */
async function isGone(message: string, { endpoint, p256dhKey, authKey }: PushDelivery, keys: VapidKeys, subject: string, send: typeof fetch): Promise<boolean> {
  if (endpointErrors(endpoint).length > 0) return false;
  const { origin, hostname } = new URL(endpoint);
  try {
    const body = await encryptPush(encoder.encode(message), p256dhKey, authKey);
    const response = await send(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        TTL: String(TTL_SECONDS),
        Urgency: "high",
        "Content-Encoding": "aes128gcm",
        Authorization: await vapidAuthorization(origin, Math.floor(Date.now() / 1000), keys, subject),
      },
      body,
      // A push service answers a push itself, so a redirect is an answer, as Net::HTTP takes it.
      redirect: "manual",
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
    await response.body?.cancel();
    const failure = failureOf(response);
    if (failure === null || failure.gone) return failure !== null;
    logFailure(failure.kind, `host: ${hostname}, status: ${response.status}`);
    return false;
  } catch (error) {
    if (error instanceof InvalidPushKeyError) return true;
    logFailure(classOf(error), error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** What the gem's `verify_response` raises for a push service's answer, and whether it means the subscription is gone; null for a push it took. */
function failureOf({ status, statusText }: Response): { kind: string; gone: boolean } | null {
  if (status === 410) return { kind: "WebPush::ExpiredSubscription", gone: true };
  if (status === 404) return { kind: "WebPush::InvalidSubscription", gone: true };
  if (status === 401 || status === 403 || (status === 400 && statusText === "UnauthorizedRegistration")) return { kind: "WebPush::Unauthorized", gone: false };
  if (status === 413) return { kind: "WebPush::PayloadTooLarge", gone: false };
  if (status === 429) return { kind: "WebPush::TooManyRequests", gone: false };
  if (status >= 500 && status <= 599) return { kind: "WebPush::PushServiceError", gone: false };
  if (status >= 200 && status <= 299) return null;
  return { kind: "WebPush::ResponseError", gone: false };
}

/** The Ruby error class ember-rust logs for a push that couldn't be sent. */
function classOf(error: unknown): string {
  if (error instanceof PushArgumentError) return "ArgumentError";
  if (error instanceof Error && error.name === "TimeoutError") return "Net::ReadTimeout";
  return "SystemCallError";
}

const logFailure = (kind: string, detail: string) => console.error(`Error in WebPush::Pool.deliver: ${kind} ${detail}`);
