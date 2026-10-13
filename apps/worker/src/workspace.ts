import { DurableObject } from "cloudflare:workers";
import { isRoomId, type NewRoom, type Room, type RoomId, type User } from "@ember/protocol";
import { openDb, type Db } from "./db";
import type { Env } from "./env";
import { sortableId } from "./ids";
import { SessionCache } from "./session-cache";
import { WorkspaceStore, type Client, type StoredSession } from "./workspace-store";

/** How often a session's last activity, browser and IP are written, at most, as in ember-rust. */
export const SESSION_REFRESH_MS = 60 * 60 * 1000;
/** How many sessions the Workspace keeps in memory: a few devices each for a large team. */
const CACHED_SESSIONS = 10_000;

/** What a request brings to say who it's from. */
export interface Credentials {
  /** The digest of the token in the request's session cookie. */
  tokenDigest: string;
  client: Client;
  /** Whether people who signed in with just a name may stay signed in (`EMBER_GUEST_SIGN_IN`). */
  guests: boolean;
}

/** The rooms `LEGACY_ROOMS` lists, leaving out anything that couldn't be a room's id. */
const legacyRooms = (env: Env): RoomId[] => (env.LEGACY_ROOMS ?? "").split(",").map((id) => id.trim()).filter(isRoomId);

/**
 * What a workspace shares across its rooms: its people and their sessions, and its rooms and who is
 * in each, with the account next. There is one, and every request reaches it by name; its tables live
 * in its own SQLite storage, or in D1 with everyone else's.
 */
export class Workspace extends DurableObject<Env> {
  private readonly db: Db;
  private readonly store: WorkspaceStore;
  private readonly sessions = new SessionCache<StoredSession>(CACHED_SESSIONS);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = openDb(env, ctx.storage, "workspace");
    this.store = new WorkspaceStore(this.db);
    const legacy = legacyRooms(env);
    // Before anything else is answered, so the first request after a deploy finds them. A failure
    // mustn't keep everyone from signing in, so it's only logged, and the next start tries again.
    if (legacy.length > 0) {
      void ctx.blockConcurrencyWhile(() => this.registerLegacyRooms(legacy).catch((error) => console.error("Registering LEGACY_ROOMS failed", error)));
    }
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
   * The person a session signs in, refreshing the session's last activity at most once an hour.
   * Guests' sessions only count while `guests` says signing in with just a name is allowed.
   */
  async authenticate({ tokenDigest, client, guests }: Credentials): Promise<User | null> {
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

  /** The rooms the person `credentials` signs in is in, or null without a valid session. */
  async rooms(credentials: Credentials): Promise<Room[] | null> {
    const user = await this.authenticate(credentials);
    return user && this.store.roomsFor(user.id);
  }

  /** Creates a room as the person `credentials` signs in, or answers null without a valid session. */
  async createRoom(credentials: Credentials, room: NewRoom): Promise<Room | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    const created: Room = { id: sortableId(), kind: room.kind, name: room.name };
    await this.store.createRoom(created, user.id, room.kind === "closed" ? room.memberIds : null, new Date().toISOString());
    return created;
  }

  /** Who `credentials` signs in and whether they're in room `roomId`, or null without a valid session. */
  async roomAccess(credentials: Credentials, roomId: RoomId): Promise<{ user: User; member: boolean } | null> {
    const user = await this.authenticate(credentials);
    return user && { user, member: await this.store.isMember(roomId, user.id) };
  }

  /**
   * Registers rooms from before the Workspace kept a list as open rooms everyone is in, so their old
   * addresses keep their messages, and keeps the people who wrote or reacted in them as deactivated
   * guests. Rooms already registered are left alone, so this runs again harmlessly.
   */
  async registerLegacyRooms(ids: RoomId[]): Promise<void> {
    for (const id of await this.store.unregisteredRooms(ids)) {
      const authors = await this.env.CHAT_ROOM.getByName(id).authors(id);
      await this.store.registerLegacyRoom(id, authors, new Date().toISOString());
    }
  }
}

export const workspace = (env: Env) => env.WORKSPACE.getByName("workspace");
