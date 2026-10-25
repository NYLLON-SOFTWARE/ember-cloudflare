import type { Env } from "./env";

// Cloudflare Turnstile on the open sign-up form (`auth.open-sign-up`), while the deployment has its
// keys: the page shows Turnstile's check, which gives it a token, and the Worker asks Cloudflare's
// siteverify whether the token is from a check that passed before it does anything else with the form
// (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). A token is good
// once, for 5 minutes. Siteverify's answers are logged by their error codes alone.

/** Where Cloudflare says whether a check passed. */
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** How long siteverify has to answer. */
const TURNSTILE_TIMEOUT_MS = 10_000;

/** The keys of the deployment's Turnstile widget. */
export interface TurnstileKeys {
  /** The public one, which pages show the check with. */
  siteKey: string;
  secretKey: string;
}

/** The deployment's Turnstile keys, or null unless it has both. */
export function turnstileKeysOf(env: Env): TurnstileKeys | null {
  const [siteKey, secretKey] = [env.TURNSTILE_SITE_KEY?.trim(), env.TURNSTILE_SECRET_KEY?.trim()];
  return siteKey && secretKey ? { siteKey, secretKey } : null;
}

/**
 * Whether Cloudflare says `token` is from a check that passed on the widget whose secret key is
 * `secretKey`, done from `ip` if that's known. No token, or siteverify not answering as it should,
 * counts as a check that didn't pass.
 */
export async function passedTurnstile(secretKey: string, token: string | undefined, ip: string | null): Promise<boolean> {
  if (!token) return false;
  try {
    const answer = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: secretKey, response: token, ...(ip && { remoteip: ip }) }),
      redirect: "manual",
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
    const outcome: unknown = answer.ok ? await answer.json() : null;
    if (isOutcome(outcome) && outcome.success === true) return true;
    console.warn("Turnstile's check didn't pass:", answer.status, isOutcome(outcome) ? outcome["error-codes"] : "unreadable answer");
    return false;
  } catch (error) {
    console.error("Asking Turnstile whether a check passed failed:", error instanceof Error ? error.name : "unknown error");
    return false;
  }
}

/** What siteverify answers, as far as the Worker reads it. */
interface Outcome {
  success?: unknown;
  "error-codes"?: unknown;
}

const isOutcome = (value: unknown): value is Outcome => typeof value === "object" && value !== null && !Array.isArray(value);
