import { DurableObject } from "cloudflare:workers";
import {
  CloseCode,
  isRoomId,
  parseWorkspaceClientFrame,
  type Account,
  type AccountChanges,
  type CustomStyles,
  type DirectoryUser,
  type DirectRoom,
  type Favorites,
  type HelpContact,
  type Me,
  type NewJoinCode,
  type NewRoom,
  type NewRoomForm,
  type NewWorkspace,
  type PersonRole,
  type Profile,
  type ProfileChanges,
  type RoomChanges,
  type RoomId,
  type RoomSettings,
  type SharedRoom,
  type Sidebar,
  type User,
  type UserId,
  type WorkspaceServerFrame,
  type WorkspaceSettings,
} from "@ember/protocol";
import { directoryOf } from "./avatar-tokens";
import { openDb, type Db } from "./db";
import type { Env } from "./env";
import { sortableId } from "./ids";
import { FixedWindowLimit } from "./rate-limit";
import { sessionTag } from "./revocations";
import type { RoomEvent } from "./room-log";
import { SessionCache } from "./session-cache";
import { CLOSE_REASONS, RESERVED_CLOSE_CODES } from "./sockets";
import {
  NEW_ACCOUNT_LOOKS,
  WorkspaceStore,
  type AccountChange,
  type AvatarOwner,
  type Client,
  type DirectoryEntry,
  type JoinableAccount,
  type NewPerson,
  type ProfileEntry,
  type SavedRoomChange,
  type StoredSession,
} from "./workspace-store";

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

/** The account as every page shows it, without its join code, which only the people in it see. */
const accountOf = ({ name, hideTranslationButtons, customStyles }: JoinableAccount): Account => ({ name, hideTranslationButtons, customStyles });

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

/** What first run names the workspace, as ember-rust's does (crates/db/src/models/first_run.rs). */
export const ACCOUNT_NAME = "Ember";
/**
 * The open rooms first run makes, everyone's to begin with, as a Slack workspace's are, where
 * ember-rust's first run makes just All Talk. The first, general, is the workspace's first room, which
 * first run opens and the welcome card shows in.
 */
const FIRST_ROOM_NAMES = ["general", "random"];

/** Your profile, and your id, which the Worker makes your sign-in link for. */
export interface YourProfile {
  userId: UserId;
  profile: Profile;
}

/** Someone as their page shows them to the person asking. */
export interface ShownPerson {
  person: DirectoryEntry | ProfileEntry;
  /**
   * Whether the page gives a sign-in link for them, as ember-rust's does for administrators when
   * they're active and aren't a bot (users/show.html).
   */
  transferable: boolean;
}

/** The workspace as pages show it before first run: named "Ember" and looking as a new one does, as in ember-rust. */
export const ACCOUNT_BEFORE_SETUP: Account = { name: ACCOUNT_NAME, ...NEW_ACCOUNT_LOOKS };

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

