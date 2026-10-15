import { isPasswordTooLong, isPasswordTooShort, parsePasswordReset } from "@ember/protocol";
import type { Env } from "./env";
import { passwordHasher } from "./passwords";
import { workspace } from "./workspace";

// Password recovery, which ember-rust does with `ember reset-password <email>` beside its database
// (crates/ember/src/admin.rs), run by emberctl's `reset-password` (deploy/installer/emberctl.py). A
// Worker has no shell beside its data, so here it's an endpoint behind a secret of its own, which
// apps/worker/scripts/reset-password.ts calls as emberctl calls `ember`.

/** The recovery endpoint's address. */
export const RECOVERY_PATH = "/api/recovery/reset-password";

/** EMBER_RECOVERY_TOKEN's shape, as EMBER_SETUP_TOKEN's: 32 random bytes as hex, from `openssl rand -hex 32`. */
const RECOVERY_TOKEN = /^[0-9a-f]{64}$/;

/** What emberctl says once it's done, since the endpoint closes the person's live connections as emberctl's restart does. */
const PASSWORD_RESET = "Password updated; existing sessions and live connections for this user were revoked.";

const encoder = new TextEncoder();
const sha256 = (text: string) => crypto.subtle.digest("SHA-256", encoder.encode(text));
const problem = (status: number, message: string) => Response.json({ error: message }, { status });

/**
 * Whether the request's bearer token is EMBER_RECOVERY_TOKEN, compared by SHA-256 so the comparison
 * takes the same time whatever it carries. Never while the secret is unset, or set to something that
 * can't be a token.
 */
async function carriesRecoveryToken(request: Request, env: Env): Promise<boolean> {
  const token = env.EMBER_RECOVERY_TOKEN;
  if (token === undefined) return false;
  if (!RECOVERY_TOKEN.test(token)) {
    // Never the value, which may be most of a real token.
    console.error("EMBER_RECOVERY_TOKEN must be 64 lowercase hex characters (openssl rand -hex 32), so password recovery is refused");
    return false;
  }
  const given = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1] ?? "";
  const [expected, actual] = await Promise.all([sha256(token), sha256(given)]);
  return crypto.subtle.timingSafeEqual(expected, actual);
}

/**
 * `POST /api/recovery/reset-password`, with EMBER_RECOVERY_TOKEN as its bearer token: gives whoever has
 * the email address the body names the body's password, as `ember reset-password` does, ending their
 * sessions and closing their live connections, as emberctl's restart does. Anything without the token
 * answers 404, as an address the API doesn't have does, so a deployment doesn't say whether it has a
 * recovery door, and one without EMBER_RECOVERY_TOKEN has none.
 */
export async function resetPassword(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST" || !(await carriesRecoveryToken(request, env))) return problem(404, "Not found");
  const reset = parsePasswordReset(await request.json().catch(() => null));
  if (typeof reset === "string") return problem(400, reset);
  // Before anything is hashed or read, as in ember-rust, which takes up to 4096 bytes. Sign-in takes no
  // more than its form sends, so neither does this.
  if (isPasswordTooShort(reset.password)) return problem(422, "password must contain at least 8 characters");
  if (isPasswordTooLong(reset.password)) return problem(422, "password must contain at most 72 characters");

  const outcome = await workspace(env).resetPassword(reset.emailAddress, await passwordHasher(env).hash(reset.password));
  if (outcome === "not found") return problem(404, "no user has that email address");
  if (outcome === "bot") return problem(422, "bots cannot sign in with a password");
  return Response.json({ message: PASSWORD_RESET });
}
