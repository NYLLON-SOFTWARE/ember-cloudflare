import { parseBotChanges, parseNewBot, type BotAnswer, type Bots, type BotSettings, type UserId } from "@ember/protocol";
import { credentialsOf } from "../auth";
import type { Env } from "../env";
import { workspace } from "../workspace";

// Chat bots, as administrators add, change and delete them, as ember-rust's `accounts/bots` and
// `accounts/bots/keys` controllers do (crates/ember/src/controllers/accounts/bots.rs). They answer JSON
// for the app's pages where ember-rust answers pages and redirects to the bots page.

const problem = (status: number, message: string) => Response.json({ error: message }, { status });

const NOT_SIGNED_IN = "Not signed in";
const FORBIDDEN = "Only administrators can manage bots";
/** Keys are secrets, which no cache should keep. */
const PRIVATE = { "Cache-Control": "no-store" };

/** `GET /api/account/bots`: the active bots, by name, each with its key and its rooms, as ember-rust's bots page lists them (`index`). */
export async function listBots(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const bots = credentials && (await workspace(env).bots(credentials));
  if (!bots) return problem(401, NOT_SIGNED_IN);
  if (bots === "forbidden") return problem(403, FORBIDDEN);
  return Response.json({ bots } satisfies Bots, { headers: PRIVATE });
}

/**
 * `POST /api/account/bots`, `{ name, webhookUrl }`: adds a bot, as ember-rust's `create` does, answering
 * 201 with the bot as its edit page shows it. As there, someone who isn't an administrator hears so
 * before anything they sent is checked.
 */
export async function createBot(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const bot = withWebAddress(parseNewBot(await request.json().catch(() => null)));
  if (typeof bot === "string") {
    const administrator = await workspace(env).canAdminister(credentials);
    if (administrator === null) return problem(401, NOT_SIGNED_IN);
    return administrator ? problem(422, bot) : problem(403, FORBIDDEN);
  }
  const created = await workspace(env).createBot(credentials, bot);
  if (!created) return problem(401, NOT_SIGNED_IN);
  if (created === "forbidden") return problem(403, FORBIDDEN);
  return Response.json({ bot: created } satisfies BotAnswer, { status: 201, headers: PRIVATE });
}

/** `GET /api/account/bots/:id`: the active bot `id`, as its edit page shows it (`edit`). */
export async function showBot(request: Request, env: Env, botId: UserId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  return botAnswer(credentials && (await workspace(env).bot(credentials, botId)));
}

/**
 * `PATCH /api/account/bots/:id`, `{ name, webhookUrl }`: changes the active bot `id`, as ember-rust's
 * `update` does, answering it as its edit page then shows it. As there, someone who isn't an
 * administrator hears so first, then a bot that isn't active isn't found, before what was sent is checked.
 */
export async function changeBot(request: Request, env: Env, botId: UserId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const changes = withWebAddress(parseBotChanges(await request.json().catch(() => null)));
  // Changes that are refused change nothing, but who's asking and which bot are still checked first.
  const bot = await workspace(env).changeBot(credentials, botId, typeof changes === "string" ? null : changes);
  if (typeof changes === "string" && typeof bot === "object" && bot !== null) return problem(422, changes);
  return botAnswer(bot);
}

/**
 * `DELETE /api/account/bots/:id`: deletes the active bot `id`, as ember-rust's `destroy` does, which
 * deactivates it, answering 204.
 */
export async function deleteBot(request: Request, env: Env, botId: UserId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const deleted = credentials && (await workspace(env).deleteBot(credentials, botId));
  if (!deleted) return problem(401, NOT_SIGNED_IN);
  if (deleted === "forbidden") return problem(403, FORBIDDEN);
  if (deleted === "not found") return problem(404, "Not found");
  return new Response(null, { status: 204 });
}

/** `PUT /api/account/bots/:id/key`: gives the active bot `id` a new key, as ember-rust's `keys#update` does, answering the bot with it. */
export async function resetBotKey(request: Request, env: Env, botId: UserId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  return botAnswer(credentials && (await workspace(env).resetBotKey(credentials, botId)));
}

function botAnswer(bot: BotSettings | "forbidden" | "not found" | null): Response {
  if (!bot) return problem(401, NOT_SIGNED_IN);
  if (bot === "forbidden") return problem(403, FORBIDDEN);
  if (bot === "not found") return problem(404, "Not found");
  return Response.json({ bot } satisfies BotAnswer, { headers: PRIVATE });
}

/**
 * Refuses a webhook URL that isn't an http or https URL with a host, which a webhook couldn't deliver
 * to, where ember-rust saves whatever the form sends.
 */
function withWebAddress<T extends { webhookUrl?: string }>(changes: T | string): T | string {
  if (typeof changes === "string" || !changes.webhookUrl) return changes;
  const url = URL.parse(changes.webhookUrl);
  return (url?.protocol === "http:" || url?.protocol === "https:") && url.hostname ? changes : "Webhook URL must be an http or https URL";
}
