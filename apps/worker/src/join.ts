import {
  isPasswordTooLong,
  isPasswordTooShort,
  JOINING_PROBLEMS,
  MEMBERFUL_SIGN_IN_NEEDED,
  parseOpenSignUp,
  parseSignUp,
  PASSWORD_TOO_LONG,
  PASSWORD_TOO_SHORT,
  signInSaying,
  SIGN_UP_FULL,
  SIGN_UP_LIMITED,
  signsUpOpenly,
  TURNSTILE_FAILED,
  type JoiningProblem,
  type Me,
  type SignUp,
} from "@ember/protocol";
import { authenticate, clientOf, newSessionToken, sessionCookie, tokenDigest } from "./auth";
import { userFormOf, userFormPhoto } from "./avatars";
import type { Env } from "./env";
import { appPage, empty, formAnswer, home, signInFirst, signUpRefusal } from "./pages";
import { passwordHasher } from "./passwords";
import { passedTurnstile, turnstileKeysOf } from "./turnstile";
import { workspace } from "./workspace";
import type { NewPerson } from "./workspace-store";

// Joining with the workspace's join link, ported from ember-rust's crates/ember/src/controllers/users.rs
// (`new` and `create`), except that the form posts to /api/join/<code>. Where ember-rust fails with
// 500 before first run, there's no join code to match yet, so every link is a 404. An administrator
// can turn the link off, and while Memberful is members only (memberful.ts) it's off too: either
// way it sends people to sign in. Signing up at /join, with no code, is this port's own: anyone may
// while an administrator lets them (`auth.open-sign-up`), within its limits, and with Turnstile's check
// while the deployment has its keys.

/** What the join form answers while Memberful is members only: why, and where to go instead. */
const MEMBERFUL_INSTEAD = {
  error: MEMBERFUL_SIGN_IN_NEEDED,
  redirect: "/session/new",
};

/** What a form for joining answers while its way in is off: why, and the sign-in page, which says so. */
const signInInsteadOf = (problem: JoiningProblem) => ({ error: JOINING_PROBLEMS[problem], redirect: signInSaying(problem) });

/** Sends the browser to sign in, saying why it can't join here. */
const signInSayingWhy = (request: Request, problem: JoiningProblem) =>
  new Response(null, { status: 302, headers: { Location: new URL(signInSaying(problem), request.url).href } });

/**
 * The join code in a join link's path, `/join/<code>`, or null if `pathname` isn't one. Codes are
 * letters, digits and dashes, which nothing percent-encodes, so the path holds them as they are.
 */
export const joinCodeOf = (pathname: string) => pathname.match(/^\/join\/([^/]+)$/)?.[1] ?? null;

/**
 * `GET /join/<code>`: the join page, which is the app's own, for someone signed out with the current
 * code, unless Memberful is members only, or the link is off, when it sends them to sign in.
 */
export async function joinPage(request: Request, env: Env, code: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return empty(404);
  // ember-rust's require_unauthenticated_access comes first: someone signed in goes home.
  const [session, link] = await Promise.all([authenticate(request, env), workspace(env).joinLink(code)]);
  if (session) return home(request);
  if (link === "not found") return empty(404);
  if (link === "memberful") return signInFirst(request);
  if (link === "off") return signInSayingWhy(request, "link_off");
  return pageForJoining(request, env);
}

/**
 * `GET /join`: the join page without a code, for someone signed out while anyone may sign up, or else
 * sign-in, which says signing up is closed. Its policy lets Turnstile's check load, while the
 * deployment has Turnstile's keys.
 */
export async function signUpPage(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return empty(404);
  const [session, account] = await Promise.all([authenticate(request, env), workspace(env).account()]);
  if (session) return home(request);
  if (account === null || !signsUpOpenly(account)) return signInSayingWhy(request, "closed");
  return pageForJoining(request, env, turnstileKeysOf(env) !== null);
}

/** The app's page for joining, which no cache keeps, since what it shows depends on the workspace's switches. */
async function pageForJoining(request: Request, env: Env, turnstile = false): Promise<Response> {
  const page = await appPage(request, env, "/", { turnstile });
  page.headers.set("Cache-Control", "no-store");
  return page;
}

/**
 * `POST /api/join/<code>`: adds the person the join form describes as a member, in every open room,
 * with the photo it brings, and signs this browser in as them. Someone whose email address is taken
 * goes to sign in with it filled in, and nothing is created. While the link is off, or members sign in
 * with Memberful, it answers 403 before the form is read, and sends them to sign in.
 */
