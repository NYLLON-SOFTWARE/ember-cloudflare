import {
  CANT_EMAIL_CODES,
  MEMBERFUL_CODE_NO_MEMBER,
  MEMBERFUL_CODE_UNCHECKED,
  MEMBERFUL_CODES_OFF,
  MEMBERFUL_SIGN_IN_PROBLEMS,
  parseMemberfulCodeRequest,
  parseMemberfulCodeSignIn,
  PASSWORD_RESET_CODE_DIGITS,
  PASSWORD_RESET_CODE_WRONG,
  PASSWORD_RESETS_LIMITED,
  SIGN_IN_LIMITED,
  TURNSTILE_FAILED,
  type MemberfulCodeSignedIn,
} from "@ember/protocol";
import { clientOf, newSessionToken, sessionCookie, tokenDigest } from "./auth";
import { jsonBodyOf } from "./bodies";
import type { Env } from "./env";
import { digits } from "./ids";
import { memberfulFor } from "./memberful";
import { memberfulApiOf } from "./memberful-api";
import { formAnswer } from "./pages";
import { passedTurnstile, turnstileKeysFor } from "./turnstile";
import { workspace, type NewResetCode } from "./workspace";

// Signing in with Memberful on Ember's own sign-in page, with a code Ember emails: a member gives the
// address their Memberful account has, Ember emails it a code once the site's admin API finds a member
// with it, and they give the code back, which signs them in as signing in on Memberful's page does,
// linked to their account there by the site and their member id. The code proves the address is
// theirs, as the link and code in Memberful's own sign-in email do, so no password is involved, and
// Memberful is asked who has the address only once it's proven. Asking checks Turnstile while Ember has
// a widget's keys, and neither answer, nor how soon it comes, says who's a member.

/**
 * What the Workspace keeps in place of a code: its HMAC under SESSION_SECRET, as a session token's is
 * kept, of the code named as one, so that no other secret's digest can stand for it.
 */
const memberfulCodeDigest = (code: string, env: Env) => tokenDigest(`memberful sign-in code ${code}`, env.SESSION_SECRET);

/** A new code for Ember to email: as many random digits as a code to reset a password has, and its digest. */
async function newMemberfulCode(env: Env): Promise<NewResetCode> {
  const code = digits(PASSWORD_RESET_CODE_DIGITS);
  return { code, digest: await memberfulCodeDigest(code, env) };
}

/** What asking the Memberful site's admin API takes, with the keys Ember has (`memberfulFor`), or null without its API key. */
const memberfulApiFor = async (env: Env) => memberfulApiOf(await memberfulFor(env));

/**
 * `POST /api/memberful_codes`, `{ emailAddress, turnstileToken? }`: emails a code to sign in with to the
 * address, once the Memberful site finds a member with it, answering 202 before Memberful is asked, and
 * whether or not it has one. Turnstile's check comes first, while Ember has a widget's keys, and else the
 * network's limit, which stands in for it. It answers 503 while Ember can't send email, and 403 while it
 * doesn't offer Sign in with Memberful, or lacks its site's API key.
 */
export async function askForMemberfulCode(request: Request, env: Env): Promise<Response> {
  const asked = parseMemberfulCodeRequest(await jsonBodyOf(request));
  if (typeof asked === "string") return formAnswer({ error: asked, field: "emailAddress" }, 422);
  const client = clientOf(request);
  const turnstile = await turnstileKeysFor(env);
  if (turnstile && !(await passedTurnstile(env, turnstile.secretKey, asked.turnstileToken, client.ip))) {
    return formAnswer({ error: TURNSTILE_FAILED, field: "turnstile" }, 422);
  }
  // Turnstile's check stops the scripts the network's limit guards against, so it holds only without its keys.
  const code = await newMemberfulCode(env);
  const outcome = await workspace(env).askForMemberfulCode(client.ip ?? "unknown", asked.emailAddress.trim(), code, await memberfulApiFor(env), turnstile === null);
  if (outcome === "unsendable") return formAnswer({ error: CANT_EMAIL_CODES }, 503);
  if (outcome === "off") return formAnswer({ error: MEMBERFUL_CODES_OFF }, 403);
  if (outcome === "limited") return formAnswer({ error: PASSWORD_RESETS_LIMITED }, 429);
  return formAnswer({}, 202);
}

/**
 * `PUT /api/memberful_codes`, `{ emailAddress, code }`: signs this browser in as the member of the
 * Memberful site who has the address, with the code Ember emailed it, spending it (201), as `{ joined:
 * true }` for someone new, who goes on to the welcome page. The code is checked, counting against
 * sign-in's limit, before Memberful is asked who has the address, and one that doesn't work answers 422
 * on its field, the same whoever has the address. Once it's right, it answers 403 with why signing in
 * with Memberful refuses them, as Memberful's page's sign-in would, on the password field for someone
 * here with the address already, whose password connects it, 422 once nobody has the address, and 503
 * while Memberful can't be asked, which leaves the code working.
 */
export async function signInWithMemberfulCode(request: Request, env: Env): Promise<Response> {
  const given = parseMemberfulCodeSignIn(await jsonBodyOf(request));
  if ("error" in given) return formAnswer(given, given.field ? 422 : 400);
  const api = await memberfulApiFor(env);
  if (api === null) return formAnswer({ error: MEMBERFUL_CODES_OFF }, 403);
  const client = clientOf(request);
  const token = newSessionToken();
  const [codeDigest, digest] = await Promise.all([memberfulCodeDigest(given.code, env), tokenDigest(token, env.SESSION_SECRET)]);
  const outcome = await workspace(env).signInWithMemberfulCode(client.ip ?? "unknown", given.emailAddress.trim(), codeDigest, api, digest, client);
  if (outcome === "limited") return formAnswer({ error: SIGN_IN_LIMITED }, 429);
  if (outcome === "wrong") return formAnswer({ error: PASSWORD_RESET_CODE_WRONG, field: "code" }, 422);
  if (outcome === "nobody") return formAnswer({ error: MEMBERFUL_CODE_NO_MEMBER, field: "emailAddress" }, 422);
  if (outcome === "unchecked") return formAnswer({ error: MEMBERFUL_CODE_UNCHECKED }, 503);
  // Someone new chooses how people here see them first.
  if (outcome === "joined") return formAnswer({ joined: true } satisfies MemberfulCodeSignedIn, 201, sessionCookie(request, token));
  // Someone here has the address already, whose password connects their Memberful account, as on Memberful's page.
  if (outcome === "taken") return formAnswer({ error: MEMBERFUL_SIGN_IN_PROBLEMS.taken, field: "password" }, 403);
  if (typeof outcome === "string") return formAnswer({ error: MEMBERFUL_SIGN_IN_PROBLEMS[outcome] }, 403);
  return formAnswer({ user: outcome } satisfies MemberfulCodeSignedIn, 201, sessionCookie(request, token));
}
