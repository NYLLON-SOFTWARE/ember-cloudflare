import { DurableObject } from "cloudflare:workers";
import {
  CloseCode,
  HISTORY_PAGE_SIZE,
  isMessageTooLong,
  MAX_BOOST_LENGTH,
  MESSAGE_TOO_LONG,
  parseClientFrame,
  parseRoomSocketParams,
  ROOM_PROTOCOL,
  type Boost,
  type ClientFrame,
  type Message,
  type NewUpload,
  type RoomId,
  type ServerFrame,
  type TimelinePage,
  type User,
  type UserId,
} from "@ember/protocol";
import { prepareBody, userIdFromSgid, userIdsIn, type PreparedBody } from "@ember/richtext";
import { JobQueue } from "./at-once";
import { postWebhook, WebhookError, webhookPayload } from "./bots/webhooks";
import { Courier, ENTRIES_PER_CALL } from "./courier";
import { openDb, type Db } from "./db";
import type { Env } from "./env";
import { Blobs, type Identified, type RoomBlob, type UploadedPart } from "./files/blobs";
import type { Uploader } from "./files/uploads";
import { base36, sortableId } from "./ids";
import { sendPushes } from "./push/delivery";
import { addressTag, EVERYONE, REVOCATIONS_KEPT_MS, Revocations, sessionTag, type Revocation } from "./revocations";
import { RoomLog } from "./room-log";
import { searchIndex } from "./search-index";
import { CLOSE_REASONS, closedAtOnce, RESERVED_CLOSE_CODES } from "./sockets";
import { MessageStore, type PageCursor } from "./store";
import { viewersOf, type Viewing } from "./viewing";
import { workspace, type BotAccess } from "./workspace";
import type { MessagePush, MessageWebhook } from "./workspace-store";

/** What each socket remembers across hibernation. */
interface Attachment extends Viewing {
  roomId: RoomId;
  /** The revision of the room protocol its tab speaks, as its address said. Absent on sockets let in before the room asked. */
  protocol?: number;
  /** Set once the room has closed the socket for a revocation, which announced that it left. */
  revoked?: true;
  /** Set when a ban blocks the IP address the socket comes from: it can read, but not change anything. */
  banned?: true;
}

export const USER_HEADER = "X-Ember-User";
export const ROOM_HEADER = "X-Ember-Room";
export const SESSION_HEADER = "X-Ember-Session";
/** When the Workspace checked the socket's session and membership, in milliseconds since the epoch. */
export const AUTHORIZED_AT_HEADER = "X-Ember-Authorized-At";
/** The IP address the socket comes from, which the room tags it with, so banning the address can find it. */
export const ADDRESS_HEADER = "X-Ember-Address";
/** "true" when a ban blocks the IP address the socket comes from. */
export const BANNED_HEADER = "X-Ember-Banned";

/** What a deleted room's object keeps in its own storage until its alarm: the room's id, whose records the alarm erases. */
const DELETED_ROOM = "deletedRoom";
/** What a room's object keeps in its own storage while its alarm is to send its logs: the room's id. */
const UNDELIVERED_ROOM = "undeliveredRoom";

/** Why the room keeps nothing of a message: it couldn't show it, or there's nothing in it. `MESSAGE_TOO_LONG` says when there's too much. */
const UNREADABLE = "That message couldn't be saved.";
const EMPTY = "Your message is empty.";
/** What the room tells a tab running an app older than its protocol, whose messages and edits it refuses. */
const OUTDATED = "Ember has been updated. Reload the page to keep chatting.";
/**
 * What the room tells a socket from a banned IP address that tries to change something, as the app
 * says of the 429 that ember-rust, and the Worker, answer such a request with.
 */
const BANNED = "Request failed (429)";
/** The frames that change something, which a banned address's sockets can't send, as ember-rust's are all requests it refuses. */
const CHANGES = new Set<ClientFrame["type"]>(["message.create", "message.update", "message.delete", "boost.create", "boost.delete"]);
/** Whether `ws`'s tab runs an app older than the room protocol. */
const isOutdated = (ws: WebSocket) => ((ws.deserializeAttachment() as Attachment).protocol ?? 1) < ROOM_PROTOCOL;

