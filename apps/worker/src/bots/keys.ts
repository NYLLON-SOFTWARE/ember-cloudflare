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
