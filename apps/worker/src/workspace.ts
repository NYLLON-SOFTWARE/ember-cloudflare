import { DurableObject } from "cloudflare:workers";
import type { User } from "@ember/protocol";
import { openDb, type Db } from "./db";
import type { Env } from "./env";
import { sortableId } from "./ids";
import { WorkspaceStore, type Client } from "./workspace-store";

/** How often a session's last activity, browser and IP are written, at most, as in ember-rust. */
export const SESSION_REFRESH_MS = 60 * 60 * 1000;

export interface Authenticated {
  user: User;
  /** Whether this request refreshed the session, so its cookie should be sent again. */
  refreshed: boolean;
}

/**
 * What a workspace shares across its rooms: for now its people and their sessions, and the account
 * and room list next. There is one, and every request reaches it by name; its tables live in its own
 * SQLite storage, or in D1 with everyone else's.
 */
export class Workspace extends DurableObject<Env> {
  private readonly db: Db;
  private readonly store: WorkspaceStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = openDb(env, ctx.storage, "workspace");
    this.store = new WorkspaceStore(this.db);
  }

  /** Resolves once the workspace's database answers a query. */
  async health(): Promise<void> {
    await this.db.all("SELECT 1");
  }

  /** Adds someone who signs in with just a name, and the session their cookie's token opens. */
  async signInGuest(name: string, tokenDigest: string, client: Client): Promise<User> {
    const user: User = { id: sortableId(), name };
    await this.store.createGuest(user, sortableId(), tokenDigest, client, new Date().toISOString());
    return user;
  }

  /** The person a session token's digest signs in, refreshing the session at most once an hour. */
  async authenticate(tokenDigest: string, client: Client): Promise<Authenticated | null> {
    const session = await this.store.findSession(tokenDigest);
    if (!session) return null;
    const now = Date.now();
    const refreshed = now - Date.parse(session.last_active_at) >= SESSION_REFRESH_MS;
    if (refreshed) await this.store.touchSession(session.session_id, client, new Date(now).toISOString());
    return { user: { id: session.user_id, name: session.name }, refreshed };
  }

  async signOut(tokenDigest: string): Promise<void> {
    await this.store.deleteSession(tokenDigest);
  }
}

export const workspace = (env: Env) => env.WORKSPACE.getByName("workspace");
