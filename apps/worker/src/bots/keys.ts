import type { UserId } from "@ember/protocol";
import { alphanumeric } from "../ids";

// Bots' keys, as ember-rust makes them (`generate_bot_token` and `User#bot_key`, crates/db/src/models/user.rs).

/** A bot's token: 12 random letters and digits, as `SecureRandom.alphanumeric(12)` makes them. */
export const newBotToken = () => alphanumeric(12);

/**
 * A bot's key, which its API's addresses carry: its id, then its token, as `"#{id}-#{bot_token}"`. Ids
 * never have a "-" in them, so the first one ends the id. A bot without a token has one no key matches.
 */
export const botKeyOf = (botId: UserId, token: string | null) => `${botId}-${token ?? ""}`;

/**
 * The bot id and token a key names, as ember-rust's `User.authenticate_bot` reads one (user.rs) once
 * `allow_bot_access` has stripped it (concerns.rs): what comes before its first "-", and what comes
 * between that and the next. Null unless it has both, so a key without a token finds no bot.
 */
export function botKeyParts(key: string): { botId: UserId; token: string } | null {
  const [botId, token] = key.trim().split("-");
  return botId && token ? { botId, token } : null;
}

const encoder = new TextEncoder();

/** Whether `given` is the bot token `token`, compared in constant time. A bot without a token has none to give. */
export function isBotToken(given: string, token: string | null): boolean {
  if (!token) return false;
  const [a, b] = [encoder.encode(given), encoder.encode(token)];
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}
