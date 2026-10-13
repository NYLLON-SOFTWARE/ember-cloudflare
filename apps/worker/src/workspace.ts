import { DurableObject } from "cloudflare:workers";
import type { User } from "@ember/protocol";
import { openDb, type Db } from "./db";
import type { Env } from "./env";
import { sortableId } from "./ids";
import { SessionCache } from "./session-cache";
import { WorkspaceStore, type Client, type StoredSession } from "./workspace-store";

/** How often a session's last activity, browser and IP are written, at most, as in ember-rust. */
export const SESSION_REFRESH_MS = 60 * 60 * 1000;
/** How many sessions the Workspace keeps in memory: a few devices each for a large team. */
const CACHED_SESSIONS = 10_000;

/**
 * What a workspace shares across its rooms: for now its people and their sessions, and the account
 * and room list next. There is one, and every request reaches it by name; its tables live in its own
 * SQLite storage, or in D1 with everyone else's.
 */
export class Workspace extends DurableObject<Env> {
  private readonly db: Db;
  private readonly store: WorkspaceStore;
  private readonly sessions = new SessionCache<StoredSession>(CACHED_SESSIONS);

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
    const session: StoredSession = { id: sortableId(), user: { id: sortableId(), name }, guest: true, lastActiveAt: Date.now() };
    await this.store.createGuest(session.user, session.id, tokenDigest, client, new Date(session.lastActiveAt).toISOString());
    this.sessions.remember(tokenDigest, session);
    return session.user;
  }

  /**
   * The person a session token's digest signs in, refreshing the session's last activity at most once
   * an hour. Guests' sessions only count while `guests` says signing in with just a name is allowed.
   */
  async authenticate(tokenDigest: string, client: Client, guests: boolean): Promise<User | null> {
    const session = await this.sessions.get(tokenDigest, () => this.store.findSession(tokenDigest));
    if (!session || (session.guest && !guests)) return null;
    const now = Date.now();
    if (now - session.lastActiveAt >= SESSION_REFRESH_MS) {
      await this.store.touchSession(session.id, client, new Date(now).toISOString());
      session.lastActiveAt = now;
    }
    return session.user;
  }

  async signOut(tokenDigest: string): Promise<void> {
    await this.sessions.end(tokenDigest, () => this.store.deleteSession(tokenDigest));
  }
}

export const workspace = (env: Env) => env.WORKSPACE.getByName("workspace");
