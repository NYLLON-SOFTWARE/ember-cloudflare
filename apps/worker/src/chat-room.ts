import { DurableObject } from "cloudflare:workers";
import {
  CloseCode,
  HISTORY_PAGE_SIZE,
  parseClientFrame,
  type ClientFrame,
  type RoomId,
  type ServerFrame,
  type User,
  type UserId,
} from "@ember/protocol";
import { openDb, type Db } from "./db";
import type { Env } from "./env";
import { sortableId } from "./ids";
import { Revocations, sessionTag, type Revocation } from "./revocations";
import { MessageStore } from "./store";

/** What each socket remembers across hibernation. */
interface Attachment {
  user: User;
  roomId: RoomId;
  /** Set once the room has closed the socket for a revocation, which announced that it left. */
  revoked?: true;
}

export const USER_HEADER = "X-Ember-User";
export const ROOM_HEADER = "X-Ember-Room";
export const SESSION_HEADER = "X-Ember-Session";
/** When the Workspace checked the socket's session and membership, in milliseconds since the epoch. */
export const AUTHORIZED_AT_HEADER = "X-Ember-Authorized-At";

const CLOSE_REASONS: Record<CloseCode, string> = { [CloseCode.Reconnect]: "Reconnect", [CloseCode.Revoked]: "Revoked", [CloseCode.NotFound]: "NotFound" };

/** A socket that closes with `code` as soon as it opens: a browser can't read why an upgrade was refused. */
export function closedAtOnce(code: CloseCode): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(code, CLOSE_REASONS[code]);
  return new Response(null, { status: 101, webSocket: client });
}

/**
 * Close codes that only report how a socket closed, like 1006 for a dropped connection, and can't
 * be sent in a close frame (RFC 6455, section 7.4.1).
 */
const RESERVED_CLOSE_CODES = new Set([1004, 1005, 1006, 1015]);

/**
 * One chat room: its WebSockets, who is present and typing, and its messages.
 * Uses the hibernation API, so an idle room costs nothing while sockets stay open.
 */
export class ChatRoom extends DurableObject<Env> {
  private db: Db | null = null;
  private store: MessageStore | null = null;
  private revocations: Revocations | null = null;
  private queue: Promise<unknown> = Promise.resolve();

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

    return this.serially(async () => {
      const tags = [user.id, sessionTag(sessionId)];
      // Read side by side, so a room that has just woken waits on D1 once.
      const [refused, { messages, hasMore }] = await Promise.all([
        this.revocationsFor(roomId).refuse(tags, authorizedAt),
        this.storeFor(roomId).page(HISTORY_PAGE_SIZE),
      ]);
      if (refused) return closedAtOnce(CloseCode.Reconnect);
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server, tags);
      server.serializeAttachment({ user, roomId } satisfies Attachment);

      this.send(server, { type: "welcome", you: user, messages, present: this.present(), hasMore });
      // Everyone else has the list from their own welcome, so they only hear who's new.
      if (!this.isPresent(user.id, server)) this.broadcast({ type: "presence.joined", user }, server);
      return new Response(null, { status: 101, webSocket: client });
    });
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
      const leaving = new Map<UserId, User>();
      for (const { tag, code } of revocations) {
        for (const socket of this.ctx.getWebSockets(tag)) {
          if (socket.readyState !== WebSocket.OPEN) continue;
          const attachment = socket.deserializeAttachment() as Attachment;
          socket.serializeAttachment({ ...attachment, revoked: true } satisfies Attachment);
          socket.close(code, CLOSE_REASONS[code]);
          leaving.set(attachment.user.id, attachment.user);
        }
      }
      for (const user of leaving.values()) this.depart(user);
    });
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
        const message = await store.create(sortableId(), frame.clientMessageId, user, frame.body, now);
        return this.broadcast({ type: "message.created", message });
      }
      case "message.update": {
        const message = await store.find(frame.messageId);
        if (!message || message.creator.id !== user.id) return this.refuse(ws, "You can only edit your own messages");
        await store.updateBody(message.id, frame.body, now);
        return this.broadcast({ type: "message.updated", message: { ...message, body: frame.body, updatedAt: now } });
      }
      case "message.delete": {
        const message = await store.find(frame.messageId);
        if (!message || message.creator.id !== user.id) return this.refuse(ws, "You can only delete your own messages");
        await store.delete(message.id);
        return this.broadcast({ type: "message.deleted", messageId: message.id });
      }
      case "boost.create": {
        const message = await store.find(frame.messageId);
        if (!message) return this.refuse(ws, "That message no longer exists");
        // Reactions toggle per person, so one they've already added is a repeated click.
        if (message.boosts.some((b) => b.booster.id === user.id && b.content === frame.content)) return;
        const boost = await store.addBoost(sortableId(), frame.messageId, user, frame.content, now);
        return this.broadcast({ type: "boost.created", boost });
      }
      case "boost.delete": {
        const boost = await store.findBoost(frame.boostId);
        if (!boost || boost.booster.id !== user.id) return this.refuse(ws, "You can only remove your own reactions");
        await store.removeBoost(boost.id);
        return this.broadcast({ type: "boost.deleted", boostId: boost.id, messageId: boost.messageId });
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
      case "ping":
        return this.send(ws, { type: "pong" });
    }
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