/** A page of a room's messages as the bot API reads it, with how many messages the room has. */
export interface BotPage extends Omit<TimelinePage, "around"> {
  total: number;
}

/** What the room answers a bot that names a message it doesn't have. */
export const NOT_FOUND = "not found";
/** What the room answers a bot that names someone else's message, which it can't change. */
export const FORBIDDEN = "forbidden";
/** What the room answers a bot whose boost has nothing in it. */
export const BLANK = "blank";
/** Why the room keeps no longer boost, where ember-rust's column holds 16 characters but SQLite keeps any. */
const BOOST_TOO_LONG = `Boosts can be up to ${MAX_BOOST_LENGTH} characters.`;

/**
 * How many of a room's deliveries to bots' webhooks run at once, as many as ember-rust's job runner
 * runs by default (`JOB_CONCURRENCY`), and how many more can wait, as many as it lets wait (`QUEUE_CAPACITY`).
 */
const WEBHOOKS_AT_ONCE = 2;
const WEBHOOKS_WAITING = 1024;

/** How long an Active Storage key is: `MINIMUM_TOKEN_LENGTH`. */
const KEY_LENGTH = 28;

/** What sends each of a room's logs (see `couriersFor`). */
interface Couriers {
  /** Sends the Workspace the room's events, which it marks the room unread and read by. */
  workspace: Courier;
  /** Sends the search index the messages written, edited and deleted. */
  index: Courier;
}

/**
 * One chat room: its WebSockets, who is present and typing, and its messages.
 * Uses the hibernation API, so an idle room costs nothing while sockets stay open.
 */
export class ChatRoom extends DurableObject<Env> {
  private db: Db | null = null;
  private store: MessageStore | null = null;
  private revocations: Revocations | null = null;
  private log: RoomLog | null = null;
  private blobs: Blobs | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private couriers: Couriers | null = null;
  private readonly webhooks = new JobQueue(WEBHOOKS_AT_ONCE, WEBHOOKS_WAITING);

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
    const address = request.headers.get(ADDRESS_HEADER);
    const banned = request.headers.get(BANNED_HEADER) === "true";
    const { visible, since, around, protocol } = parseRoomSocketParams(new URL(request.url).searchParams);

    return this.serially(async () => {
      const tags = [user.id, sessionTag(sessionId), ...(address ? [addressTag(address)] : [])];
      // Read side by side, so a room that has just woken waits on D1 once.
      const [refused, opening] = await Promise.all([this.revocationsFor(roomId).refuse(tags, authorizedAt), this.opening(roomId, since, around)]);
      if (refused) return closedAtOnce(CloseCode.Reconnect);
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server, tags);
      server.serializeAttachment({ user, roomId, visible, protocol, heardAt: Date.now(), ...(banned && { banned }) } satisfies Attachment);

      this.send(server, { ...opening, you: user, present: this.present() });
      // A tab running an older app hears at once that it has to reload, rather than once it sends something.
      if (protocol < ROOM_PROTOCOL) this.send(server, { type: "error", message: OUTDATED });
      // Everyone else has the list from their own welcome, so they only hear who's new.
      if (!this.isPresent(user.id, server)) this.broadcast({ type: "presence.joined", user }, server);
      const couriers = this.couriersFor(roomId);
      // Opening the room in a shown tab reads it, which sends the Workspace the log. Logged next,
      // rather than before the socket is let in, so the welcome doesn't wait on it.
      if (visible) void this.serially(() => this.read(roomId, user.id)).catch((error) => console.error("Could not log a read", error));
      // Otherwise the first socket since the object started sends whatever a restart left in the log.
      else if (!couriers.workspace.checked) couriers.workspace.deliver();
      // And the search index's, which nothing else here sends.
      if (!couriers.index.checked) couriers.index.deliver();
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  /**
   * What a socket starts with: what changed since `since`, the latest change its tab has seen, if it
   * names one and the room keeps every change after it, or else a welcome's page, which is the one
   * around the message `around` names, for a tab opened at its permalink, or the newest.
   */
  private async opening(roomId: RoomId, since: number | undefined, around: string | undefined) {
    const store = this.storeFor(roomId);
    const changes = since === undefined ? null : await store.changesSince(since);
    if (changes) return { type: "resumed" as const, ...changes };
    return { type: "welcome" as const, ...(await store.opening(HISTORY_PAGE_SIZE, around)) };
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
   * ember-rust's `Room::destroy` does (room.rs), and has the search index forget them. Nobody is left
   * to hear who leaves. The record that the room was deleted stays, turning away sockets let through
   * before then, until none of those could still arrive, when the alarm erases it. A failure has the
   * Workspace ask again.
   */
  private async destroy(roomId: RoomId, code: CloseCode): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) this.close(socket, code);
    await this.storeFor(roomId).deleteAllMessages();
    await this.blobsFor(roomId).deleteAll();
    await this.logFor(roomId).forget();
    await searchIndex(this.env).forget(roomId);
    await this.ctx.storage.put(DELETED_ROOM, roomId);
    await this.ctx.storage.setAlarm(Date.now() + REVOCATIONS_KEPT_MS);
  }

