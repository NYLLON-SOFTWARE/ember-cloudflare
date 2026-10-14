import { DurableObject } from "cloudflare:workers";
import { isRoomId, type Account, type HelpContact, type NewRoom, type NewWorkspace, type Room, type RoomId, type RoomList, type User, type UserId } from "@ember/protocol";
import { openDb, type Db } from "./db";
import type { Env } from "./env";
import { sortableId } from "./ids";
import { FixedWindowLimit } from "./rate-limit";
import { SessionCache } from "./session-cache";
import { WorkspaceStore, type Client, type JoinableAccount, type NewPerson, type StoredSession } from "./workspace-store";

/** How often a session's last activity, browser and IP are written, at most, as in ember-rust. */
export const SESSION_REFRESH_MS = 60 * 60 * 1000;
/** How many sessions the Workspace keeps in memory: a few devices each for a large team. */
const CACHED_SESSIONS = 10_000;
/** ember-rust's sign-in limit: 10 attempts from an IP address in a fixed 3-minute window (sessions.rs). */
const SIGN_IN_ATTEMPTS = 10;
const SIGN_IN_WINDOW_MS = 3 * 60 * 1000;

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

const encoder = new TextEncoder();

/** Whether `code` is the join code, compared in constant time. Every code is as long as the next, so that much needn't be hidden. */
function isCode(code: string, joinCode: string): boolean {
  const [given, expected] = [encoder.encode(code), encoder.encode(joinCode)];
  return given.length === expected.length && crypto.subtle.timingSafeEqual(given, expected);
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
  /** The account once it exists. Nothing deletes it or changes its join code yet, so once read it needn't be read again. */
  private knownAccount: JoinableAccount | null = null;
  /** The help contact, once read. Only first run makes an administrator yet, and it sets this. */
  private knownHelpContact: HelpContact | null | undefined;
  private readonly signInAttempts = new FixedWindowLimit(SIGN_IN_ATTEMPTS, SIGN_IN_WINDOW_MS);

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

  /** The workspace's account, or null until first run creates it. Its join code is only for the people in it. */
  async account(): Promise<Account | null> {
    const account = await this.joinableAccount();
    return account && { name: account.name };
  }

  private async joinableAccount(): Promise<JoinableAccount | null> {
    return (this.knownAccount ??= await this.store.account());
  }

  /** Whether `code` is the workspace's join code, which it can't be before first run. */
  async isJoinCode(code: string): Promise<boolean> {
    const account = await this.joinableAccount();
    return account !== null && isCode(code, account.joinCode);
  }

  /** What the app asks first: the account, if it's set up, whom to ask for help, and who `credentials` signs in, if anyone. */
  async bootstrap(credentials: Credentials | null): Promise<{ account: Account | null; helpContact: HelpContact | null; user: User | null }> {
    const [account, helpContact, user] = await Promise.all([this.account(), this.helpContact(), credentials && this.authenticate(credentials)]);
    return { account, helpContact, user };
  }

  private async helpContact(): Promise<HelpContact | null> {
    if (this.knownHelpContact === undefined) {
      const contact = await this.store.helpContact();
      // On D1, first run can finish while this reads, and what it found is newer.
      this.knownHelpContact ??= contact;
    }
    return this.knownHelpContact;
  }

  /**
   * Creates the workspace, its first administrator, the open room All Talk and the session their
   * cookie's token opens, as ember-rust's first run does. Answers null if the workspace exists.
   */
  async createWorkspace(administrator: Omit<NewPerson, "id">, tokenDigest: string, client: Client): Promise<NewWorkspace | null> {
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
    this.knownAccount = { name: account.name, joinCode: account.joinCode };
    this.knownHelpContact = { name: administrator.name, emailAddress: administrator.emailAddress };
    this.sessions.remember(tokenDigest, session);
    return { user: session.user, room };
  }

  /**
   * Adds someone who joined with the join link as a member, in every open room, and the session their
   * cookie's token opens, as ember-rust's `users#create` does. Answers null if someone already has
   * their email address.
   */
  async join(person: Omit<NewPerson, "id">, tokenDigest: string, client: Client): Promise<User | null> {
    const session: StoredSession = { id: sortableId(), user: { id: sortableId(), name: person.name }, guest: false, lastActiveAt: Date.now() };
    try {
      await this.store.createMember({ ...person, id: session.user.id }, session.id, tokenDigest, client, new Date(session.lastActiveAt).toISOString());
    } catch (error) {
      if (await this.store.hasEmailAddress(person.emailAddress)) return null;
      throw error;
    }
    this.sessions.remember(tokenDigest, session);
    return session.user;
  }

  /**
   * Counts a password sign-in from `ip` against ember-rust's limit before anything is checked, then
   * finds whose password to check: "limited" past the limit, or else the active person `emailAddress`
   * names, if it names someone with a password.
   */
  async beginSignIn(ip: string, emailAddress: string | null): Promise<"limited" | { userId: UserId; passwordDigest: string } | null> {
    if (!this.signInAttempts.attempt(ip)) return "limited";
    return emailAddress === null ? null : this.store.passwordFor(emailAddress);
  }

  /** Signs in someone whose password checked out, unless they've stopped being active since. */
  async startSession(userId: UserId, tokenDigest: string, client: Client): Promise<User | null> {
    const session = await this.store.startSession(userId, sortableId(), tokenDigest, client, new Date().toISOString());
    if (session) this.sessions.remember(tokenDigest, session);
    return session?.user ?? null;
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
  async authenticate(credentials: Credentials): Promise<User | null> {
    return (await this.session(credentials))?.user ?? null;
  }

  private async session({ tokenDigest, client, guests }: Credentials): Promise<StoredSession | null> {
    const session = await this.sessions.get(tokenDigest, () => this.store.findSession(tokenDigest));
    if (!session || (session.guest && !guests)) return null;
    const now = Date.now();
    if (now - session.lastActiveAt >= SESSION_REFRESH_MS) {
      await this.store.touchSession(session.id, client, new Date(now).toISOString());
      session.lastActiveAt = now;
    }
    return session;
  }

  /**
   * Ends the session `tokenDigest` names, answering its id and the rooms its person is in, which are
   * the only ones it can have sockets open in.
   */
  async signOut(tokenDigest: string): Promise<{ sessionId: string; rooms: RoomId[] } | null> {
    const session = await this.sessions.get(tokenDigest, () => this.store.findSession(tokenDigest));
    await this.sessions.end(tokenDigest, () => this.store.deleteSession(tokenDigest));
    return session && { sessionId: session.id, rooms: await this.store.roomIdsFor(session.user.id) };
  }

  /**
   * The rooms the person `credentials` signs in is in, with the welcome card's invitation if they're
   * in the workspace's first room, or null without a valid session.
   */
  async rooms(credentials: Credentials): Promise<RoomList | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    const [{ rooms, originalRoomId }, account] = await Promise.all([this.store.roomsFor(user.id), this.joinableAccount()]);
    const inOriginal = originalRoomId !== null && rooms.some((room) => room.id === originalRoomId);
    return { rooms, invitation: account && inOriginal ? { roomId: originalRoomId, joinCode: account.joinCode } : null };
  }

  /** Creates a room as the person `credentials` signs in, or answers null without a valid session. */
  async createRoom(credentials: Credentials, room: NewRoom): Promise<Room | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    const created: Room = { id: sortableId(), kind: room.kind, name: room.name };
    await this.store.createRoom(created, user.id, room.kind === "closed" ? room.memberIds : null, new Date().toISOString());
    return created;
  }

  /** Who `credentials` signs in, with their session, and whether they're in room `roomId`, or null without a valid session. */
  async roomAccess(credentials: Credentials, roomId: RoomId): Promise<{ user: User; sessionId: string; member: boolean } | null> {
    const session = await this.session(credentials);
    return session && { user: session.user, sessionId: session.id, member: await this.store.isMember(roomId, session.user.id) };
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
