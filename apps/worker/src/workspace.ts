import { DurableObject } from "cloudflare:workers";
import {
  CloseCode,
  isRoomId,
  parseWorkspaceClientFrame,
  type Account,
  type AccountChanges,
  type HelpContact,
  type Me,
  type NewJoinCode,
  type NewRoom,
  type NewRoomForm,
  type NewWorkspace,
  type Room,
  type RoomChanges,
  type RoomId,
  type RoomSettings,
  type Sidebar,
  type User,
  type UserId,
  type WorkspaceServerFrame,
  type WorkspaceSettings,
} from "@ember/protocol";
import { openDb, type Db } from "./db";
import type { Env } from "./env";
import { sortableId } from "./ids";
import { FixedWindowLimit } from "./rate-limit";
import { sessionTag } from "./revocations";
import type { RoomEvent } from "./room-log";
import { SessionCache } from "./session-cache";
import { CLOSE_REASONS, RESERVED_CLOSE_CODES } from "./sockets";
import { WorkspaceStore, type AvatarOwner, type Client, type DirectoryEntry, type JoinableAccount, type NewPerson, type StoredSession } from "./workspace-store";

/** How often a session's last activity, browser and IP are written, at most, as in ember-rust. */
export const SESSION_REFRESH_MS = 60 * 60 * 1000;
/** How many sessions the Workspace keeps in memory: a few devices each for a large team. */
const CACHED_SESSIONS = 10_000;
/** ember-rust's sign-in limit: 10 attempts from an IP address in a fixed 3-minute window (sessions.rs). */
const SIGN_IN_ATTEMPTS = 10;
const SIGN_IN_WINDOW_MS = 3 * 60 * 1000;
/**
 * Link previews someone may ask for in a minute. ember-rust only runs 16 at once, queueing the rest,
 * but a preview fetches any page someone names, which would make the Worker anyone's fetcher.
 */
const UNFURLS = 30;
const UNFURL_WINDOW_MS = 60 * 1000;
/**
 * How many revocations the outbox delivers in one run of its alarm, at most. Each room it calls may
 * count as a subrequest, of which an invocation on the Free plan can make 50, its queries included.
 */
const REVOCATIONS_PER_RUN = 40;
/** How many rooms the outbox calls at once: as many outgoing connections as an invocation can have open. */
const ROOMS_AT_ONCE = 6;

/** The header in which the Worker passes a workspace socket's credentials on to the Workspace. */
export const CREDENTIALS_HEADER = "X-Ember-Credentials";

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

/** Runs `work` on each of `items`, `limit` at a time. */
async function eachAtMost<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Sends `frame` on a workspace socket, unless it has closed since. */
function send(ws: WebSocket, frame: WorkspaceServerFrame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    // Its close handler has nothing to clean up.
  }
}

/** Who a session signs in, as the app keeps them. */
const meOf = ({ user, administrator }: StoredSession): Me => ({ ...user, administrator });

/** The rooms `LEGACY_ROOMS` lists, leaving out anything that couldn't be a room's id. */
const legacyRooms = (env: Env): RoomId[] => (env.LEGACY_ROOMS ?? "").split(",").map((id) => id.trim()).filter(isRoomId);

/**
 * What a workspace shares across its rooms: its account, its people and their sessions, and its
 * rooms and who is in each. There is one, and every request reaches it by name; its tables live in
 * its own SQLite storage, or in D1 with everyone else's. Each signed-in tab keeps a socket to it,
 * besides its room's, for what changes outside the room; like rooms, it hibernates them.
 */