  /**
   * Erases what's left of a deleted room: its revocations, and the object's own storage, which on DO
   * SQLite is everything it kept. An object with nothing stored ceases to exist. Otherwise, sends the
   * room's logs, which a call that failed left, or which `reindex` filled.
   */
  override async alarm(): Promise<void> {
    const undelivered = await this.serially(async () => {
      const roomId = await this.ctx.storage.get<RoomId>(DELETED_ROOM);
      if (roomId === undefined) return this.ctx.storage.get<RoomId>(UNDELIVERED_ROOM);
      await this.revocationsFor(roomId).forget();
      await this.ctx.storage.deleteAll();
      // Its tables went too, so anything after this opens the database afresh.
      this.db = this.store = this.revocations = this.log = this.blobs = null;
      return undefined;
    });
    if (undelivered === undefined) return;
    const couriers = this.couriersFor(undelivered);
    await Promise.all([couriers.workspace.retry(), couriers.index.retry()]);
    // Kept until then, so an alarm cut off as it sends, as a deploy can do, sends the rest when it's
    // retried. A courier whose last call failed has set the alarm again, for its next try.
    if (!couriers.workspace.failing && !couriers.index.failing) await this.ctx.storage.delete(UNDELIVERED_ROOM);
  }

  /**
   * Deletes up to `limit` of `userId`'s messages here, with their boosts, telling everyone in the room
   * of each, as ember-rust's `RemoveBannedContentJob` does once someone is banned (jobs.rs), and
   * answers whether any of theirs are left. Once the ban has been lifted, at `liftedAt`, only those
   * written by then count.
   */
  async removeMessagesBy(roomId: RoomId, userId: UserId, limit: number, liftedAt: string | null): Promise<boolean> {
    return this.serially(async () => {
      const store = this.storeFor(roomId);
      const ids = await store.messageIdsBy(userId, limit + 1, liftedAt);
      const removed = ids.slice(0, limit);
      if (removed.length === 0) return false;
      const seq = await store.delete(removed);
      removed.forEach((messageId, index) => this.broadcast({ type: "message.deleted", messageId, seq: seq + index }));
      this.couriersFor(roomId).index.deliver();
      return ids.length > limit;
    });
  }

  /**
   * Has the search index take every message the room has afresh, as the Workspace asks of each room
   * once the index is new: logs them all for it, and has the alarm send them, which a restart can't
   * stop.
   */
  async reindex(roomId: RoomId): Promise<void> {
    await this.serially(() => this.logFor(roomId).reindex());
    await this.wakeAt(roomId, Date.now());
  }

  /**
   * The messages `ids` names, for search results, leaving out any the room no longer has: the search
   * index can name one deleted since it last heard from the room.
   */
  async messagesWithIds(roomId: RoomId, ids: string[]): Promise<Message[]> {
    return this.serially(() => this.storeFor(roomId).withIds(ids));
  }

  /** Everyone who wrote or reacted in the room, for the Workspace to keep when it registers a legacy room. */
  async authors(roomId: RoomId): Promise<User[]> {
    return this.serially(() => this.storeFor(roomId).authors());
  }

