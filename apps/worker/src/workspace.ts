import { DurableObject } from "cloudflare:workers";
import { isRoomId, type Account, type NewRoom, type NewWorkspace, type Room, type RoomId, type User } from "@ember/protocol";
import { openDb, type Db } from "./db";
import type { Env } from "./env";
import { sortableId } from "./ids";
import { SessionCache } from "./session-cache";
import { WorkspaceStore, type Client, type NewAdministrator, type StoredSession } from "./workspace-store";

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

/** What first run names the workspace and its first room, as ember-rust's does (crates/db/src/models/first_run.rs). */
export const ACCOUNT_NAME = "Ember";
const FIRST_ROOM_NAME = "All Talk";

const ALPHANUMERICS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A join link's code, as ember-rust makes them (account.rs): 12 random letters and digits in fours, like aB3d-Ef5h-iJ7k. */
function newJoinCode(): string {
  let code = "";
  while (code.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
      // 248 is the largest multiple of 62 below 256, so every character is as likely as the next.
      if (byte < 248 && code.length < 12) code += ALPHANUMERICS[byte % ALPHANUMERICS.length];
    }
  }
  return code.match(/.{4}/g)!.join("-");
}

/** The rooms `LEGACY_ROOMS` lists, leaving out anything that couldn't be a room's id. */
const legacyRooms = (env: Env): RoomId[] => (env.LEGACY_ROOMS ?? "").split(",").map((id) => id.trim()).filter(isRoomId);

/**
 * What a workspace shares across its rooms: its account, its people and their sessions, and its
 * rooms and who is in each. There is one, and every request reaches it by name; its tables live in
 * its own SQLite storage, or in D1 with everyone else's.
 */
export class Workspace extends DurableObject<Env> {
  private readonly db: Db;
  private readonly store: WorkspaceStore;
  private readonly sessions = new SessionCache<StoredSession>(CACHED_SESSIONS);
  /** The account once it exists. Nothing deletes it, so once read it needn't be read again. */
  private knownAccount: Account | null = null;

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

  /** The workspace's account, or null until first run creates it. */
  async account(): Promise<Account | null> {
    return (this.knownAccount ??= await this.store.account());
  }

  /** What the app asks first: the account, if it's set up, and who `credentials` signs in, if anyone. */
  async bootstrap(credentials: Credentials | null): Promise<{ account: Account | null; user: User | null }> {
    const [account, user] = await Promise.all([this.account(), credentials && this.authenticate(credentials)]);
    return { account, user };
  }

  /**
   * Creates the workspace, its first administrator, the open room All Talk and the session their
   * cookie's token opens, as ember-rust's first run does. Answers null if the workspace exists.
   */
  async createWorkspace(administrator: Omit<NewAdministrator, "id">, tokenDigest: string, client: Client): Promise<NewWorkspace | null> {
    if (await this.account()) return null;
    const session: StoredSession = { id: sortableId(), user: { id: sortableId(), name: administrator.name }, guest: false, lastActiveAt: Date.now() };
    const account = { id: sortableId(), name: ACCOUNT_NAME, joinCode: newJoinCode() };
    const room: Room = { id: sortableId(), kind: "open", name: FIRST_ROOM_NAME };
    const now = new Date(session.lastActiveAt).toISOString();
    try {
      await this.store.createWorkspace(account, { ...administrator, id: session.user.id }, room, session.id, tokenDigest, client, now);
    } catch (error) {
      // On D1 two first runs can overlap, and the account's singleton guard refuses the second.
      if (await this.store.account()) return null;
      throw error;
    }
    this.knownAccount = { name: account.name };
    this.sessions.remember(tokenDigest, session);
    return { user: session.user, room };
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
