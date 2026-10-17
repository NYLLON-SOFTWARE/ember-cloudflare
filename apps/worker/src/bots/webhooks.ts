import { botMessagesPath, type Message, type RoomId, type User } from "@ember/protocol";
import type { MessageWebhook } from "../workspace-store";
import { botKeyOf } from "./keys";
import { railsJson } from "./rails-json";

// Delivering new messages to bots' webhooks, as Campfire's `Webhook#deliver` does
// (reference/app/models/webhook.rb) and ember-rust's integrations/webhook.rs follows it: the message,
// as JSON, POSTed to the URL an administrator gave the bot. Nothing guards where that is, since only
// administrators set it. Redirects aren't followed, and nothing is retried.

/** How long a webhook has to answer: `Webhook::ENDPOINT_TIMEOUT`, which Net::HTTP gives connecting and then reading. */
export const ENDPOINT_TIMEOUT_MS = 7_000;

/**
 * The headers Net::HTTP sends with Campfire's request, as ember-rust records them, but for those a
 * Worker's `fetch` decides itself: Host, Content-Length, Connection and Accept-Encoding. Cloudflare adds
 * `CF-Worker`, naming the Worker's host.
 */
const HEADERS = { "Content-Type": "application/json", Accept: "*/*", "User-Agent": "Ruby" };

/**
 * `Webhook#payload`: who wrote `message`, where, and what it says, for `webhook`'s bot. The room's
 * address is the one the bot posts to there, with its key, and the message's is its permalink, both
 * without an origin, as Rails' path helpers write them.
 */
export function webhookPayload(roomId: RoomId, webhook: MessageWebhook, message: Pick<Message, "id" | "body" | "plainText" | "mentions">): string {
  const { author, roomName, bot, token } = webhook;
  const plain = withoutMentionsOf(nameIn(message, bot), message.plainText);
  return railsJson({
    user: { id: author.id, name: author.name },
    room: { id: roomId, name: roomName, path: botMessagesPath(roomId, botKeyOf(bot.id, token)) },
    message: { id: message.id, body: { html: message.body, plain }, path: `/rooms/${roomId}/@${message.id}` },
  });
}

/**
 * The name `message`'s plain text gives `bot`: the one its mentions of it have, from when the text was
 * last written, which an edit since a rename the delivery hasn't heard of makes the new name, or where
 * it isn't mentioned by name, the one the delivery has. Campfire reads both as the delivery runs, so
 * they always agree.
 */
const nameIn = (message: Pick<Message, "mentions">, bot: User) => message.mentions.find(({ id }) => id === bot.id)?.name || bot.name;

/** `without_recipient_mentions`: `text` without its @mentions of `name`, matched case for case, nor whitespace at either end. */
const withoutMentionsOf = (name: string, text: string) => text.replaceAll(`@${name}`, "").replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");

/** What came of a delivery: the webhook's status, or, when it didn't answer in time, how many seconds it had. */
export type Delivered = { status: number } | { timedOutAfter: number };

/** Why a delivery came to nothing, as Ruby raises: a URL Net::HTTP can't send to, or a request that failed. */
export class WebhookError extends Error {}

/**
 * `Webhook#post`: POSTs `payload` to `url`, as Net::HTTP does, giving the webhook `timeoutMs` to answer.
 * Throws a `WebhookError` when `url` isn't an http or https URL with a host, or the request fails, with
 * a message that never holds the URL. `send` stands in for `fetch` in tests.
 */
export async function postWebhook(url: string, payload: string, timeoutMs = ENDPOINT_TIMEOUT_MS, send: typeof fetch = fetch): Promise<Delivered> {
  const target = URL.parse(url);
  if (!target || (target.protocol !== "http:" && target.protocol !== "https:") || !target.hostname) throw new WebhookError("bad URI");
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  try {
    const response = await send(target, { method: "POST", headers: HEADERS, body: payload, redirect: "manual", signal: timeout.signal });
    // What the bot says back comes with plan step 10.6.
    await response.body?.cancel();
    return { status: response.status };
  } catch (error) {
    if (timeout.signal.aborted) return { timedOutAfter: timeoutMs / 1000 };
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new WebhookError([url, target.href].reduce((text, address) => text.replaceAll(address, "[FILTERED]"), reason));
  } finally {
    clearTimeout(timer);
  }
}