export class Workspace extends DurableObject<Env> {
  private readonly db: Db;
  private readonly store: WorkspaceStore;
  private readonly sessions = new SessionCache<StoredSession>(CACHED_SESSIONS);
  /**
   * The account once it exists. Renaming it and regenerating its join code keep this current, and
   * nothing deletes it, so once read it needn't be read again.
   */
  private knownAccount: JoinableAccount | null = null;
  /** Counts the starts and ends of changes to the account, so a read that overlapped one isn't kept: on D1, queries interleave. */
  private accountChanges = 0;
  /** The help contact, once read. Only first run makes an administrator yet, and it sets this. */
  private knownHelpContact: HelpContact | null | undefined;
  private readonly signInAttempts = new FixedWindowLimit(SIGN_IN_ATTEMPTS, SIGN_IN_WINDOW_MS);
  private readonly unfurls = new FixedWindowLimit(UNFURLS, UNFURL_WINDOW_MS);
  /** The last change asked for, which the next one waits for (see `oneAtATime`). */
  private lastChange: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // As in rooms, the runtime answers the app's heartbeats without waking the Workspace.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
    this.db = openDb(env, ctx.storage, "workspace");
    this.store = new WorkspaceStore(this.db);
    // The outbox can hold revocations with no alarm set for them: the Workspace can stop after saving a
    // change but before setting the alarm, and an alarm that keeps failing is given up. So it looks
    // whenever it starts, before answering anything. A failure is only logged; the next change that
    // queues a revocation, or the next start, sets the alarm.
    void ctx.blockConcurrencyWhile(() => this.scheduleDelivery().catch((error) => console.error("Could not schedule the outbox's deliveries", error)));
    const legacy = legacyRooms(env);
    // Before anything else is answered, so the first request after a deploy finds them. A failure
    // mustn't keep everyone from signing in, so it's only logged, and the next start tries again.
    if (legacy.length > 0) {
      void ctx.blockConcurrencyWhile(() => this.registerLegacyRooms(legacy).catch((error) => console.error("Registering LEGACY_ROOMS failed", error)));
    }
  }

  /**
   * Lets in a tab's workspace socket, which the Worker sends on with the credentials of the request
   * for it, if they sign someone in. Like a room's, it's tagged with its person and its session, so
   * signing out can find it.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket upgrade", { status: 426 });
    const credentials = JSON.parse(request.headers.get(CREDENTIALS_HEADER) ?? "null") as Credentials | null;
    if (!credentials) return new Response("Missing credentials", { status: 400 });
    const session = await this.session(credentials);
    if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [session.user.id, sessionTag(session.id)]);
    // On D1, signing out can end the session while the check above reads it, and close the session's
    // sockets before this one is among them. Now that it is, checking again settles it: the session
    // cache forgets a session as it starts ending, and doesn't keep a lookup an ending overlapped.
    if (await this.session(credentials)) send(server, { type: "welcome", you: meOf(session) });
    else server.close(CloseCode.Reconnect, CLOSE_REASONS[CloseCode.Reconnect]);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Answers a ping that the runtime doesn't, because it carries more than its type. A workspace socket sends nothing else. */
  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const frame = typeof raw === "string" ? parseWorkspaceClientFrame(raw) : null;
    send(ws, frame ? { type: "pong" } : { type: "error", message: "Unrecognized frame" });
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    ws.close(RESERVED_CLOSE_CODES.has(code) ? 1000 : code, "Closing");
  }

  /** Closes the workspace sockets tagged `tag`, with `code`. */
  private closeSockets(tag: string, code: CloseCode): void {
    for (const socket of this.ctx.getWebSockets(tag)) {
      if (socket.readyState === WebSocket.OPEN) socket.close(code, CLOSE_REASONS[code]);
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
    if (this.knownAccount) return this.knownAccount;
    const changes = this.accountChanges;
    const account = await this.store.account();
    if (changes === this.accountChanges) this.knownAccount = account;
    return account;
  }

  /** Whether `code` is the workspace's join code, which it can't be before first run. */
  async isJoinCode(code: string): Promise<boolean> {
    const account = await this.joinableAccount();
    return account !== null && isCode(code, account.joinCode);
  }

  /** What the app asks first: the account, if it's set up, whom to ask for help, and who `credentials` signs in, if anyone. */
  async bootstrap(credentials: Credentials | null): Promise<{ account: Account | null; helpContact: HelpContact | null; user: Me | null }> {
    const [account, helpContact, user] = await Promise.all([this.account(), this.helpContact(), credentials && this.me(credentials)]);
    return { account, helpContact, user };
  }

  /**
   * Workspace settings as the person `credentials` signs in sees them, which ember-rust shows anyone
   * signed in (accounts.rs, `edit`): "not set up" before first run, or null without a valid session.
   */
  async workspaceSettings(credentials: Credentials): Promise<WorkspaceSettings | "not set up" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    const [account, canAdminister] = await Promise.all([this.joinableAccount(), this.store.isAdministrator(user.id)]);
    return account ? { account: { name: account.name }, joinCode: account.joinCode, canAdminister } : "not set up";
  }

  /**
   * Makes `changes` to the workspace as the person `credentials` signs in, answering the account as it
   * is then: "forbidden" unless they're an administrator, as ember-rust's `update` insists
   * (accounts.rs), or null without a valid session.
   */
  async changeAccount(credentials: Credentials, changes: AccountChanges): Promise<Account | "forbidden" | null> {
    return this.administerAccount(credentials, async (account) => {
      if (changes.name === undefined) return { name: account.name };
      const name = changes.name;
      await this.saveAccount({ ...account, name }, (now) => this.store.renameAccount(name, now));
      return { name };
    });
  }

  /**
   * Gives the join link a new code as the person `credentials` signs in, answering it, as ember-rust's
   * `join_codes#create` does: "forbidden" unless they're an administrator, or null without a valid session.
   */
  async regenerateJoinCode(credentials: Credentials): Promise<NewJoinCode | "forbidden" | null> {
    return this.administerAccount(credentials, async (account) => {
      const joinCode = newJoinCode();
      await this.saveAccount({ ...account, joinCode }, (now) => this.store.changeJoinCode(joinCode, now));
      return { joinCode };
    });
  }

  /**
   * Changes the account with `change`, one change at a time, if `credentials` signs in an administrator
   * as they are then: "forbidden" if it signs in anyone else, or null without a valid session.
   */
  private async administerAccount<T>(credentials: Credentials, change: (account: JoinableAccount) => Promise<T>): Promise<T | "forbidden" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    return this.oneAtATime(async () => {
      if (!(await this.store.isAdministrator(user.id))) return "forbidden";
      // First run made the account with its first administrator.
      return change((await this.joinableAccount())!);
    });
  }

  /** Saves the account as `account` with `save`, remembering it as that once it's saved. */
  private async saveAccount(account: JoinableAccount, save: (now: string) => Promise<void>): Promise<void> {
    this.accountChanges++;
    try {
      await save(new Date().toISOString());
    } catch (error) {
      // On D1 a change can be saved and its answer lost, so the account is read again.
      this.knownAccount = null;
      throw error;
    } finally {
      this.accountChanges++;
    }
    this.knownAccount = account;
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
    const session: StoredSession = {
      id: sortableId(),
      user: { id: sortableId(), name: administrator.name },
      administrator: true,
      guest: false,
      lastActiveAt: Date.now(),
    };
    const account = { id: sortableId(), name: ACCOUNT_NAME, joinCode: newJoinCode() };
    const room: Room = { id: sortableId(), kind: "open", name: FIRST_ROOM_NAME, icon: null };
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
    return { user: meOf(session), room };
  }

  /**
   * Adds someone who joined with the join link for `code` as a member, in every open room, and the
   * session their cookie's token opens, as ember-rust's `users#create` does. Answers "not found" if
   * `code` isn't the join code, and null if someone already has their email address.
   */
  async join(code: string, person: Omit<NewPerson, "id">, tokenDigest: string, client: Client): Promise<Me | "not found" | null> {
    // The Worker checked the code before the form arrived, but the link may have been regenerated since.
    return this.oneAtATime(async () => {
      if (!(await this.isJoinCode(code))) return "not found";
      const session: StoredSession = { id: sortableId(), user: { id: sortableId(), name: person.name }, administrator: false, guest: false, lastActiveAt: Date.now() };
      try {
        await this.store.createMember({ ...person, id: session.user.id }, session.id, tokenDigest, client, new Date(session.lastActiveAt).toISOString());
      } catch (error) {
        if (await this.store.hasEmailAddress(person.emailAddress)) return null;
        throw error;
      }
      this.sessions.remember(tokenDigest, session);
      return meOf(session);
    });
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

  /**
   * Counts a link preview against the limit of the person `credentials` signs in: "limited" past it,
   * null without a valid session.
   */
  async beginUnfurl(credentials: Credentials): Promise<"allowed" | "limited" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    return this.unfurls.attempt(user.id) ? "allowed" : "limited";
  }

  /** Signs in someone whose password checked out, unless they've stopped being active since. */
  async startSession(userId: UserId, tokenDigest: string, client: Client): Promise<Me | null> {
    const session = await this.store.startSession(userId, sortableId(), tokenDigest, client, new Date().toISOString());
    if (session) this.sessions.remember(tokenDigest, session);
    return session && meOf(session);
  }

  /** Adds someone who signs in with just a name, and the session their cookie's token opens. */
  async signInGuest(name: string, tokenDigest: string, client: Client): Promise<Me> {
    const session: StoredSession = { id: sortableId(), user: { id: sortableId(), name }, administrator: false, guest: true, lastActiveAt: Date.now() };
    await this.store.createGuest(session.user, session.id, tokenDigest, client, new Date(session.lastActiveAt).toISOString());
    this.sessions.remember(tokenDigest, session);
    return meOf(session);
  }

  /**
   * The person a session signs in, refreshing the session's last activity at most once an hour.
   * Guests' sessions only count while `guests` says signing in with just a name is allowed.
   */
  async authenticate(credentials: Credentials): Promise<User | null> {
    return (await this.session(credentials))?.user ?? null;
  }

  /** The same, as the app keeps them. */
  async me(credentials: Credentials): Promise<Me | null> {
    const session = await this.session(credentials);
    return session && meOf(session);
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
   * Ends the session `tokenDigest` names, and closes the sockets it opened, telling them to reconnect,
   * as ember-rust's sign-out does (concerns.rs): its workspace sockets here at once, and the rest by
   * having every room its person is in close the session's sockets there.
   */
  async signOut(tokenDigest: string): Promise<void> {
    const now = Date.now();
    // Found first: on D1 a change can be saved, its revocations with it, and its answer lost on the
    // way back, and then nothing would say which sockets were the session's.
    const session = await this.sessions.get(tokenDigest, () => this.store.findSession(tokenDigest));
    // Until the database says it queued nothing.
    let queued = true;
    try {
      queued = await this.sessions.end(tokenDigest, () => this.store.endSession(tokenDigest, CloseCode.Reconnect, now));
    } finally {
      // Whether or not it ended: the sockets of a session that didn't are let in again.
      if (session) this.closeSockets(sessionTag(session.id), CloseCode.Reconnect);
      if (queued) await this.wakeAt(now);
    }
  }

  /**
   * The sidebar of the person `credentials` signs in: the rooms they're in, with the welcome card's
   * invitation if they're in the workspace's first room. Null without a valid session.
   */
  async sidebar(credentials: Credentials): Promise<Sidebar | null> {
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
    const created: Room = { id: sortableId(), kind: room.kind, name: room.name, icon: room.icon || null };
    await this.store.createRoom(created, user.id, room.kind === "closed" ? room.memberIds : null, new Date().toISOString());
    return created;
  }

  /** What the New room forms list, everyone active, for the person `credentials` signs in, or null without a valid session. */
  async newRoomForm(credentials: Credentials): Promise<NewRoomForm | null> {
    const user = await this.authenticate(credentials);
    return user && { people: await this.store.activePeople() };
  }

  /** Everyone in the workspace, for the person `credentials` signs in, or null without a valid session. */
  async directory(credentials: Credentials): Promise<DirectoryEntry[] | null> {
    const user = await this.authenticate(credentials);
    return user && this.store.directory();
  }

  /**
   * What the avatar of whoever has id `userId` is drawn from, for the person `credentials` signs in:
   * "not found" if nobody has it, or null without a valid session.
   */
  async avatarOwner(credentials: Credentials, userId: UserId): Promise<AvatarOwner | "not found" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    return (await this.store.avatarOwner(userId)) ?? "not found";
  }

  /**
   * Room `roomId`'s settings, as the person `credentials` signs in sees them: "not found" unless
   * they're in it and it isn't a DM, as ember-rust's `set_room` finds rooms (rooms.rs), or null
   * without a valid session.
   */
  async roomSettings(credentials: Credentials, roomId: RoomId): Promise<RoomSettings | "not found" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    return (await this.store.roomSettings(roomId, user.id)) ?? "not found";
  }

  /**
   * Makes `changes` to room `roomId` as the person `credentials` signs in, answering the room as it
   * is then: "not found" as for its settings, "forbidden" unless they can change it, or null without
   * a valid session. Anyone it takes out of the room is told to reconnect, and finds it gone.
   */
  async changeRoom(credentials: Credentials, roomId: RoomId, changes: RoomChanges): Promise<Room | "not found" | "forbidden" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    return this.oneAtATime(async () => {
      const found = await this.store.roomToChange(roomId, user.id);
      if (!found) return "not found";
      if (!found.canAdminister) return "forbidden";
      const changed: Room = {
        ...found.room,
        ...(changes.name && { name: changes.name }),
        ...(changes.kind && { kind: changes.kind }),
        ...(changes.icon !== undefined && { icon: changes.icon || null }),
      };
      if (!changes.name && !changes.kind && changes.icon === undefined) return changed;
      const now = Date.now();
      // As when signing out, until the database says it queued nothing.
      let queued = changes.kind === "closed";
      try {
        queued = await this.store.changeRoom(roomId, changes, CloseCode.Reconnect, now, new Date(now).toISOString());
      } finally {
        if (queued) await this.wakeAt(now);
      }
      return changed;
    });
  }

  /**
   * Makes changes to rooms and to the workspace one at a time, each once the one before has finished.
   * Each reads who may make it before it writes, and on D1 other requests run in between: without
   * this, someone another change had just taken out of a room could still open it to everyone, a
   * change could write to a room deleted since it looked, and someone could join with a code just
   * regenerated.
   */
  private oneAtATime<T>(change: () => Promise<T>): Promise<T> {
    const result = this.lastChange.then(change);
    this.lastChange = result.catch(() => undefined);
    return result;
  }

  /**
   * Deletes room `roomId` as the person `credentials` signs in, as ember-rust's `destroy` does
   * (rooms.rs): "not found" as for its settings, "forbidden" unless they can change it, or null
   * without a valid session. Everyone with it open is told it's gone, and its messages go with it.
   */
  async deleteRoom(credentials: Credentials, roomId: RoomId): Promise<"deleted" | "not found" | "forbidden" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    return this.oneAtATime(async () => {
      const found = await this.store.roomToChange(roomId, user.id);
      if (!found) return "not found";
      if (!found.canAdminister) return "forbidden";
      const now = Date.now();
      try {
        await this.store.deleteRoom(roomId, CloseCode.NotFound, now, new Date(now).toISOString());
      } finally {
        // As when signing out: the database may have saved the deletion, and so queued it, though its answer was lost.
        await this.wakeAt(now);
      }
      return "deleted";
    });
  }

  /**
   * Applies the events room `roomId` sends from its log, in order, with `viewerIds`, who is viewing
   * the room as it sends them: a new message marks the room unread for its members who aren't, and
   * someone opening it clears their mark. Each event is applied once, however often it's sent. Whoever's
   * mark changes hears of it on their workspace sockets, and nobody else does.
   */
  async applyRoomEvents(roomId: RoomId, events: RoomEvent[], viewerIds: UserId[]): Promise<void> {
    if (events.length === 0) return;
    const marks = await this.store.applyRoomEvents(roomId, events, viewerIds);
    for (const [userId, unread] of marks) {
      const frame: WorkspaceServerFrame = { type: unread ? "room.unread" : "room.read", roomId };
      for (const socket of this.ctx.getWebSockets(userId)) send(socket, frame);
    }
  }

  /**
   * Who `credentials` signs in, with their session, and whether they're in room `roomId`, as of
   * `authorizedAt`, or null without a valid session.
   */
  async roomAccess(credentials: Credentials, roomId: RoomId): Promise<{ user: User; sessionId: string; member: boolean; authorizedAt: number } | null> {
    // Before anything is read, so that a revocation saved while this checks counts as later than it,
    // and the room turns the socket away if it arrives after the revocation does.
    const authorizedAt = Date.now();
    const session = await this.session(credentials);
    return session && { user: session.user, sessionId: session.id, member: await this.store.isMember(roomId, session.user.id), authorizedAt };
  }

  /** Delivers the revocations that are due, the outbox's work. */
  override async alarm(): Promise<void> {
    await this.deliverRevocations();
  }

  /**
   * Sends rooms the revocations due now, at most `REVOCATIONS_PER_RUN` of them, each room its own in
   * one call. Those a room doesn't take are tried again later, and the alarm is set for whichever is
   * due next.
   */
  private async deliverRevocations(): Promise<void> {
    const due = await this.store.dueRevocations(Date.now(), REVOCATIONS_PER_RUN);
    // Read after the rows, so it's later than every change that queued them, and so later than any
    // check that saw what came before one of those changes.
    const revokedAt = Date.now();
    const delivered: number[] = [];
    const failed: number[] = [];
    await eachAtMost([...Map.groupBy(due, (revocation) => revocation.roomId)], ROOMS_AT_ONCE, async ([roomId, revocations]) => {
      const ids = revocations.map(({ id }) => id);
      try {
        await this.env.CHAT_ROOM.getByName(roomId).revoke(roomId, revocations.map(({ tag, code }) => ({ tag, code })), revokedAt);
        delivered.push(...ids);
      } catch (error) {
        console.error(`Could not close sockets in room ${roomId}; trying again later`, error);
        failed.push(...ids);
      }
    });
    for (const { roomId, tag } of await this.store.settleRevocations(delivered, failed, Date.now())) {
      console.error(`Gave up closing the sockets tagged ${tag} in room ${roomId}`);
    }
    await this.scheduleDelivery();
  }

  /** Sets the alarm for the next revocation due, if any is waiting. */
  private async scheduleDelivery(): Promise<void> {
    const next = await this.store.nextRevocationDue();
    if (next !== null) await this.wakeAt(next);
  }

  /** Sets the alarm for `time`, unless it's already set for sooner. */
  private async wakeAt(time: number): Promise<void> {
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > time) await this.ctx.storage.setAlarm(time);
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
