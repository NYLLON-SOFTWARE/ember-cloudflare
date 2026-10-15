import { DurableObject } from "cloudflare:workers";
import {
  CloseCode,
  HISTORY_PAGE_SIZE,
  isMessageTooLong,
  MESSAGE_TOO_LONG,
  parseClientFrame,
  parseRoomSocketParams,
  ROOM_PROTOCOL,
  type ClientFrame,
  type Message,
  type RoomId,
  type ServerFrame,
  type User,
  type UserId,
} from "@ember/protocol";
import { prepareBody, userIdFromSgid, userIdsIn, type PreparedBody } from "@ember/richtext";
import { openDb, type Db } from "./db";
import type { Env } from "./env";
import { sortableId } from "./ids";
import { EVERYONE, REVOCATIONS_KEPT_MS, Revocations, sessionTag, type Revocation } from "./revocations";
import { RoomLog } from "./room-log";
import { CLOSE_REASONS, closedAtOnce, RESERVED_CLOSE_CODES } from "./sockets";
import { MessageStore } from "./store";
import { viewersOf, type Viewing } from "./viewing";
import { workspace } from "./workspace";

/** What each socket remembers across hibernation. */
interface Attachment extends Viewing {
  roomId: RoomId;
  /** The revision of the room protocol its tab speaks, as its address said. Absent on sockets let in before the room asked. */
  protocol?: number;
  /** Set once the room has closed the socket for a revocation, which announced that it left. */
  revoked?: true;
}

export const USER_HEADER = "X-Ember-User";
export const ROOM_HEADER = "X-Ember-Room";
export const SESSION_HEADER = "X-Ember-Session";
/** When the Workspace checked the socket's session and membership, in milliseconds since the epoch. */
export const AUTHORIZED_AT_HEADER = "X-Ember-Authorized-At";

/** What a deleted room's object keeps in its own storage until its alarm: the room's id, whose records the alarm erases. */
const DELETED_ROOM = "deletedRoom";
/** What a room's object keeps in its own storage while its alarm is to send the Workspace its log: the room's id. */
const UNDELIVERED_ROOM = "undeliveredRoom";

/** Why the room keeps nothing of a message: it couldn't show it, or there's nothing in it. `MESSAGE_TOO_LONG` says when there's too much. */
const UNREADABLE = "That message couldn't be saved.";
const EMPTY = "Your message is empty.";
/** What the room tells a tab running an app older than its protocol, whose messages and edits it refuses. */
const OUTDATED = "Ember has been updated. Reload the page to keep chatting.";
/** Whether `ws`'s tab runs an app older than the room protocol. */
const isOutdated = (ws: WebSocket) => ((ws.deserializeAttachment() as Attachment).protocol ?? 1) < ROOM_PROTOCOL;

/** How many events of its log a room sends the Workspace in one call, at most. */
const EVENTS_PER_CALL = 50;
/**
 * How long a room waits after a call before the next, gathering the events logged meanwhile, unless
 * the call was full or a full call's worth is logged sooner. So a busy room sends many in each call,
 * and makes at most four calls a second until they fill.
 */
const GATHER_MS = 250;
/** How long a room waits to send its log again after a call fails, doubling each time up to the longest wait. */
const FIRST_RETRY_MS = 1_000;
const LONGEST_RETRY_MS = 5 * 60 * 1000;

/**
 * One chat room: its WebSockets, who is present and typing, and its messages.
 * Uses the hibernation API, so an idle room costs nothing while sockets stay open.
 */
export class ChatRoom extends DurableObject<Env> {
  private db: Db | null = null;
  private store: MessageStore | null = null;
  private revocations: Revocations | null = null;
  private log: RoomLog | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** The call sending the Workspace the room's log, while one is out. */
  private delivering: Promise<void> | null = null;
  /** Whether the log has had events since the call out now read it, so another call goes once it's done. */
  private undelivered = false;
  /** Roughly how many events the room has logged since the call out read the log. */
  private logged = 0;
  /** Ends the wait after a call, while there is one, once a full call's worth of events is logged. */
  private stopGathering: (() => void) | null = null;
  /** How many calls in a row have failed, which puts the next try off longer. */
  private failedDeliveries = 0;
  /** When the room may call the Workspace again after a call failed, which its alarm is set for. */
  private retryAt = 0;
  /**
   * Whether the object has sent the Workspace its log since it started. A restart in the middle of a
   * call, as a deploy can make, leaves the call's events in the log with no alarm set to send them.
   */
  private logChecked = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeats are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const user = JSON.parse(request.headers.get(USER_HEADER) ?? "null") as User | null;
    const roomId = request.headers.get(ROOM_HEADER);
    const sessionId = request.headers.get(SESSION_HEADER);
    const authorizedAt = Number(request.headers.get(AUTHORIZED_AT_HEADER) ?? NaN);
    if (!user || !roomId || !sessionId || !Number.isFinite(authorizedAt)) return new Response("Missing user, room, session or time", { status: 400 });
    const { visible, since, protocol } = parseRoomSocketParams(new URL(request.url).searchParams);