  /**
   * Posts `markup` as a message from the bot the Workspace let in, as ember-rust's bot API does
   * (messages/by_bots.rs `create`): as a socket's message.create does, with a client message id of its
   * own, as Campfire gives one (`Random.uuid`, message.rb). Answers the message, why the room keeps
   * nothing of it, or null once the room has heard that the bot's access ended, or the room was deleted,
   * after the Workspace checked, as it turns away a socket then.
   */
  async createBotMessage(roomId: RoomId, { bot, authorizedAt }: BotAccess, markup: string): Promise<Message | string | null> {
    return this.serially(async () => {
      const now = new Date().toISOString();
      if (await this.revocationsFor(roomId).refuse([bot.id], authorizedAt)) return null;
      const body = await this.prepare(markup);
      if (typeof body === "string") return body;
      return this.create(this.storeFor(roomId), bot, crypto.randomUUID(), body, now);
    });
  }

  /**
   * A page of the room's messages for the bot API, as ember-rust's `index` reads one (messages/by_bots.rs):
   * the page `cursor` names, with how many messages the room has, or null when the cursor isn't one of them.
   */
  async botPage(roomId: RoomId, cursor: PageCursor): Promise<BotPage | null> {
    return this.serially(async () => {
      const store = this.storeFor(roomId);
      const [page, total] = await Promise.all([store.pageAt(cursor, HISTORY_PAGE_SIZE), store.count()]);
      return page && { ...page, total };
    });
  }

  /**
   * Replaces the text of the bot's message `messageId` with `markup`, as ember-rust's bot API does
   * (messages/by_bots.rs `update`): as a socket's message.update does, answering the message as it is
   * now. Answers `NOT_FOUND` when the room turns the bot away, as `createBotMessage` does, or has no such
   * message, `FORBIDDEN` when it's someone else's, then why the room keeps nothing of `markup`.
   */
  async editBotMessage(roomId: RoomId, { bot, authorizedAt }: BotAccess, messageId: string, markup: string): Promise<Message | string> {
    return this.serially(async () => {
      const now = new Date().toISOString();
      if (await this.revocationsFor(roomId).refuse([bot.id], authorizedAt)) return NOT_FOUND;
      const store = this.storeFor(roomId);
      const message = await this.botsOwn(store, bot, messageId);
      if (typeof message === "string") return message;
      const body = await this.prepare(markup);
      return typeof body === "string" ? body : this.edit(store, message, body, now);
    });
  }

  /**
   * Deletes the bot's message `messageId`, with its boosts, as ember-rust's bot API does
   * (messages/by_bots.rs `destroy`): as a socket's message.delete does, answering null, or `NOT_FOUND`
   * when the room turns the bot away, as `createBotMessage` does, or has no such message, and `FORBIDDEN`
   * when it's someone else's.
   */
  async deleteBotMessage(roomId: RoomId, { bot, authorizedAt }: BotAccess, messageId: string): Promise<string | null> {
    return this.serially(async () => {
      if (await this.revocationsFor(roomId).refuse([bot.id], authorizedAt)) return NOT_FOUND;
      const store = this.storeFor(roomId);
      const message = await this.botsOwn(store, bot, messageId);
      if (typeof message === "string") return message;
      await this.deleteMessage(store, message);
      return null;
    });
  }

  /**
   * Adds the bot's boost of `content`, trimmed, to the message `messageId`, as ember-rust's bot API does
   * (messages/boosts/by_bots.rs `create`): as a socket's boost.create does, but even when the bot has
   * added the same one, as there, answering it. Answers `NOT_FOUND` when the room turns the bot away, as
   * `createBotMessage` does, or has no such message, then `BLANK` when `content` is only spaces, or why
   * the room keeps no boost of it.
   */
  async addBotBoost(roomId: RoomId, { bot, authorizedAt }: BotAccess, messageId: string, content: string): Promise<Boost | string> {
    return this.serially(async () => {
      const now = new Date().toISOString();
      if (await this.revocationsFor(roomId).refuse([bot.id], authorizedAt)) return NOT_FOUND;
      const store = this.storeFor(roomId);
      if (!(await store.find(messageId))) return NOT_FOUND;
      const trimmed = content.trim();
      if (trimmed === "") return BLANK;
      if (trimmed.length > MAX_BOOST_LENGTH) return BOOST_TOO_LONG;
      return this.addBoost(store, messageId, bot, trimmed, now);
    });
  }