const profileOf = ({ name, emailAddress, bio }: ProfileEntry): Profile => ({ name, emailAddress, bio });

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
  /**
   * The help contact, the first administrator, once read. First run sets it, and changing a role or an
   * administrator's profile forgets it.
   */
  private knownHelpContact: HelpContact | null | undefined;
  /**
   * Counts the starts and ends of changes to roles and administrators' profiles, so a help contact read
   * that overlapped one isn't kept.
   */
  private helpContactChanges = 0;
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
    // The welcome says who they are as this check reads them, since a change to them while the first
    // read was told only the sockets already in. It brings the workspace as it is now too, which may
    // have changed while the tab was without a socket.
    const [current, account] = await Promise.all([this.session(credentials), this.account()]);
    if (current) send(server, { type: "welcome", you: meOf(current), account: account ?? ACCOUNT_BEFORE_SETUP });
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

  /** Sends `frame` on every workspace socket, written out once for them all. */
  private broadcast(frame: WorkspaceServerFrame): void {
    const data = JSON.stringify(frame);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(data);
      } catch {
        // It has closed since, and its close handler has nothing to clean up.
      }
    }
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
    return account && accountOf(account);
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
    return account ? { account: accountOf(account), joinCode: account.joinCode, canAdminister } : "not set up";
  }

  /**
   * Makes `changes` to the workspace as the person `credentials` signs in, answering the account as it
   * is then: "forbidden" unless they're an administrator, as ember-rust's `update` insists
   * (accounts.rs), or null without a valid session. Everyone's workspace sockets hear of a change.
   */
  async changeAccount(credentials: Credentials, { name, settings }: AccountChanges): Promise<Account | "forbidden" | null> {
    return this.administerAccount(credentials, async (account) => {
      // As ember-rust's `Account::update` writes only what differs (account.rs).
      const hideTranslationButtons = settings?.hideTranslationButtons;
      const change: AccountChange = {
        ...(name !== undefined && name !== account.name && { name }),
        ...(hideTranslationButtons !== undefined && hideTranslationButtons !== account.hideTranslationButtons && { hideTranslationButtons }),
      };
      if (Object.keys(change).length === 0) return accountOf(account);
      return this.publishAccount({ ...account, ...change }, (now) => this.store.changeAccount(change, now));
    });
  }

  /**
   * The workspace's custom CSS, for the Custom CSS page: "forbidden" unless the person `credentials`
   * signs in is an administrator, as ember-rust's `edit` insists (custom_styles.rs), or null without a
   * valid session.
   */
  async customStyles(credentials: Credentials): Promise<CustomStyles | "forbidden" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    const [account, administrator] = await Promise.all([this.joinableAccount(), this.store.isAdministrator(user.id)]);
    return administrator && account ? { customStyles: account.customStyles } : "forbidden";
  }

  /**
   * Saves `customStyles` as the workspace's custom CSS as the person `credentials` signs in, answering
   * the account as it is then: "forbidden" unless they're an administrator, as ember-rust's `update`
   * insists (custom_styles.rs), or null without a valid session. Undefined changes nothing, once that's
   * checked. Everyone's workspace sockets hear of a change.
   */
  async changeCustomStyles(credentials: Credentials, customStyles: string | undefined): Promise<Account | "forbidden" | null> {
    return this.administerAccount(credentials, async (account) => {
      if (customStyles === undefined || customStyles === account.customStyles) return accountOf(account);
      return this.publishAccount({ ...account, customStyles }, (now) => this.store.changeCustomStyles(customStyles, now));
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

  /**
   * Saves a change to what every page shows of the account, as `saveAccount` does, then tells every
   * workspace socket, so pages show it at once, where ember-rust's show it as they next load. Answers
   * the account as it is now.
   */
  private async publishAccount(account: JoinableAccount, save: (now: string) => Promise<void>): Promise<Account> {
    await this.saveAccount(account, save);
    const shown = accountOf(account);
    this.broadcast({ type: "account.updated", account: shown });
    return shown;
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
    if (this.knownHelpContact !== undefined) return this.knownHelpContact;
    const changes = this.helpContactChanges;
    const contact = await this.store.helpContact();
    // On D1, first run can finish while this reads, and what it found is newer.
    if (changes === this.helpContactChanges) this.knownHelpContact ??= contact;
    return this.knownHelpContact ?? contact;
  }

  /**
   * Creates the workspace, its first administrator, the open rooms general and random, and the session
   * their cookie's token opens, as ember-rust's first run does with All Talk, answering general, which
   * opens. A room of either name that the workspace has open already, such as one `LEGACY_ROOMS`
   * registered, stands in for it. Answers null if the workspace exists.
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
    // Ids sort in the order they're made, which makes general the older of two rooms made at once.
    const rooms = FIRST_ROOM_NAMES.map((name) => ({ id: sortableId(), name }));
    const now = new Date(session.lastActiveAt).toISOString();
    let room: SharedRoom;
    try {
      room = await this.store.createWorkspace(account, { ...administrator, id: session.user.id }, rooms, session.id, tokenDigest, client, now);
    } catch (error) {
      // On D1 two first runs can overlap, and the account's singleton guard refuses the second.
      if (await this.store.account()) return null;
      throw error;
    }
    this.knownAccount = { name: account.name, joinCode: account.joinCode, ...NEW_ACCOUNT_LOOKS };
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

  /**
   * Signs in someone whose password checked out against `passwordDigest`, unless they've stopped being
   * active since, or their password has been reset while it was checked.
   */
  async startSession(userId: UserId, passwordDigest: string, tokenDigest: string, client: Client): Promise<Me | null> {
    // On D1 a role change can overlap it, so it's remembered only if none did.
    const session = await this.sessions.keep(tokenDigest, () =>
      this.store.startSession(userId, passwordDigest, sortableId(), tokenDigest, client, new Date().toISOString()),
    );
    return session && meOf(session);
  }

  /**
   * Signs in the person a sign-in link names, with a session of its own, as ember-rust's session
   * transfers do, unless they're no longer active, or are a guest while `guests` says guests can't
   * stay signed in.
   */
  async transferSession(userId: UserId, tokenDigest: string, client: Client, guests: boolean): Promise<Me | null> {
    // On D1 a role change can overlap it, so it's remembered only if none did.
    const session = await this.sessions.keep(tokenDigest, () =>
      this.store.startTransferredSession(userId, guests, sortableId(), tokenDigest, client, new Date().toISOString()),
    );
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
   * Gives whoever has exactly the email address `emailAddress` the password `passwordDigest` is the
   * digest of, as ember-rust's `reset-password` does (admin.rs): "not found" if nobody has it, whatever
   * their status, and "bot" for a bot, who never signs in with a password. Their role and status stay,
   * a ban included. All their sessions end, and their sockets close and are told to reconnect: here at
   * once, and in every room they're in through the outbox, where ember-rust's wait for a restart.
   */
  async resetPassword(emailAddress: string, passwordDigest: string): Promise<"reset" | "not found" | "bot"> {
    return this.oneAtATime(async () => {
      const person = await this.store.personWithEmailAddress(emailAddress);
      if (!person) return "not found";
      if (person.bot) return "bot";
      const now = Date.now();
      // As when signing out, until the database says it queued nothing.
      let queued = true;
      try {
        queued = await this.sessions.change(
          (session) => session.user.id === person.id,
          () => this.store.resetPassword(person.id, passwordDigest, CloseCode.Reconnect, now, new Date(now).toISOString()),
        );
      } finally {
        // Whether or not it saved: sockets whose sessions didn't end are let in again.
        this.closeSockets(person.id, CloseCode.Reconnect);
        if (queued) await this.wakeAt(now);
      }
      return "reset";
    });
  }

  /**
   * The sidebar of the person `credentials` signs in: the rooms they're in and the ones they've starred,
   * with the welcome card's invitation if they're in the workspace's first room, and the people it
   * suggests for DMs. Null without a valid session.
   */
  async sidebar(credentials: Credentials): Promise<Sidebar | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    const [{ rooms, favorites, suggestions, originalRoomId }, account] = await Promise.all([this.store.roomsFor(user.id), this.joinableAccount()]);
    const inOriginal = originalRoomId !== null && rooms.some((room) => room.id === originalRoomId);
    return { rooms, favorites, invitation: account && inOriginal ? { roomId: originalRoomId, joinCode: account.joinCode } : null, suggestions };
  }

  /**
   * Stars room `roomId` for the person `credentials` signs in, or unstars it, answering their stars as
   * they are then, as ember-rust's `favorites#update` does (rooms/favorites.rs): "forbidden" when they
   * can't star it, or null without a valid session. Every tab of theirs hears the new list.
   */
  async setFavorite(credentials: Credentials, roomId: RoomId, favorite: boolean): Promise<Favorites | "forbidden" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    const favorites = await this.store.setFavorite(user.id, roomId, favorite);
    if (!favorites) return "forbidden";
    this.starsChanged(user.id, favorites);
    return favorites;
  }

  /**
   * Puts the stars of the person `credentials` signs in in the order `roomIds` lists them, answering
   * their stars as they are then, as ember-rust's `sidebars#update_order` does (users/sidebars.rs):
   * "forbidden" when `roomIds` isn't exactly the rooms they've starred, or null without a valid session.
   * Every tab of theirs hears the new order.
   */
  async setFavoriteOrder(credentials: Credentials, roomIds: RoomId[]): Promise<Favorites | "forbidden" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    const favorites = await this.store.setFavoriteOrder(user.id, roomIds);
    if (!favorites) return "forbidden";
    this.starsChanged(user.id, favorites);
    return favorites;
  }

  /** Tells every tab of `userId`'s what their stars are now. */
  private starsChanged(userId: UserId, favorites: Favorites) {
    this.tell([userId], { type: "favorites.changed", favorites });
  }

  /** Sends `frame` on the workspace sockets of each of `userIds`, every tab of theirs, and nobody else's. */
  private tell(userIds: Iterable<UserId>, frame: WorkspaceServerFrame): void {
    const data = JSON.stringify(frame);
    for (const userId of userIds) {
      for (const socket of this.ctx.getWebSockets(userId)) {
        try {
          socket.send(data);
        } catch {
          // It has closed since, and its close handler has nothing to clean up.
        }
      }
    }
  }

  /**
   * Creates a room as the person `credentials` signs in, or answers null without a valid session.
   * Everyone it puts in sees it in their sidebars at once, and nobody else hears of it.
   */
  async createRoom(credentials: Credentials, room: NewRoom): Promise<SharedRoom | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    const created: SharedRoom = { id: sortableId(), kind: room.kind, name: room.name, icon: room.icon || null };
    const memberIds = await this.store.createRoom(created, user.id, room.kind === "closed" ? room.memberIds : null, new Date().toISOString());
    this.tell(memberIds, { type: "room.saved", room: created });
    return created;
  }

  /**
   * Starts a DM as the person `credentials` signs in, as ember-rust's `directs#create` does
   * (rooms/directs.rs): the DM between them and the people `userIds` names who exist, whatever their
   * status, or their DM with themselves when it names nobody else. A group of people has one DM, so
   * the one they have opens again. Answers it, and whether it's new, or null without a valid session.
   * Everyone in a new DM sees it in their sidebars at once, and nobody else hears of it.
   */
  async startDirect(credentials: Credentials, userIds: UserId[]): Promise<{ room: DirectRoom; started: boolean } | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    const people = userIds.length > 0 ? await this.store.peopleWithIds(userIds) : [];
    const memberIds = [user.id, ...people.map((person) => person.id)];
    const direct = await this.store.startDirect(sortableId(), user.id, memberIds, new Date().toISOString());
    if (direct.started) this.tell(direct.room.members.map((member) => member.id), { type: "room.saved", room: direct.room });
    return direct;
  }

  /** What the New room forms list, everyone active, for the person `credentials` signs in, or null without a valid session. */
  async newRoomForm(credentials: Credentials): Promise<NewRoomForm | null> {
    const user = await this.authenticate(credentials);
    return user && { people: await this.store.activePeople() };
  }

  /**
   * Whom the person `credentials` signs in can mention in room `roomId`, or anywhere when it's null:
   * the first page of the active people there whose names contain `query`, by name. "not found" unless
   * they're in the room, or null without a valid session.
   */
  async mentionable(credentials: Credentials, roomId: RoomId | null, query: string): Promise<DirectoryEntry[] | "not found" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    if (roomId !== null && !(await this.store.isMember(roomId, user.id))) return "not found";
    return this.store.mentionable(query, roomId);
  }

  /** Everyone in the workspace, for the person `credentials` signs in, or null without a valid session. */
  async directory(credentials: Credentials): Promise<DirectoryEntry[] | null> {
    const user = await this.authenticate(credentials);
    return user && this.store.directory();
  }

  /**
   * Someone as their page shows them to the person `credentials` signs in, whatever their status, as
   * ember-rust's `users#show` finds them (users.rs), and with their email address and sign-in link to
   * administrators: "not found" if nobody has id `userId`, or null without a valid session.
   */
  async person(credentials: Credentials, userId: UserId): Promise<ShownPerson | "not found" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    const [person, administrator] = await Promise.all([this.store.personWithProfile(userId), this.store.isAdministrator(user.id)]);
    if (!person) return "not found";
    if (administrator) return { person, transferable: person.status === "active" && person.role !== "bot" };
    const { emailAddress, ...listed } = person;
    return { person: listed, transferable: false };
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
   * Makes the active person `userId` an administrator or a member as the person `credentials` signs
   * in, as ember-rust's `accounts/users#update` does, answering them as the people directory then lists
   * them: "forbidden" unless that's an administrator, "not found" unless `userId` is someone active, or
   * null without a valid session. A null `role` changes nothing, once that's checked. Unlike
   * ember-rust, which leaves it to the page, nobody can change their own role ("own role"), so there's
   * always an administrator, or a bot's ("bot"). Everyone's workspace sockets hear of a change.
   */
  async changeRole(
    credentials: Credentials,
    userId: UserId,
    role: PersonRole | null,
  ): Promise<DirectoryUser | "forbidden" | "not found" | "own role" | "bot" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    return this.oneAtATime(async () => {
      if (!(await this.store.isAdministrator(user.id))) return "forbidden";
      const person = await this.store.activePerson(userId);
      if (!person) return "not found";
      if (role === null) return this.directoryUser(person);
      if (userId === user.id) return "own role";
      if (person.role === "bot") return "bot";
      // As ember-rust's `User#update` writes only what differs (user.rs).
      if (role === person.role) return this.directoryUser(person);

      const now = new Date().toISOString();
      const changed = await this.directoryUser({ ...person, role, updatedAt: now });
      this.helpContactChanges++;
      try {
        // Their sessions are read again, so their next welcome says what they are now.
        await this.sessions.change(
          (session) => session.user.id === userId,
          () => this.store.changeRole(userId, role, now),
        );
      } finally {
        this.helpContactChanges++;
        // The first administrator, who may be someone else now.
        this.knownHelpContact = undefined;
      }
      this.broadcast({ type: "user.updated", user: changed });
      return changed;
    });
  }

  /** Someone as the people directory lists them, with their avatar's address. */
  private async directoryUser(person: DirectoryEntry): Promise<DirectoryUser> {
    return (await directoryOf([person], this.env.SESSION_SECRET))[0]!;
  }

  /** The profile of the person `credentials` signs in, or null without a valid session. */
  async profile(credentials: Credentials): Promise<YourProfile | null> {
    const user = await this.authenticate(credentials);
    const person = user && (await this.store.personWithProfile(user.id));
    return person && { userId: person.id, profile: profileOf(person) };
  }

  /**
   * Saves `changes` to the profile of the person `credentials` signs in, with `passwordDigest` as their
   * password if it isn't null, as ember-rust's `profiles#update` does (profiles.rs), answering the
   * profile as it is then: "email address taken" when someone else has the email address, where
   * ember-rust fails, or null without a valid session. A blank email address or bio is saved as none,
   * so any number of people can be without one. As ember-rust's `User#update` does, it writes only what
   * differs, and a new password leaves every session signed in. Everyone's workspace sockets hear of a
   * new name or bio, which the people directory lists.
   */
  async changeProfile(
    credentials: Credentials,
    changes: Omit<ProfileChanges, "password">,
    passwordDigest: string | null,
  ): Promise<YourProfile | "email address taken" | null> {
    return this.oneAtATime(async () => {
      // Checked in line, unlike most changes: a password reset ahead of it ends their sessions, and a
      // save whose session was still valid before then mustn't put back a password of its own.
      const user = await this.authenticate(credentials);
      if (!user) return null;
      const person = await this.store.personWithProfile(user.id);
      if (!person) return null;
      const profile: Profile = {
        name: changes.name ?? person.name,
        emailAddress: changes.emailAddress === undefined ? person.emailAddress : changes.emailAddress || null,
        bio: changes.bio === undefined ? person.bio : changes.bio || null,
      };
      const listed = profile.name !== person.name || profile.bio !== person.bio;
      if (!listed && profile.emailAddress === person.emailAddress && passwordDigest === null) return { userId: user.id, profile };
      if (profile.emailAddress !== person.emailAddress && profile.emailAddress !== null && (await this.store.personWithEmailAddress(profile.emailAddress))) {
        return "email address taken";
      }

      const now = new Date().toISOString();
      const administrator = person.role === "administrator";
      if (administrator) this.helpContactChanges++;
      try {
        // Their sessions are read again, so they're signed in by the name they have now.
        await this.sessions.change(
          (session) => session.user.id === user.id,
          () => this.store.changeProfile(user.id, { ...profile, passwordDigest }, now),
        );
      } finally {
        if (administrator) {
          this.helpContactChanges++;
          // The first administrator's name and email address, which may have changed.
          this.knownHelpContact = undefined;
        }
      }
      if (listed) {
        const { id, role, status } = person;
        this.broadcast({ type: "user.updated", user: await this.directoryUser({ id, name: profile.name, bio: profile.bio, role, status, updatedAt: now }) });
      }
      return { userId: user.id, profile };
    });
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
   * a valid session. Anyone it takes out of the room is told to reconnect, and finds it gone, and it
   * leaves their sidebars. Everyone in it sees it as it is now in theirs, or, when only who's in it
   * changed, the people it puts in do.
   */
  async changeRoom(credentials: Credentials, roomId: RoomId, changes: RoomChanges): Promise<SharedRoom | "not found" | "forbidden" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    return this.oneAtATime(async () => {
      const found = await this.store.roomToChange(roomId, user.id);
      if (!found) return "not found";
      if (!found.canAdminister) return "forbidden";
      const changed: SharedRoom = {
        ...found.room,
        ...(changes.name && { name: changes.name }),
        ...(changes.kind && { kind: changes.kind }),
        ...(changes.icon !== undefined && { icon: changes.icon || null }),
      };
      if (!changes.name && !changes.kind && changes.icon === undefined) return changed;
      const now = Date.now();
      // As when signing out, until the database says it queued nothing.
      let queued = changes.kind === "closed";
      let saved: SavedRoomChange;
      try {
        saved = await this.store.changeRoom(roomId, changes, CloseCode.Reconnect, now, new Date(now).toISOString());
        queued = saved.removedIds.length > 0;
      } finally {
        if (queued) await this.wakeAt(now);
      }
      this.tell(saved.removedIds, { type: "room.gone", roomId });
      this.tell(saved.roomChanged ? saved.memberIds : saved.addedIds, { type: "room.saved", room: changed });
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
   * (rooms.rs): "not found" unless they're in it, "forbidden" unless they can change it, or null
   * without a valid session. Anyone in a DM can delete it, as at ember-rust's DM address
   * (rooms/directs.rs). Everyone with it open is told it's gone, and its messages go with it. It leaves
   * the sidebars of the people who were in it, and nobody else hears of it, where ember-rust tells
   * everyone (broadcasts.rs).
   */
  async deleteRoom(credentials: Credentials, roomId: RoomId): Promise<"deleted" | "not found" | "forbidden" | null> {
    const user = await this.authenticate(credentials);
    if (!user) return null;
    return this.oneAtATime(async () => {
      const found = await this.store.roomToDelete(roomId, user.id);
      if (!found) return "not found";
      if (found.kind !== "direct" && !found.canAdminister) return "forbidden";
      const now = Date.now();
      let memberIds: UserId[];
      try {
        memberIds = await this.store.deleteRoom(roomId, CloseCode.NotFound, now, new Date(now).toISOString());
      } finally {
        // As when signing out: the database may have saved the deletion, and so queued it, though its answer was lost.
        await this.wakeAt(now);
      }
      this.tell(memberIds, { type: "room.gone", roomId });
      return "deleted";
    });
  }

  /**
   * Applies the events room `roomId` sends from its log, in order, with `viewerIds`, who is viewing
   * the room as it sends them: a new message marks the room unread for its members who aren't, and
   * someone opening it clears their mark. Each event is applied once, however often it's sent. Whoever's
   * mark changes hears of it on their workspace sockets, and nobody else does. A new message in a DM
   * moves it to the top of everyone's DMs there, its author's too, as in ember-rust every member's
   * sidebar hears of it (`unread_room`, broadcasts.rs), and one call's messages move it once.
   */
  async applyRoomEvents(roomId: RoomId, events: RoomEvent[], viewerIds: UserId[]): Promise<void> {
    if (events.length === 0) return;
    const { marks, active } = await this.store.applyRoomEvents(roomId, events, viewerIds);
    for (const [userId, unread] of marks) this.tell([userId], { type: unread ? "room.unread" : "room.read", roomId });
    if (active) this.tell(active.userIds, { type: "room.active", roomId, at: active.at });
  }

  /**
   * The people of `ids` who exist, whatever their status, for a room naming the people a message
   * mentions, as ember-rust finds a mention's user (`User::find_by_id`).
   */
  async mentionedPeople(ids: UserId[]): Promise<User[]> {
    return this.store.peopleWithIds(ids);
  }

  /**
   * Whether `userId` is an active administrator now, for a room deciding whether they may edit or
   * delete someone else's message. Rooms ask, since a role can change while their sockets are open.
   */
  async isAdministrator(userId: UserId): Promise<boolean> {
    return this.store.isAdministrator(userId);
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