export async function join(request: Request, env: Env, code: string): Promise<Response> {
  const [session, link] = await Promise.all([authenticate(request, env), workspace(env).joinLink(code)]);
  if (session) return signedInAlready();
  if (link === "not found") return formAnswer({ error: "Not found" }, 404);
  if (link === "memberful") return formAnswer(MEMBERFUL_INSTEAD, 403);
  if (link === "off") return formAnswer(signInInsteadOf("link_off"), 403);

  const sent = await userFormOf(request);
  if ("error" in sent) return formAnswer({ error: sent.error, field: "avatar" }, sent.status);
  const form = parseSignUp(sent.fields);
  if (typeof form === "string") return signUpRefusal(form);
  const refusal = passwordRefusal(form.password);
  if (refusal) return refusal;
  const person = await personOf(env, form, sent.photo);
  if (person instanceof Response) return person;

  const token = newSessionToken();
  const user = await workspace(env).join(code, person, await tokenDigest(token, env.SESSION_SECRET), clientOf(request));
  if (user === "not found") return formAnswer({ error: "Not found" }, 404);
  if (user === "memberful") return formAnswer(MEMBERFUL_INSTEAD, 403);
  if (user === "off") return formAnswer(signInInsteadOf("link_off"), 403);
  if (!user) return emailAddressTaken(form.emailAddress);
  return formAnswer({ user } satisfies { user: Me }, 201, sessionCookie(request, token));
}

/**
 * `POST /api/join`: adds the person the open sign-up form describes, as `join` adds someone with the
 * join link, while anyone may sign up, and else answers 403 before the form is read, sending them to
 * sign in. Turnstile's check comes first, while the deployment has its keys, and else the limits that
 * stand in for it, all before the photo is stored or the password hashed: past the limit from the
 * address, or once the workspace's new people for the hour have filled it, it answers 429.
 */
export async function signUp(request: Request, env: Env): Promise<Response> {
  const [session, account] = await Promise.all([authenticate(request, env), workspace(env).account()]);
  if (session) return signedInAlready();
  if (account === null || !signsUpOpenly(account)) return formAnswer(signInInsteadOf("closed"), 403);

  const sent = await userFormOf(request);
  if ("error" in sent) return formAnswer({ error: sent.error, field: "avatar" }, sent.status);
  const form = parseOpenSignUp(sent.fields);
  if (typeof form === "string") return signUpRefusal(form);
  const refusal = passwordRefusal(form.password);
  if (refusal) return refusal;
  const client = clientOf(request);
  const turnstile = turnstileKeysOf(env);
  if (turnstile && !(await passedTurnstile(turnstile.secretKey, form.turnstileToken, client.ip))) {
    return formAnswer({ error: TURNSTILE_FAILED, field: "turnstile" }, 422);
  }
  // Turnstile's check stops the scripts the limits guard against, so they hold only without its keys.
  const limited = turnstile === null;
  const begun = await workspace(env).beginSignUp(client.ip ?? "unknown", form.emailAddress, limited);
  if (begun !== "begun") return signUpRefused(begun, form.emailAddress);
  const person = await personOf(env, form, sent.photo);
  if (person instanceof Response) return person;

  const token = newSessionToken();
  const user = await workspace(env).signUp(person, await tokenDigest(token, env.SESSION_SECRET), client, limited);
  if (user === "closed" || user === "full") return signUpRefused(user, form.emailAddress);
  if (!user) return emailAddressTaken(form.emailAddress);
  return formAnswer({ user } satisfies { user: Me }, 201, sessionCookie(request, token));
}

/** What a form for joining answers someone signed in: go home, as ember-rust's require_unauthenticated_access sends them. */
const signedInAlready = () => formAnswer({ error: "You're signed in already", redirect: "/" }, 409);

/** Why a sign-up's password is refused, as first run refuses it, though ember-rust takes any here, even an empty one, which makes an account nobody can sign in to. */
function passwordRefusal(password: string): Response | null {
  if (isPasswordTooLong(password)) return formAnswer({ error: PASSWORD_TOO_LONG, field: "password" }, 422);
  if (isPasswordTooShort(password)) return formAnswer({ error: PASSWORD_TOO_SHORT, field: "password" }, 422);
  return null;
}

/** The person `form` describes, ready to be added, with the photo `photo` brings stored and their password hashed, or the answer refusing the photo. */
async function personOf(env: Env, form: SignUp, photo: FormData | null): Promise<Omit<NewPerson, "id"> | Response> {
  const avatar = await userFormPhoto(env, photo);
  if (avatar && "error" in avatar) return formAnswer({ error: avatar.error, field: "avatar" }, avatar.status);
  const passwordDigest = await passwordHasher(env).hash(form.password);
  return { name: form.name, emailAddress: form.emailAddress, passwordDigest, avatar };
}

/** What a form for joining answers for an email address that has an account: sign in with it, filled in. */
function emailAddressTaken(emailAddress: string): Response {
  const signIn = `/session/new?${new URLSearchParams({ email_address: emailAddress })}`;
  return formAnswer({ error: "That email address has an account already", redirect: signIn }, 409);
}

/** What open sign-up answers when it can't go on. */
function signUpRefused(why: "closed" | "limited" | "full" | "taken", emailAddress: string): Response {
  if (why === "closed") return formAnswer(signInInsteadOf("closed"), 403);
  if (why === "taken") return emailAddressTaken(emailAddress);
  return formAnswer({ error: why === "limited" ? SIGN_UP_LIMITED : SIGN_UP_FULL }, 429);
}