    return this.serially(async () => {
      const tags = [user.id, sessionTag(sessionId)];
      // Read side by side, so a room that has just woken waits on D1 once.
      const [refused, opening] = await Promise.all([this.revocationsFor(roomId).refuse(tags, authorizedAt), this.opening(roomId, since)]);
      if (refused) return closedAtOnce(CloseCode.Reconnect);
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server, tags);
      server.serializeAttachment({ user, roomId, visible, protocol, heardAt: Date.now() } satisfies Attachment);

      this.send(server, { ...opening, you: user, present: this.present() });
      // A tab running an older app hears at once that it has to reload, rather than once it sends something.
      if (protocol < ROOM_PROTOCOL) this.send(server, { type: "error", message: OUTDATED });
      // Everyone else has the list from their own welcome, so they only hear who's new.
      if (!this.isPresent(user.id, server)) this.broadcast({ type: "presence.joined", user }, server);
      // Opening the room in a shown tab reads it, which sends the Workspace the log. Logged next,
      // rather than before the socket is let in, so the welcome doesn't wait on it.
      if (visible) void this.serially(() => this.read(roomId, user.id)).catch((error) => console.error("Could not log a read", error));
      // Otherwise the first socket since the object started sends whatever a restart left in the log.
      else if (!this.logChecked) this.deliver(roomId);
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  /**
   * What a socket starts with: what changed since `since`, the latest change its tab has seen, if it
   * names one and the room keeps every change after it, or else a welcome's newest page.
   */
  private async opening(roomId: RoomId, since: number | undefined) {
    const store = this.storeFor(roomId);
    const changes = since === undefined ? null : await store.changesSince(since);
    if (changes) return { type: "resumed" as const, ...changes };
    return { type: "welcome" as const, ...(await store.newest(HISTORY_PAGE_SIZE)) };
  }

  /** Resolves once the room's messages can be read. */
  async health(roomId: RoomId): Promise<void> {
    await this.serially(() => this.storeFor(roomId).page(1));
  }

  /**
   * Closes the sockets each of `revocations` names here, with its code, once the Workspace has saved
   * the change that ended their access, and turns away their sockets that it let through at or
   * before `revokedAt`, which may have been checked before the change. Queued behind the events
   * before it, so a socket it was opening is closed too. Whoever loses their last socket here leaves
   * at once, rather than when their app answers the close, which it may never do.
   */
  async revoke(roomId: RoomId, revocations: Revocation[], revokedAt: number): Promise<void> {
    await this.serially(async () => {
      await this.revocationsFor(roomId).record(
        revocations.map(({ tag }) => tag),
        revokedAt,
      );
      const deletion = revocations.find(({ tag }) => tag === EVERYONE);
      if (deletion) return this.destroy(roomId, deletion.code);
      const leaving = new Map<UserId, User>();
      for (const { tag, code } of revocations) {
        for (const socket of this.ctx.getWebSockets(tag)) {
          const user = this.close(socket, code);
          if (user) leaving.set(user.id, user);
        }
      }
      for (const user of leaving.values()) this.depart(user);
    });
  }

  /**
   * Closes every socket in a room the Workspace has deleted, with `code`, and deletes its messages, as
   * ember-rust's `Room::destroy` does (room.rs). Nobody is left to hear who leaves. The record that
   * the room was deleted stays, turning away sockets let through before then, until none of those
   * could still arrive, when the alarm erases it.
   */
  private async destroy(roomId: RoomId, code: CloseCode): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) this.close(socket, code);
    await this.storeFor(roomId).deleteAllMessages();
    await this.logFor(roomId).forget();
    await this.ctx.storage.put(DELETED_ROOM, roomId);
    await this.ctx.storage.setAlarm(Date.now() + REVOCATIONS_KEPT_MS);
  }

  /**
   * Erases what's left of a deleted room: its revocations, and the object's own storage, which on DO
   * SQLite is everything it kept. An object with nothing stored ceases to exist. Otherwise, sends the
   * Workspace the room's log, which a call that failed left.
   */
  override async alarm(): Promise<void> {
    const undelivered = await this.serially(async () => {
      const roomId = await this.ctx.storage.get<RoomId>(DELETED_ROOM);
      if (roomId === undefined) return this.ctx.storage.get<RoomId>(UNDELIVERED_ROOM);
      await this.revocationsFor(roomId).forget();
      await this.ctx.storage.deleteAll();
      // Its tables went too, so anything after this opens the database afresh.
      this.db = this.store = this.revocations = this.log = null;
      return undefined;
    });
    if (undelivered === undefined) return;
    await this.ctx.storage.delete(UNDELIVERED_ROOM);
    this.retryAt = 0;
    this.deliver(undelivered);
    while (this.delivering) await this.delivering;
  }

  /** Everyone who wrote or reacted in the room, for the Workspace to keep when it registers a legacy room. */
  async authors(roomId: RoomId): Promise<User[]> {
    return this.serially(() => this.storeFor(roomId).authors());
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const frame = typeof raw === "string" ? parseClientFrame(raw) : null;
    if (!frame) return this.send(ws, { type: "error", message: "Unrecognized frame" });

    const { user, roomId } = ws.deserializeAttachment() as Attachment;
    await this.serially(async () => {
      // A socket the room has closed, as when its access was revoked, can't change anything, even
      // with frames it sent before it heard.
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        await this.handle(ws, user, this.storeFor(roomId), frame);
      } catch (error) {
        console.error("ChatRoom frame failed", frame.type, error);
        const clientMessageId = frame.type === "message.create" ? frame.clientMessageId : undefined;
        const clientMessageIds = frame.type === "message.check" ? frame.clientMessageIds : undefined;
        this.send(ws, { type: "error", message: "Something went wrong", clientMessageId, clientMessageIds, failed: frame.type });
      }
    });
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    ws.close(RESERVED_CLOSE_CODES.has(code) ? 1000 : code, "Closing");
    await this.serially(async () => this.leave(ws));
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.serially(async () => this.leave(ws));
  }

  /**
   * Runs one event at a time. Durable Object storage holds other events back while it works,
   * but D1 queries are network calls that don't, so without this a joining socket could get
   * live frames before its snapshot, or an edit could broadcast reactions it read too early.
   */
  private serially<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }

  private async handle(ws: WebSocket, user: User, store: MessageStore, frame: ClientFrame): Promise<void> {
    const now = new Date().toISOString();

    switch (frame.type) {
      case "message.create": {
        if (isOutdated(ws)) return this.send(ws, { type: "error", message: OUTDATED, clientMessageId: frame.clientMessageId, failed: frame.type });
        const body = await this.prepare(frame.body);
        if (typeof body === "string") return this.send(ws, { type: "error", message: body, clientMessageId: frame.clientMessageId, failed: frame.type });
        const { message, seq } = await store.create(sortableId(), frame.clientMessageId, user, body, now);
        this.broadcast({ type: "message.created", message, seq });
        return this.deliver(store.roomId);
      }
      case "message.update": {
        const message = await store.find(frame.messageId);
        if (!message || !(await this.canAdminister(user, message))) return this.refuse(ws, "You can only edit your own messages");
        if (isOutdated(ws)) return this.send(ws, { type: "error", message: OUTDATED, failed: frame.type });
        const body = await this.prepare(frame.body);
        if (typeof body === "string") return this.send(ws, { type: "error", message: body, failed: frame.type });
        // Saved as it was, it stays as it was, its update time included, as Rails saves nothing then.
        if (body.html === message.body) return;
        const { message: updated, seq } = await store.updateBody(message, body, now);
        return this.broadcast({ type: "message.updated", message: updated, seq });
      }
      case "message.delete": {
        const message = await store.find(frame.messageId);
        if (!message || !(await this.canAdminister(user, message))) return this.refuse(ws, "You can only delete your own messages");
        const seq = await store.delete(message.id);
        return this.broadcast({ type: "message.deleted", messageId: message.id, seq });
      }
      case "boost.create": {
        const message = await store.find(frame.messageId);
        if (!message) return this.refuse(ws, "That message no longer exists");
        // Unlike ember-rust, a person adds each reaction once, so one they've already added is a repeated click.
        if (message.boosts.some((b) => b.booster.id === user.id && b.content === frame.content)) return;
        const { boost, seq } = await store.addBoost(sortableId(), frame.messageId, user, frame.content, now);
        return this.broadcast({ type: "boost.created", boost, seq });
      }
      case "boost.delete": {
        const boost = await store.findBoost(frame.boostId);
        if (!boost || boost.booster.id !== user.id) return this.refuse(ws, "You can only remove your own reactions");
        const seq = await store.removeBoost(boost);
        return this.broadcast({ type: "boost.deleted", boostId: boost.id, messageId: boost.messageId, seq });
      }
      case "typing.start":
      case "typing.stop":
        return this.broadcast({ type: "typing", user, typing: frame.type === "typing.start" }, ws);
      case "history.before": {
        const { messages, hasMore } = await store.page(frame.limit ?? HISTORY_PAGE_SIZE, frame.before);
        return this.send(ws, { type: "history", messages, hasMore });
      }
      case "message.check": {
        const stored = await store.storedClientMessageIds(user, frame.clientMessageIds);
        const missing = frame.clientMessageIds.filter((id) => !stored.includes(id));
        return this.send(ws, { type: "message.checked", stored, missing });
      }
      case "presence.visible": {
        const attachment = ws.deserializeAttachment() as Attachment;
        ws.serializeAttachment({ ...attachment, visible: frame.visible, heardAt: Date.now() } satisfies Attachment);
        // Coming back to a tab showing the room reads it.
        if (frame.visible) await this.read(store.roomId, user.id);
        return;
      }
      case "ping":
        return this.send(ws, { type: "pong" });
    }
  }

  /**
   * Whether `user` may edit or delete `message`: its author or an administrator, as ember-rust's
   * `can_administer?` decides (messages.rs). Only someone else's message asks the Workspace.
   */
  private async canAdminister(user: User, message: Message): Promise<boolean> {
    return message.creator.id === user.id || (await workspace(this.env).isAdministrator(user.id));
  }

  /**
   * What the room keeps of a body a client sent, naming the people it mentions as they are now, or
   * why it keeps nothing.
   */
  private async prepare(markup: string): Promise<PreparedBody | string> {
    const ids = userIdsIn(markup);
    const people = new Map<UserId, User>(ids.length === 0 ? [] : (await workspace(this.env).mentionedPeople(ids)).map((person) => [person.id, person]));
    const body = prepareBody(markup, (sgid) => people.get(userIdFromSgid(sgid) ?? ""));
    if (body === null) return UNREADABLE;
    if (body.blank) return EMPTY;
    return isMessageTooLong(body.plainText) ? MESSAGE_TOO_LONG : body;
  }

  /** The room's database, with its migrations applied first if its storage needs them. */
  private dbFor(): Db {
    return (this.db ??= openDb(this.env, this.ctx.storage, "room"));
  }

  private storeFor(roomId: RoomId): MessageStore {
    return (this.store ??= new MessageStore(this.dbFor(), roomId));
  }

  private revocationsFor(roomId: RoomId): Revocations {
    return (this.revocations ??= new Revocations(this.dbFor(), roomId));
  }

  private logFor(roomId: RoomId): RoomLog {
    return (this.log ??= new RoomLog(this.dbFor(), roomId));
  }

  /** Logs that `userId` has read the room, for the Workspace to clear their mark, and sends it the log. */
  private async read(roomId: RoomId, userId: UserId): Promise<void> {
    await this.logFor(roomId).read(userId, new Date().toISOString());
    this.deliver(roomId);
  }

  /**
   * Sends the Workspace the room's log, with who is viewing the room now, for it to mark the room
   * unread for the members who aren't and read for those who've opened it. One call is out at a
   * time, and the events logged meanwhile go in the next, a moment after it, or at once if the call
   * left some behind or a full call's worth comes first. When a call fails, the next waits for the
   * alarm, which tries again later, from the first event the Workspace hasn't taken.
   */
  private deliver(roomId: RoomId): void {
    this.undelivered = true;
    if (++this.logged >= EVENTS_PER_CALL) this.stopGathering?.();
    if (this.delivering || Date.now() < this.retryAt) return;
    this.undelivered = false;
    this.delivering = this.deliverBatch(roomId)
      .then((full) => (full ? undefined : this.gather()))
      .finally(() => {
        this.delivering = null;
        if (this.undelivered) this.deliver(roomId);
      });
  }

  /** Waits after a call for the events logged meanwhile, until a full call's worth is or `GATHER_MS` passes. */
  private async gather(): Promise<void> {
    if (this.logged >= EVENTS_PER_CALL) return;
    await new Promise<void>((resolve) => {
      this.stopGathering = resolve;
      void scheduler.wait(GATHER_MS).then(resolve);
    });
    this.stopGathering = null;
  }

  /**
   * Sends the Workspace the oldest events it hasn't taken, as many as one call takes, and forgets them
   * once it has. Answers whether the call was full, which may have left more behind.
   */
  private async deliverBatch(roomId: RoomId): Promise<boolean> {
    this.logChecked = true;
    this.logged = 0;
    try {
      const log = this.logFor(roomId);
      const events = await log.undelivered(EVENTS_PER_CALL);
      if (events.length === 0) return false;
      await workspace(this.env).applyRoomEvents(roomId, events, viewersOf(this.ctx));
      await log.delivered(events.at(-1)!.seq);
      this.failedDeliveries = 0;
      if (events.length < EVENTS_PER_CALL) return false;
      this.undelivered = true;
      return true;
    } catch (error) {
      console.error(`Could not send room ${roomId}'s log to the Workspace; trying again later`, error);
      this.failedDeliveries++;
      await this.serially(() => this.deliverLater(roomId)).catch((error) => console.error("Could not set the alarm to send the log", error));
      return false;
    }
  }

  /**
   * Sets the alarm to send the room's log, a second after the first failure and twice as long after
   * each one since, up to the longest wait, and makes no calls until then, however much the room logs.
   * A deleted room's alarm is for erasing it, so it's left as it is; this runs one event at a time
   * with deleting it, so the deletion's alarm can't be overtaken.
   */
  private async deliverLater(roomId: RoomId): Promise<void> {
    if ((await this.ctx.storage.get(DELETED_ROOM)) !== undefined) return;
    await this.ctx.storage.put(UNDELIVERED_ROOM, roomId);
    const at = Date.now() + Math.min(LONGEST_RETRY_MS, FIRST_RETRY_MS * 2 ** (this.failedDeliveries - 1));
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > at) await this.ctx.storage.setAlarm(at);
    this.retryAt = at;
  }

  /** Everyone with at least one open socket, once each. */
  private present(): User[] {
    const users = new Map<string, User>();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const { user } = socket.deserializeAttachment() as Attachment;
      users.set(user.id, user);
    }
    return [...users.values()];
  }

  /** Whether someone has the room open in a socket other than `except`. */
  private isPresent(userId: UserId, except?: WebSocket): boolean {
    return this.ctx.getWebSockets(userId).some((socket) => socket !== except && socket.readyState === WebSocket.OPEN);
  }

  /** Closes `socket` with `code` for a revocation, if it's open, and answers whose it was. */
  private close(socket: WebSocket, code: CloseCode): User | null {
    if (socket.readyState !== WebSocket.OPEN) return null;
    const attachment = socket.deserializeAttachment() as Attachment;
    socket.serializeAttachment({ ...attachment, revoked: true } satisfies Attachment);
    socket.close(code, CLOSE_REASONS[code]);
    return attachment.user;
  }

  /** Lets everyone know a socket has closed, unless the room closed it for a revocation and said so already. */
  private leave(ws: WebSocket): void {
    const { user, revoked } = ws.deserializeAttachment() as Attachment;
    if (!revoked) this.depart(user, ws);
  }

  /** Tells the room that `user` closed a socket, `closed` if it's just the one, and has left if it was their last. */
  private depart(user: User, closed?: WebSocket): void {
    // Closing one of several tabs only stops the typing it may have been doing.
    if (this.isPresent(user.id, closed)) this.broadcast({ type: "typing", user, typing: false }, closed);
    else this.broadcast({ type: "presence.left", userId: user.id }, closed);
  }

  private refuse(ws: WebSocket, message: string): void {
    this.send(ws, { type: "error", message });
  }

  private send(ws: WebSocket, frame: ServerFrame): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // The socket closed between lookup and send; its close handler cleans up.
    }
  }

  private broadcast(frame: ServerFrame, except?: WebSocket): void {
    const data = JSON.stringify(frame);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try {
        socket.send(data);
      } catch {
        // As above.
      }
    }
  }
}
