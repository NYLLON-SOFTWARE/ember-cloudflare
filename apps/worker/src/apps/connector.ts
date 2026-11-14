import { DurableObject } from "cloudflare:workers";
import type { AppRefused } from "@ember/protocol/apps";
import type { Env } from "../env";
import { callApp, readApp, type CalledTool, type ReadApp, type ReadTool } from "./mcp";

/**
 * Asks connected apps where there's CPU time for it, and subrequests of its own: reading what a server
 * with a hundred tools lists takes more than the 10 ms a Worker's request gets on Workers Free, where a
 * Durable Object's gets 30 seconds. It keeps nothing, so each ask runs in a new object of its own, as a
 * link's preview does.
 */
export class AppConnector extends DurableObject<Env> {
  /** `readApp`: the tools of the app at `url`, asked with `token`, or why Ember couldn't read them. */
  read(url: string, token: string | null): Promise<ReadApp | AppRefused> {
    return readApp(url, token);
  }

  /** `callApp`: what calling `tool` of the app at `url` with `input` came to, asked with `token`. */
  call(url: string, token: string | null, tool: Pick<ReadTool, "name" | "fingerprint">, input: Record<string, unknown>): Promise<CalledTool> {
    return callApp(url, token, tool, input);
  }
}

/** A new object to ask an app in. */
export const appConnector = (env: Env) => env.APP_CONNECTOR.get(env.APP_CONNECTOR.newUniqueId());
