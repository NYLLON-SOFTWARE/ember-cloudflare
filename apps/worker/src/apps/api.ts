import { APP_CHANGED, APPS_FORBIDDEN, APPS_FULL, parseAppChanges, parseNewApp, type App, type AppAnswer, type AppId, type Apps } from "@ember/protocol/apps";
import { ASSISTANT_OFF } from "@ember/protocol/assistant";
import { administratorOf } from "../assistant/settings";
import { credentialsOf } from "../auth";
import { jsonBodyOf } from "../bodies";
import type { Env } from "../env";
import { notFound } from "../error-pages";
import { anyOtherPage, formAnswer } from "../pages";
import { workspace } from "../workspace";
import { appConnector } from "./connector";

// Apps, as administrators connect, change and disconnect them on the AI assistant tab of workspace
// settings: MCP servers, each with the tools Ember read from it, which the AI agents may be given. They
// answer JSON for the tab and each app's page.

const problem = (status: number, message: string) => Response.json({ error: message }, { status });

const NOT_SIGNED_IN = "Not signed in";
/** What's said of apps is for administrators, which no cache should keep. */
const PRIVATE = { "Cache-Control": "no-store" };

/**
 * An app's page, `/account/apps/<id>/edit`: Campfire's 404 page for an administrator when `id` isn't a
 * connected app's, and otherwise the app's page, which sends anyone signed out to sign in, anyone else
 * to workspace settings, and anyone while Ember AI is off to the AI assistant tab.
 */
export async function appPage(request: Request, env: Env, pathname: string, appId: AppId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const found = credentials && (await workspace(env).connectedApp(credentials, appId));
  return found === "not found" ? notFound(request) : anyOtherPage(request, env, pathname);
}

/** `GET /api/account/apps`: the connected apps, by name, as the AI assistant tab lists them while Ember AI is on. */
export async function listApps(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const apps = credentials && (await workspace(env).connectedApps(credentials));
  if (!apps || typeof apps === "string") return refused(apps);
  return Response.json({ apps } satisfies Apps, { headers: PRIVATE });
}

/** `GET /api/account/apps/:id`: the connected app `id`, as its page shows it. */
export async function showApp(request: Request, env: Env, appId: AppId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  return appAnswer(credentials && (await workspace(env).connectedApp(credentials, appId)));
}

/**
 * `POST /api/account/apps`, `{ name, url, token? }`: connects the MCP server at `url`, once Ember has
 * read its tools there, with the token, if one's given, answering 201 with the app as its page shows
 * it. Someone who isn't an administrator hears so before anything they sent is read, and Ember AI being
 * off, or as many apps as there can be, is refused before the server is asked. A field that can't be
 * what it's for, or that the server refuses, is refused on that field.
 */
export async function connectApp(request: Request, env: Env): Promise<Response> {
  const credentials = await administratorOf(request, env, APPS_FORBIDDEN);
  if (credentials instanceof Response) return credentials;
  const app = parseNewApp(await jsonBodyOf(request));
  if ("error" in app) return formAnswer(app, 422);
  const ember = workspace(env);
  const slot = await ember.appSlot(credentials);
  if (slot !== true) return refused(slot);
  const read = await appConnector(env).read(app.url, app.token ?? null);
  if ("error" in read) return formAnswer(read, 422);
  return appAnswer(await ember.connectApp(credentials, app, read), 201);
}

/**
 * `PATCH /api/account/apps/:id`, with any of `{ name, url, token }`, "" for no token: changes the
 * connected app `id`, answering it as its page then shows it. Another address or token has Ember read
 * the server's tools again first, there or with it, so that neither is saved unless the server answers.
 * As with connecting one, someone who isn't an administrator hears so first, then that Ember AI is off,
 * then that there's no such app, before anything that was sent is read.
 */
export async function changeApp(request: Request, env: Env, appId: AppId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const ember = workspace(env);
  const access = credentials && (await ember.appAccess(credentials, appId));
  if (!credentials || !access) return refused(null);
  if (typeof access === "string") return refused(access);
  const changes = parseAppChanges(await jsonBodyOf(request));
  if ("error" in changes) return formAnswer(changes, 422);
  const url = changes.url ?? access.url;
  const token = changes.token === undefined ? access.token : changes.token === "" ? null : changes.token;
  if (url === access.url && token === access.token) return appAnswer(await ember.changeApp(credentials, appId, changes, null));
  const read = await appConnector(env).read(url, token);
  if ("error" in read) return formAnswer(read, 422);
  return appAnswer(await ember.changeApp(credentials, appId, changes, { read, askedAt: access }));
}

/**
 * `POST /api/account/apps/:id/tools`: reads the connected app `id`'s tools from its server again,
 * answering it as its page then shows it, or why Ember couldn't read them, which leaves the app as it was.
 */
export async function readAppTools(request: Request, env: Env, appId: AppId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const ember = workspace(env);
  const access = credentials && (await ember.appAccess(credentials, appId));
  if (!credentials || !access) return refused(null);
  if (typeof access === "string") return refused(access);
  const read = await appConnector(env).read(access.url, access.token);
  if ("error" in read) return problem(422, read.error);
  return appAnswer(await ember.changeApp(credentials, appId, {}, { read, askedAt: access }));
}

/** `DELETE /api/account/apps/:id`: disconnects the app `id`, answering 204. */
export async function disconnectApp(request: Request, env: Env, appId: AppId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const disconnected = credentials && (await workspace(env).disconnectApp(credentials, appId));
  if (!disconnected || disconnected !== "disconnected") return refused(disconnected);
  return new Response(null, { status: 204 });
}

/** Why a request about apps isn't done: there's no such app, or the person asking can't, or not now. */
type Refusal = "off" | "full" | "changed" | "not found" | "forbidden" | null;

/** What a request about an app answers: the app as its page then shows it, with `status`, or why it was refused. */
function appAnswer(app: App | Refusal, status = 200): Response {
  return typeof app === "object" && app !== null ? Response.json({ app } satisfies AppAnswer, { status, headers: PRIVATE }) : refused(app);
}

function refused(why: Refusal): Response {
  if (why === null) return problem(401, NOT_SIGNED_IN);
  if (why === "forbidden") return problem(403, APPS_FORBIDDEN);
  if (why === "not found") return problem(404, "Not found");
  return problem(409, why === "off" ? ASSISTANT_OFF : why === "changed" ? APP_CHANGED : APPS_FULL);
}
