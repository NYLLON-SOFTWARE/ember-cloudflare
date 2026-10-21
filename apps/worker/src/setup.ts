import { isPasswordTooLong, isPasswordTooShort, parseSignUp, PASSWORD_TOO_LONG, PASSWORD_TOO_SHORT, type NewWorkspace, type SetupPlaceholders } from "@ember/protocol";
import { clientOf, newSessionToken, sessionCookie, tokenDigest } from "./auth";
import { userFormOf, userFormPhoto } from "./avatars";
import type { Env } from "./env";
import { notFound } from "./error-pages";
import { appPage, empty, formAnswer, home, signUpRefusal } from "./pages";
import { passwordHasher } from "./passwords";
import { workspace } from "./workspace";

// First run, which creates the workspace and its first administrator. Ported from ember-rust's
// crates/ember/src/controllers/first_runs.rs, path for path, except that the form posts to
// /api/first_run. Setup is open to whoever opens it first, as in Campfire and as ember-rust's is
// without a setup token: Ember leaves out ember-rust's private setup link (first_runs/access.rs),
// whose lock got in the way of setting a deployment up.

/**
 * What the Set up Ember form suggests, as `/api/bootstrap` tells the app: the deployment's own name and
 * email address, else Kevin Rose's, in place of ember-rust's Jane Cooper (first_runs/show.html). A blank
 * setting counts as unset.
 */
export const setupPlaceholdersOf = (env: Env): SetupPlaceholders => ({
  name: env.EMBER_SETUP_NAME_PLACEHOLDER?.trim() || "Kevin Rose",
  emailAddress: env.EMBER_SETUP_EMAIL_PLACEHOLDER?.trim() || "kevin@kevinrose.com",
});

const isSetUp = async (env: Env) => (await workspace(env).account()) !== null;

/** `/first_run`: the Set up Ember page, which is the app's own, until the workspace exists. */
async function setupForm(request: Request, env: Env, format: string | undefined): Promise<Response> {
  // ember-rust's `prevent_repeats`: once the workspace exists, setup sends everyone home.
  if (await isSetUp(env)) return home(request);
  // The form is a page, like ember-rust's, which answers 406 for `/first_run.json`.
  if (format !== undefined) return empty(406);
  const page = await appPage(request, env, "/");
  page.headers.set("Cache-Control", "no-store");
  return page;
}

/** Whether `pathname` is one of setup's pages: /first_run, anything under /first_run/, or /first_run.<format>. */
export const isSetupPath = (pathname: string) => /^\/first_run(?:$|[/.])/.test(pathname);

/** Answers a request for one of setup's pages. */
export async function setupPage(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const form = pathname.match(/^\/first_run(?:\.(.+))?$/);
  if (form && (request.method === "GET" || request.method === "HEAD")) return setupForm(request, env, form[1]);
  return notFound(request);
}

/**
 * `POST /api/first_run`: creates the workspace with the person the Set up Ember form describes as its
 * first administrator, with the photo it brings, and signs this browser in as them.
 */
export async function firstRun(request: Request, env: Env): Promise<Response> {
  const setUp = { error: "Ember is already set up", redirect: "/" };
  if (await isSetUp(env)) return formAnswer(setUp, 409);

  const sent = await userFormOf(request);
  if ("error" in sent) return formAnswer({ error: sent.error, field: "avatar" }, sent.status);
  const form = parseSignUp(sent.fields);
  if (typeof form === "string") return signUpRefusal(form);
  // Before anything is hashed or saved, as in ember-rust. Unlike bcrypt, which ignores all but a
  // password's first 72 bytes, PBKDF2 hashes every character, so the server takes no more than the
  // form can send.
  if (isPasswordTooLong(form.password)) return formAnswer({ error: PASSWORD_TOO_LONG, field: "password" }, 422);
  if (isPasswordTooShort(form.password)) return formAnswer({ error: PASSWORD_TOO_SHORT, field: "password" }, 422);
  const avatar = await userFormPhoto(env, sent.photo);
  if (avatar && "error" in avatar) return formAnswer({ error: avatar.error, field: "avatar" }, avatar.status);

  const passwordDigest = await passwordHasher(env).hash(form.password);
  const token = newSessionToken();
  const administrator = { name: form.name, emailAddress: form.emailAddress, passwordDigest, avatar };
  const created = await workspace(env).createWorkspace(administrator, await tokenDigest(token, env.SESSION_SECRET), clientOf(request));
  // Another first run finished first. Like ember-rust, send this one home without signing it in.
  if (!created) return formAnswer(setUp, 409);
  return formAnswer(created satisfies NewWorkspace, 201, sessionCookie(request, token));
}