  /**
   * Removes the bot's boost `boostId` from the message `messageId`, as ember-rust's bot API does
   * (messages/boosts/by_bots.rs `destroy`): as a socket's boost.delete does, answering whether it did,
   * which it does only when the boost is the bot's own, on that message, and the room doesn't turn the
   * bot away, as `createBotMessage` does.
   */
  async removeBotBoost(roomId: RoomId, { bot, authorizedAt }: BotAccess, messageId: string, boostId: string): Promise<boolean> {
    return this.serially(async () => {
      if (await this.revocationsFor(roomId).refuse([bot.id], authorizedAt)) return false;
      const store = this.storeFor(roomId);
      const boost = await store.findBoost(boostId);
      if (!boost || boost.messageId !== messageId || boost.booster.id !== bot.id) return false;
      await this.removeBoost(store, boost);
      return true;
    });
  }

  /**
   * Starts `uploader`'s upload of `file` to the room, answering the file's key, or null once the room has
   * heard that their access ended, or the room was deleted, after the Workspace checked, as it turns away
   * a socket then.
   */
  async startUpload(roomId: RoomId, uploader: Uploader, file: NewUpload): Promise<string | null> {
    return this.serially(async () => {
      if (await this.revocationsFor(roomId).refuse(uploader.tags, uploader.authorizedAt)) return null;
      const key = base36(KEY_LENGTH);
      const blob = { id: key, uploaderId: uploader.userId, filename: file.name, contentType: file.type, byteSize: file.size };
      await this.blobsFor(roomId).create(blob, new Date().toISOString());
      return key;
    });
  }

  /** `uploaderId`'s upload `key` to the room, as far as it has come, or null if they have no such upload. */
  async uploadOf(roomId: RoomId, uploaderId: UserId, key: string): Promise<RoomBlob | null> {
    return this.serially(async () => {
      const blob = await this.blobsFor(roomId).find(key);
      return blob?.uploaderId === uploaderId ? blob : null;
    });
  }

  /**
   * Records what the first part of `uploader`'s upload `key` says the file is, with what R2 then has of
   * it, unless another request has recorded its own first part, answering the upload as it is then. Answers
   * null when the room turns the uploader away, as `startUpload` does, or they have no such upload.
   */
  async identifyUpload(
    roomId: RoomId,
    uploader: Uploader,
    key: string,
    identified: Identified,
    stored: { multipartUploadId: string; part: UploadedPart } | { completedAt: string },
  ): Promise<RoomBlob | null> {
    return this.serially(async () => {
      if (await this.revocationsFor(roomId).refuse(uploader.tags, uploader.authorizedAt)) return null;
      const blobs = this.blobsFor(roomId);
      const blob = await blobs.find(key);
      if (blob?.uploaderId !== uploader.userId) return null;
      return (await blobs.identify(key, identified, stored)) ?? blob;
    });
  }

  /**
   * Records `part` of `uploader`'s upload `key` in more than one part, answering the upload as it is
   * then, or null as `identifyUpload` answers it, or when the upload hasn't started in R2.
   */
  async recordUploadPart(roomId: RoomId, uploader: Uploader, key: string, part: UploadedPart): Promise<RoomBlob | null> {
    return this.serially(async () => {
      if (await this.revocationsFor(roomId).refuse(uploader.tags, uploader.authorizedAt)) return null;
      const blobs = this.blobsFor(roomId);
      const blob = await blobs.find(key);
      if (blob?.uploaderId !== uploader.userId || blob.multipartUploadId === null) return null;
      return blob.completedAt ? blob : blobs.recordPart(blob, part);
    });
  }

