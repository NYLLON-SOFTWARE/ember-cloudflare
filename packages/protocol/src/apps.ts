import type { UserId } from "./index.ts";

// Apps: the MCP servers an administrator connects, whose tools the AI agents may be given. An app is
// the address of a server that speaks the Model Context Protocol over Streamable HTTP
// (https://modelcontextprotocol.io), the token Ember sends it, if it takes one, and the tools Ember read
// from it when an administrator last looked.

/** An app's id, as its page's address names it. */
export type AppId = string;

/** The most apps a workspace connects. */
export const MAX_APPS = 10;

export const MAX_APP_NAME_LENGTH = 60;
export const MAX_APP_URL_LENGTH = 2048;
export const MAX_APP_TOKEN_LENGTH = 4096;

/** The most tools Ember reads from an app: the rest are left out, which its page says. */
export const MAX_APP_TOOLS = 100;

/** The most characters Ember keeps of a tool's description, which rides with every question its agents are asked. */
export const MAX_TOOL_DESCRIPTION_LENGTH = 1500;

export const APPS_FORBIDDEN = "Only administrators can connect apps";
export const APPS_FULL = `Ember connects at most ${MAX_APPS} apps. Remove one first.`;
export const APP_URL_REFUSED = "The address must be an https URL, or an http one on localhost";

/** A tool of an app's, as its server describes it: its name there, what it's called, if that's something else, and what it does. */
export interface AppTool {
  name: string;
  title: string | null;
  description: string;
}

/**
 * An app as its page shows it: its name, its server's address, whether Ember
 * sends a token, which it never shows again, what the server calls itself, the tools read from it, how
 * many more it has than Ember keeps, and who connected it, and when its tools were last read.
 */
export interface App {
  id: AppId;
  name: string;
  url: string;
  hasToken: boolean;
  serverName: string | null;
  tools: AppTool[];
  toolsLeftOut: number;
  toolsReadAt: string;
  connectedBy: { id: UserId; name: string } | null;
}

/** An app as the AI assistant tab lists it: its name, its server's address and how many tools Ember read from it. */
export interface AppSummary {
  id: AppId;
  name: string;
  url: string;
  toolCount: number;
}

/** What `GET /api/account/apps` answers: the apps, by name. */
export interface Apps {
  apps: AppSummary[];
}

/** What a request that makes or changes an app answers. */
export interface AppAnswer {
  app: App;
}

/** What `POST /api/account/apps` takes: the app's name, its server's address, and the token to send it, if it takes one. */
export interface NewApp {
  name: string;
  url: string;
  token?: string;
}

/**
 * What `PATCH /api/account/apps/<id>` changes: its name, its server's address, or its token, "" for
 * none. What's left out stays as it is.
 */
export interface AppChanges {
  name?: string;
  url?: string;
  token?: string;
}

/** Why a field of an app's form is refused. */
export interface AppRefused {
  error: string;
  field?: "name" | "url" | "token";
}

/**
 * Parses an untrusted change to an app, or says why it's refused: a name has more than spaces, an
 * address is a URL Ember may ask (`isAppUrl`), and a token is what a header can carry. The name and the
 * address are kept trimmed, and the token as it's given but for the spaces around it.
 */
export function parseAppChanges(data: unknown): AppChanges | AppRefused {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { error: "Expected a JSON object" };
  const { name, url, token } = data as Record<string, unknown>;
  const changes: AppChanges = {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) return { error: "Name can't be blank", field: "name" };
    if (name.trim().length > MAX_APP_NAME_LENGTH) return { error: `Name can't be longer than ${MAX_APP_NAME_LENGTH} characters`, field: "name" };
    changes.name = name.trim();
  }
  if (url !== undefined) {
    if (typeof url !== "string" || !url.trim()) return { error: "Address can't be blank", field: "url" };
    if (url.trim().length > MAX_APP_URL_LENGTH) return { error: `Address can't be longer than ${MAX_APP_URL_LENGTH} characters`, field: "url" };
    if (!isAppUrl(url.trim())) return { error: APP_URL_REFUSED, field: "url" };
    changes.url = url.trim();
  }
  if (token !== undefined) {
    if (typeof token !== "string") return { error: "Token must be text", field: "token" };
    if (token.trim().length > MAX_APP_TOKEN_LENGTH) return { error: `Token can't be longer than ${MAX_APP_TOKEN_LENGTH} characters`, field: "token" };
    // A header's value can't hold a line break or another control character.
    if (/[^\x20-\x7e]/.test(token.trim())) return { error: "Token can't have spaces between lines or characters a header can't carry", field: "token" };
    changes.token = token.trim();
  }
  return changes;
}

/** Parses an untrusted new app, as `parseAppChanges` does a change, which also needs a name and an address. */
export function parseNewApp(data: unknown): NewApp | AppRefused {
  const changes = parseAppChanges(data);
  if ("error" in changes) return changes;
  if (changes.name === undefined) return { error: "Name can't be blank", field: "name" };
  if (changes.url === undefined) return { error: "Address can't be blank", field: "url" };
  return { name: changes.name, url: changes.url, ...(changes.token && { token: changes.token }) };
}

/**
 * Whether Ember may ask an app at `address`: an https URL with a host, or an http one on this machine,
 * as a bot's webhook is, and without a name and password in it, which would be kept unsealed.
 */
export function isAppUrl(address: string): boolean {
  if (!URL.canParse(address)) return false;
  const { protocol, hostname, username, password } = new URL(address);
  if (hostname === "" || username !== "" || password !== "") return false;
  return protocol === "https:" || (protocol === "http:" && isLoopback(hostname));
}

// This package is typed without a platform's library, and every platform it runs on has URL.
declare const URL: { new (url: string): { readonly protocol: string; readonly hostname: string; readonly username: string; readonly password: string }; canParse(url: string): boolean };

/** localhost, its subdomains and the loopback addresses, where `wrangler dev` and the tests' stand-ins serve. */
const LOOPBACK_HOST = /^(?:(?:.+\.)?localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

const isLoopback = (hostname: string) => LOOPBACK_HOST.test(hostname);
