import { isPasswordTooLong, MEMBERFUL_SIGN_IN_NEEDED, parseSignUp, PASSWORD_TOO_LONG, type Me } from "@ember/protocol";
import { authenticate, clientOf, newSessionToken, sessionCookie, tokenDigest } from "./auth";
import { userFormOf, userFormPhoto } from "./avatars";
import type { Env } from "./env";
import { appPage, empty, formAnswer, home, signInFirst, signUpRefusal } from "./pages";
import { passwordHasher } from "./passwords";
import { workspace } from "./workspace";

// Joining with the workspace's join link, ported from ember-rust's crates/ember/src/controllers/users.rs
// (`new` and `create`), except that the form posts to /api/join/<code>. Where ember-rust fails with
// 500 before first run, there's no join code to match yet, so every link is a 404. While members sign in
// with Memberful (memberful.ts), the join link is off, and sends people to sign in.

/** What the join form answers while the join link is off: why, and where to go instead. */
const MEMBERFUL_INSTEAD = {
  error: MEMBERFUL_SIGN_IN_NEEDED,
  redirect: "/session/new",
};

/** Rails' message for a blank password, which ember-rust's form doesn't let anyone send. */
const PASSWORD_BLANK = "Password can't be blank.";

/**
 * The join code in a join link's path, `/join/<code>`, or null if `pathname` isn't one. Codes are
 * letters, digits and dashes, which nothing percent-encodes, so the path holds them as they are.
 */
export const joinCodeOf = (pathname: string) => pathname.match(/^\/join\/([^/]+)$/)?.[1] ?? null;

/**
 * `GET /join/<code>`: the join page, which is the app's own, for someone signed out with the current
 * code, unless members sign in with Memberful, when it sends them to sign in.
 */
export async function joinPage(request: Request, env: Env, code: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return empty(404);
  // ember-rust's require_unauthenticated_access comes first: someone signed in goes home.
  const [session, link] = await Promise.all([authenticate(request, env), workspace(env).joinLink(code)]);
  if (session) return home(request);
  if (link === "not found") return empty(404);
  if (link === "memberful") return signInFirst(request);
  const page = await appPage(request, env, "/");
  page.headers.set("Cache-Control", "no-store");
  return page;
}

/**
 * `POST /api/join/<code>`: adds the person the join form describes as a member, in every open room,
 * with the photo it brings, and signs this browser in as them. Someone whose email address is taken
 * goes to sign in with it filled in, and nothing is created. While members sign in with Memberful, it
 * answers 403 before the form is read, and sends them to sign in.
 */
export async function join(request: Request, env: Env, code: string): Promise<Response> {
  const [session, link] = await Promise.all([authenticate(request, env), workspace(env).joinLink(code)]);
  if (session) return formAnswer({ error: "You're signed in already", redirect: "/" }, 409);
  if (link === "not found") return formAnswer({ error: "Not found" }, 404);
  if (link === "memberful") return formAnswer(MEMBERFUL_INSTEAD, 403);

  const sent = await userFormOf(request);
  if ("error" in sent) return formAnswer({ error: sent.error, field: "avatar" }, sent.status);
  const form = parseSignUp(sent.fields);
  if (typeof form === "string") return signUpRefusal(form);
  // Unlike ember-rust, which takes an empty password and makes an account nobody can sign in to. A
  // long one is refused for the reason first run's is.
  if (form.password === "") return formAnswer({ error: PASSWORD_BLANK, field: "password" }, 422);
  if (isPasswordTooLong(form.password)) return formAnswer({ error: PASSWORD_TOO_LONG, field: "password" }, 422);
  const avatar = await userFormPhoto(env, sent.photo);
  if (avatar && "error" in avatar) return formAnswer({ error: avatar.error, field: "avatar" }, avatar.status);

  const passwordDigest = await passwordHasher(env).hash(form.password);
  const token = newSessionToken();
  const person = {
    name: form.name,
    emailAddress: form.emailAddress,
    passwordDigest,
    avatar,
  };
  const user = await workspace(env).join(code, person, await tokenDigest(token, env.SESSION_SECRET), clientOf(request));
  if (user === "not found") return formAnswer({ error: "Not found" }, 404);
  if (user === "memberful") return formAnswer(MEMBERFUL_INSTEAD, 403);
  if (!user) {
    const signIn = `/session/new?${new URLSearchParams({ email_address: form.emailAddress })}`;
    return formAnswer({ error: "That email address has an account already", redirect: signIn }, 409);
  }
  return formAnswer({ user } satisfies { user: Me }, 201, sessionCookie(request, token));
}
