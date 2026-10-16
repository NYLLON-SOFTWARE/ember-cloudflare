import { parsePushSubscription, type PushSubscriptions } from "@ember/protocol";
import { credentialsOf } from "../auth";
import type { Env } from "../env";
import { workspace } from "../workspace";
import { endpointErrors } from "./endpoints";

// Your browsers' push subscriptions, as ember-rust's `push_subscriptions` controller keeps them
// (crates/ember/src/controllers/users/push_subscriptions.rs).

const problem = (status: number, message: string) => Response.json({ error: message }, { status });

const NOT_SIGNED_IN = "Not signed in";

/** `GET /api/push-subscriptions`: yours, oldest first, as ember-rust's `index` lists them. */
export async function listPushSubscriptions(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const subscriptions = credentials && (await workspace(env).pushSubscriptions(credentials));
  if (!subscriptions) return problem(401, NOT_SIGNED_IN);
  return Response.json({ subscriptions } satisfies PushSubscriptions, { headers: { "Cache-Control": "no-store" } });
}

/**
 * `POST /api/push-subscriptions`, `{ endpoint, p256dhKey, authKey }`: saves a browser's subscription for
 * you, with its user agent, as ember-rust's `create` does, or, when you've saved the same three before,
 * records that it was saved again, answering 204 where ember-rust answers 200. An endpoint pushes may not
 * go to is refused (422) with ember-rust's errors, which it leaves out of its answer.
 */
export async function savePushSubscription(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const subscription = parsePushSubscription(await request.json().catch(() => null));
  const refused = typeof subscription === "string" ? subscription : refusal(endpointErrors(subscription.endpoint));
  // Asked even for a subscription that's refused, so that someone signed out hears that first.
  const saved = await workspace(env).savePushSubscription(credentials, typeof subscription === "string" || refused ? null : subscription);
  if (!saved) return problem(401, NOT_SIGNED_IN);
  return refused ? problem(422, refused) : new Response(null, { status: 204 });
}

/** What an endpoint's errors refuse it with, as Rails writes them out: "Endpoint can't be blank and is not a valid URL". */
const refusal = (errors: string[]) => (errors.length > 0 ? `Endpoint ${errors.join(" and ")}` : null);

/**
 * `DELETE /api/push-subscriptions/:id`: deletes your subscription `id`, and does nothing if it's someone
 * else's or there's no such subscription, as ember-rust's `destroy` does, answering 204 either way where
 * it redirects to the list.
 */
export async function deletePushSubscription(request: Request, env: Env, id: string): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  // An id that isn't a number names no subscription.
  const deleted = credentials && (await workspace(env).deletePushSubscription(credentials, /^\d{1,15}$/.test(id) ? Number(id) : null));
  if (!deleted) return problem(401, NOT_SIGNED_IN);
  return new Response(null, { status: 204 });
}
