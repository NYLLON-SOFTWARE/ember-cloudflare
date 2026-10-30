import {
  isPasswordTooLong,
  isPasswordTooShort,
  parseSignUp,
  PASSWORD_TOO_LONG,
  PASSWORD_TOO_SHORT,
  type NewWorkspace,
  type SetupAccess,
  type SetupPlaceholders,
} from "@ember/protocol";
import { clientOf, newSessionToken, sessionCookie, tokenDigest } from "./auth";
import { userFormOf, userFormPhoto } from "./avatars";
import type { Env } from "./env";
import { notFound } from "./error-pages";
import { isLoopbackHost } from "./headers";
import { appPage, empty, formAnswer, home, signUpRefusal } from "./pages";
import { passwordHasher } from "./passwords";
import { urlOf } from "./request-url";
import { bearerTokenOf, isSecretToken, isToken } from "./secrets";
import { workspace } from "./workspace";

// First run, which creates the workspace and its first administrator, at Campfire's paths, except that
// the form posts to /api/first_run. Whoever has the deploy's setup link sets Ember up, and nobody else:
// the link ends in the EMBER_SETUP_TOKEN secret that `pnpm run deploy` makes for a Worker
// (apps/worker/scripts/deploy.ts), which the Set up Ember page reads off the address's fragment and
// sends as the form's bearer token, so the first stranger to find a new deployment can't make themselves
// its administrator. There's no cookie, lock or expiry: setup closes once an administrator exists, which
// is all the link needs. Over loopback, where `wrangler dev` serves and nobody on the Internet can
// reach, a deployment without a token is open, as Campfire is.

/** What `POST /api/first_run` answers without the setup link's token. */
export const SETUP_LINK_NEEDED = "Open the setup link the deploy printed to set up Ember";
/** What it answers to a token that isn't this deployment's. */
export const SETUP_LINK_REFUSED = "This setup link isn't this deployment's. Open the one its latest deploy printed";
/** What it answers while the deployment has no setup token, which only a deploy, or `wrangler secret put`, gives it. */
export const NO_SETUP_TOKEN = "This deployment has no setup token, so nobody can set it up until a deploy makes one";

/**
 * What the Set up Ember form suggests, as `/api/bootstrap` tells the app: the deployment's own name and
 * email address, else Kevin Rose's. A blank setting counts as unset.
 */
export const setupPlaceholdersOf = (env: Env): SetupPlaceholders => ({
  name: env.EMBER_SETUP_NAME_PLACEHOLDER?.trim() || "Kevin Rose",
  emailAddress: env.EMBER_SETUP_EMAIL_PLACEHOLDER?.trim() || "kevin@kevinrose.com",
});

/** The deployment's setup token, or null where there's none, or it's set to something that can't be one. */
const setupTokenOf = (env: Env): string | null => (isSecretToken(env.EMBER_SETUP_TOKEN) ? env.EMBER_SETUP_TOKEN : null);

/** Whether EMBER_SETUP_TOKEN is set, but to something that can't be a token, which closes setup as if it were unset. */
const hasMalformedSetupToken = (env: Env) => !!env.EMBER_SETUP_TOKEN && !isSecretToken(env.EMBER_SETUP_TOKEN);

/**
 * How setup can be reached from `request`, as `/api/bootstrap` tells the app: with the deploy's setup
 * link, open to whoever is here (over loopback, with no token set), or closed until a deploy makes one.
 */
export function setupAccessOf(request: Request, env: Env): SetupAccess {
  if (setupTokenOf(env) !== null) return "link";
  return isLoopbackHost(request) ? "open" : "closed";
}

/** Why `request` may not set Ember up, or null where it carries the deploy's setup token, or setup is open to it. */
async function setupRefusal(request: Request, env: Env): Promise<Response | null> {
  const token = setupTokenOf(env);
  if (token === null) {
    if (isLoopbackHost(request)) return null;
    // Never the value, which may be most of a real token.
    if (hasMalformedSetupToken(env)) console.error("EMBER_SETUP_TOKEN must be 64 lowercase hex characters (openssl rand -hex 32), so setup is closed");
    return formAnswer({ error: NO_SETUP_TOKEN }, 403);
  }
  const given = bearerTokenOf(request);
  if (await isToken(given, token)) return null;
  return formAnswer({ error: given ? SETUP_LINK_REFUSED : SETUP_LINK_NEEDED }, 403);
}

const isSetUp = async (env: Env) => (await workspace(env).account()) !== null;

/** `/first_run`: the Set up Ember page, which is the app's own, until the workspace exists. */
async function setupForm(request: Request, env: Env, format: string | undefined): Promise<Response> {
  // Campfire's `prevent_repeats`: once the workspace exists, setup sends everyone home.
  if (await isSetUp(env)) return home(request);
  // The form is a page, which answers 406 for `/first_run.json`.
  if (format !== undefined) return empty(406);
  const page = await appPage(request, env, "/");
  page.headers.set("Cache-Control", "no-store");
  return page;
}

/** Whether `pathname` is one of setup's pages: /first_run, anything under /first_run/, or /first_run.<format>. */
export const isSetupPath = (pathname: string) => /^\/first_run(?:$|[/.])/.test(pathname);

/** Answers a request for one of setup's pages. */
export async function setupPage(request: Request, env: Env): Promise<Response> {
  const { pathname } = urlOf(request);
  const form = pathname.match(/^\/first_run(?:\.(.+))?$/);
  if (form && (request.method === "GET" || request.method === "HEAD")) return setupForm(request, env, form[1]);
  return notFound(request);
}

/**
 * `POST /api/first_run`: creates the workspace with the person the Set up Ember form describes as its
 * first administrator, with the photo it brings, and signs this browser in as them.
 */
export async function firstRun(request: Request, env: Env): Promise<Response> {
  // Before the form is read, let alone anything hashed or saved: only the deploy's setup link opens setup.
  const refused = await setupRefusal(request, env);
  if (refused) return refused;
  const setUp = { error: "Ember is already set up", redirect: "/" };
  if (await isSetUp(env)) return formAnswer(setUp, 409);

  const sent = await userFormOf(request);
  if ("error" in sent) return formAnswer({ error: sent.error, field: "avatar" }, sent.status);
  const form = parseSignUp(sent.fields);
  if (typeof form === "string") return signUpRefusal(form);
  // Before anything is hashed or saved. Unlike bcrypt, which ignores all but a password's first 72
  // bytes, scrypt hashes every character, so the server takes no more than the form can send.
  if (isPasswordTooLong(form.password)) return formAnswer({ error: PASSWORD_TOO_LONG, field: "password" }, 422);
  if (isPasswordTooShort(form.password)) return formAnswer({ error: PASSWORD_TOO_SHORT, field: "password" }, 422);
  const avatar = await userFormPhoto(env, sent.photo);
  if (avatar && "error" in avatar) return formAnswer({ error: avatar.error, field: "avatar" }, avatar.status);

  const passwordDigest = await passwordHasher(env).hash(form.password);
  const token = newSessionToken();
  const administrator = { name: form.name, emailAddress: form.emailAddress, passwordDigest, avatar };
  const created = await workspace(env).createWorkspace(administrator, await tokenDigest(token, env.SESSION_SECRET), clientOf(request));
  // Another first run finished first, so this one goes home without signing in.
  if (!created) return formAnswer(setUp, 409);
  return formAnswer(created satisfies NewWorkspace, 201, sessionCookie(request, token));
}
