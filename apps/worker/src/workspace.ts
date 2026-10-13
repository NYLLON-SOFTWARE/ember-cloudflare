import { DurableObject } from "cloudflare:workers";
import { openDb, type Db } from "./db";
import type { Env } from "./env";

/**
 * What a workspace shares across its rooms. There is one, and every request reaches it by name; its
 * tables live in its own SQLite storage, or in D1 with everyone else's. For now it only answers the
 * health check, and the account, people, sessions and room list come next.
 */
export class Workspace extends DurableObject<Env> {
  private readonly db: Db;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = openDb(env, ctx.storage, "workspace");
  }

  /** Resolves once the workspace's database answers a query. */
  async health(): Promise<void> {
    await this.db.all("SELECT 1");
  }
}

export const workspace = (env: Env) => env.WORKSPACE.getByName("workspace");