  /** Records that R2 has put upload `key` together, answering it, or null once the room no longer has it. */
  async completeUpload(roomId: RoomId, key: string): Promise<RoomBlob | null> {
    return this.serially(() => this.blobsFor(roomId).complete(key, new Date().toISOString()));
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
    if (CHANGES.has(frame.type) && (ws.deserializeAttachment() as Attachment).banned) {
      const clientMessageId = frame.type === "message.create" ? frame.clientMessageId : undefined;
      return this.send(ws, { type: "error", message: BANNED, clientMessageId, failed: frame.type });
    }

    switch (frame.type) {
      case "message.create": {
        if (isOutdated(ws)) return this.send(ws, { type: "error", message: OUTDATED, clientMessageId: frame.clientMessageId, failed: frame.type });
        const body = await this.prepare(frame.body);
        if (typeof body === "string") return this.send(ws, { type: "error", message: body, clientMessageId: frame.clientMessageId, failed: frame.type });
        await this.create(store, user, frame.clientMessageId, body, now);
        return;
      }
      case "message.update": {
        const message = await store.find(frame.messageId);
        if (!message || !(await this.canAdminister(user, message))) return this.refuse(ws, "You can only edit your own messages");
        if (isOutdated(ws)) return this.send(ws, { type: "error", message: OUTDATED, failed: frame.type });
        const body = await this.prepare(frame.body);
        if (typeof body === "string") return this.send(ws, { type: "error", message: body, failed: frame.type });
        await this.edit(store, message, body, now);
        return;
      }
      case "message.delete": {
        const message = await store.find(frame.messageId);
        if (!message || !(await this.canAdminister(user, message))) return this.refuse(ws, "You can only delete your own messages");
        return this.deleteMessage(store, message);
      }
      case "boost.create": {
        const message = await store.find(frame.messageId);
        if (!message) return this.refuse(ws, "That message no longer exists");
        // Unlike ember-rust, a person adds each reaction once, so one they've already added is a repeated click.
        if (message.boosts.some((b) => b.booster.id === user.id && b.content === frame.content)) return;
        await this.addBoost(store, frame.messageId, user, frame.content, now);
        return;
      }
      case "boost.delete": {
        const boost = await store.findBoost(frame.boostId);
        if (!boost || boost.booster.id !== user.id) return this.refuse(ws, "You can only remove your own reactions");
        return this.removeBoost(store, boost);
      }
      case "typing.start":
      case "typing.stop":
        return this.broadcast({ type: "typing", user, typing: frame.type === "typing.start" }, ws);
      case "history.before": {
        const { messages, hasMore } = await store.page(frame.limit ?? HISTORY_PAGE_SIZE, frame.before);
        return this.send(ws, { type: "history", before: frame.before, messages, hasMore });
      }
      case "history.after": {
        const { messages, hasNewer } = await store.after(frame.limit ?? HISTORY_PAGE_SIZE, frame.after);
        return this.send(ws, { type: "history.after", after: frame.after, messages, hasNewer });
      }
      case "history.around":
        return this.send(ws, { type: "history.around", ...(await store.timeline(HISTORY_PAGE_SIZE, frame.messageId)) });
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
   * Stores a message from `user`, a bot's reply to a webhook delivery when `kind` says so, tells everyone
   * in the room, and sends the Workspace and the search index their logs, which the message is in,
   * answering it.
   */
  private async create(store: MessageStore, user: User, clientMessageId: string, body: PreparedBody, now: string, kind?: "reply"): Promise<Message> {
    const { message, seq } = await store.create(sortableId(), clientMessageId, user, body, now, kind);
    this.broadcast({ type: "message.created", message, seq });
    const couriers = this.couriersFor(store.roomId);
    couriers.workspace.deliver();
    couriers.index.deliver();
    return message;
  }

  /**
   * Replaces `message`'s text with `body`, telling everyone in the room and sending the search index its
   * log, and answers the message as it is now. Saved as it was, it stays as it was, its update time
   * included, as Rails saves nothing then.
   */
  private async edit(store: MessageStore, message: Message, body: PreparedBody, now: string): Promise<Message> {
    if (body.html === message.body) return message;
    const { message: edited, seq } = await store.updateBody(message, body, now);
    this.broadcast({ type: "message.updated", message: edited, seq });
    this.couriersFor(store.roomId).index.deliver();
    return edited;
  }

  /** Deletes `message`, with its boosts, telling everyone in the room and sending the search index its log. */
  private async deleteMessage(store: MessageStore, message: Message): Promise<void> {
    const seq = await store.delete([message.id]);
    this.broadcast({ type: "message.deleted", messageId: message.id, seq });
    this.couriersFor(store.roomId).index.deliver();
  }

  /** Adds `user`'s boost of `content` to the message `messageId`, telling everyone in the room, and answers it. */
  private async addBoost(store: MessageStore, messageId: string, user: User, content: string, now: string): Promise<Boost> {
    const { boost, seq } = await store.addBoost(sortableId(), messageId, user, content, now);
    this.broadcast({ type: "boost.created", boost, seq });
    return boost;
  }

  /** Removes `boost`, telling everyone in the room. */
  private async removeBoost(store: MessageStore, boost: Boost): Promise<void> {
    const seq = await store.removeBoost(boost);
    this.broadcast({ type: "boost.deleted", boostId: boost.id, messageId: boost.messageId, seq });
  }

  /**
   * The bot `bot`'s message `messageId`, or `NOT_FOUND` or `FORBIDDEN` when the room has no such message
   * or it's someone else's, as ember-rust's `set_message` and `ensure_can_administer` decide. A bot is
   * never an administrator, so the only messages it can change are its own.
   */
  private async botsOwn(store: MessageStore, bot: User, messageId: string): Promise<Message | string> {
    const message = await store.find(messageId);
    if (!message) return NOT_FOUND;
    return message.creator.id === bot.id ? message : FORBIDDEN;
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

  private blobsFor(roomId: RoomId): Blobs {
    return (this.blobs ??= new Blobs(this.dbFor(), roomId));
  }

  /** Logs that `userId` has read the room, for the Workspace to clear their mark, and sends it the log. */
  private async read(roomId: RoomId, userId: UserId): Promise<void> {
    await this.logFor(roomId).read(userId, new Date().toISOString());
    this.couriersFor(roomId).workspace.deliver();
  }

  /**
   * What sends each of the room's logs. Each has a call of its own out at a time, and waits on its own
   * failures. The search index's is patient, since a search can find a message a moment late: its call
   * doesn't go with the Workspace's as a message is written, so the unread marks the Workspace sends
   * everyone away don't wait behind its queries, as on D1 they would.
   */
  private couriersFor(roomId: RoomId): Couriers {
    return (this.couriers ??= {
      workspace: new Courier(() => this.sendEvents(roomId), (time) => this.wakeAt(roomId, time), `room ${roomId}'s log to the Workspace`),
      index: new Courier(() => this.sendMessages(roomId), (time) => this.wakeAt(roomId, time), `room ${roomId}'s messages to the search index`, true),
    });
  }

  /**
   * Sends the Workspace the oldest events it hasn't taken, as many as one call takes, with who is viewing
   * the room now, for it to mark the room unread for the members who aren't and read for those who've
   * opened it, and forgets them once it has. Answers how many it sent.
   */
  private async sendEvents(roomId: RoomId): Promise<number> {
    const log = this.logFor(roomId);
    const events = await log.undelivered(ENTRIES_PER_CALL);
    if (events.length === 0) return 0;
    const { pushes, webhooks } = await workspace(this.env).applyRoomEvents(roomId, events, viewersOf(this.ctx));
    // The Workspace answers a message's pushes and webhooks once, so they're sent whatever happens next,
    // and the log's next call doesn't wait on push services or bots.
    if (pushes.length > 0) this.ctx.waitUntil(this.push(pushes));
    for (const webhook of webhooks) this.ctx.waitUntil(this.deliver(roomId, webhook));
    await log.delivered(events.at(-1)!.seq);
    return events.length;
  }

  /**
   * Delivers a new message to a bot's webhook in its turn, as ember-rust's `Bot::WebhookJob` does
   * (integrations/jobs.rs): the message as it is by then, and nothing once it's gone, to the bot and
   * webhook the Workspace found for it, and posts what the bot says back. Each delivery is logged,
   * without its URL or the bot's key, and one the queue has no room for is dropped.
   */
  private async deliver(roomId: RoomId, webhook: MessageWebhook): Promise<void> {
    const job = `Bot::WebhookJob of message ${webhook.messageId} to bot ${webhook.bot.id}`;
    const ran = await this.webhooks.run(async () => {
      try {
        const message = (await this.isDeleted()) ? null : await this.storeFor(roomId).find(webhook.messageId);
        if (!message) throw new WebhookError("the message is gone");
        const { status, reply } = await postWebhook(webhook.url, webhookPayload(roomId, webhook, message));
        if (reply && "file" in reply) throw new WebhookError(`its reply, ${reply.file.filename} (${reply.file.contentType}), is a file, which bots can't post yet`);
        const refused = reply && (await this.reply(roomId, webhook.bot, reply.text));
        if (refused) throw new WebhookError(`its reply wasn't posted: ${refused}`);
        console.log(`${job} performed: ${status ?? "no answer in time"}`);
      } catch (error) {
        console.error(`${job} failed:`, error instanceof WebhookError ? error.message : error);
      }
    });
    if (!ran) console.error(`${job} dropped: the room's webhook queue is full`);
  }

  /**
   * Posts `text` as the bot `bot`'s reply to a delivery, as Campfire's `receive_text_reply_to` does: as
   * the bot's message, even once it has left the room, which reaches the room as any message does but is
   * delivered to no webhook. Answers why the room keeps nothing of it, if it doesn't.
   */
  private async reply(roomId: RoomId, bot: User, text: string): Promise<string | null> {
    return this.serially(async () => {
      if (await this.isDeleted()) return "the room is gone";
      const body = await this.prepare(text);
      if (typeof body === "string") return body;
      await this.create(this.storeFor(roomId), bot, crypto.randomUUID(), body, new Date().toISOString(), "reply");
      return null;
    });
  }

  /** Sends new messages' pushes, and has the Workspace forget the subscriptions they found gone. */
  private async push(pushes: MessagePush[]): Promise<void> {
    const gone = await sendPushes(this.env, pushes);
    if (gone.length === 0) return;
    await workspace(this.env)
      .forgetPushSubscriptions(gone)
      .catch((error: unknown) => console.error(`Error in WebPush::Pool.invalid_subscription_handler: ${error}`));
  }

  /**
   * Sends the search index the messages written, edited or deleted longest ago that it hasn't taken, as
   * many as one call takes, as they are now, and forgets them once it has. Answers how many it sent.
   */
  private async sendMessages(roomId: RoomId): Promise<number> {
    const log = this.logFor(roomId);
    const logged = await log.unindexed(ENTRIES_PER_CALL);
    if (logged.length === 0) return 0;
    // Read after the log, so each is as new as the change that logged it, or newer.
    const ids = [...new Set(logged.map(({ messageId }) => messageId))];
    const messages = await this.storeFor(roomId).indexable(ids);
    const kept = new Set(messages.map(({ id }) => id));
    const seq = logged.at(-1)!.seq;
    await searchIndex(this.env).apply(roomId, seq, messages, ids.filter((id) => !kept.has(id)));
    await log.indexed(seq);
    return logged.length;
  }

  /**
   * Sets the alarm to send the room's logs at `time`, unless it's set for sooner, and answers whether it
   * did. A deleted room's alarm is for erasing it, so it's left as it is; this runs one event at a time
   * with deleting it, so the deletion's alarm can't be overtaken.
   */
  private wakeAt(roomId: RoomId, time: number): Promise<boolean> {
    return this.serially(async () => {
      if (await this.isDeleted()) return false;
      await this.ctx.storage.put(UNDELIVERED_ROOM, roomId);
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null || alarm > time) await this.ctx.storage.setAlarm(time);
      return true;
    });
  }

  /** Whether the Workspace has deleted the room, which a request it let through just before can still find. */
  private async isDeleted(): Promise<boolean> {
    return (await this.ctx.storage.get(DELETED_ROOM)) !== undefined;
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
