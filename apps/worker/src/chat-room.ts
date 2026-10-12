import { DurableObject } from "cloudflare:workers";
import {
  HISTORY_PAGE_SIZE,
  parseClientFrame,
  type ClientFrame,
  type RoomId,
  type ServerFrame,
  type User,
} from "@ember/protocol";
import type { Env } from "./env";
import { sortableId } from "./ids";
import { MessageStore, openStore } from "./store";

/** What each socket remembers across hibernation. */
interface Attachment {
  user: User;
  roomId: RoomId;
}

export const USER_HEADER = "X-Ember-User";
export const ROOM_HEADER = "X-Ember-Room";

/**
 * One chat room: its WebSockets, who is present and typing, and its messages.
 * Uses the hibernation API, so an idle room costs nothing while sockets stay open.
 */
export class ChatRoom extends DurableObject<Env> {
  private store: MessageStore | null = null;
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
    if (!user || !roomId) return new Response("Missing user or room", { status: 400 });

    return this.serially(async () => {
      const { messages, hasMore } = await this.storeFor(roomId).page(HISTORY_PAGE_SIZE);
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server, [user.id]);
      server.serializeAttachment({ user, roomId } satisfies Attachment);

      this.send(server, { type: "welcome", you: user, messages, present: this.present(), hasMore });
      this.broadcast({ type: "presence", present: this.present() }, server);
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const frame = typeof raw === "string" ? parseClientFrame(raw) : null;
    if (!frame) return this.send(ws, { type: "error", message: "Unrecognized frame" });

    const { user, roomId } = ws.deserializeAttachment() as Attachment;
    await this.serially(async () => {
      try {
        await this.handle(ws, user, this.storeFor(roomId), frame);
      } catch (error) {
        console.error("ChatRoom frame failed", frame.type, error);
        const clientMessageId = frame.type === "message.create" ? frame.clientMessageId : undefined;
        this.send(ws, { type: "error", message: "Something went wrong", clientMessageId, failed: frame.type });
      }
    });
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    ws.close(code === 1005 ? 1000 : code, "Closing");
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
        this.broadcast({ type: "typing", user, typing: false }, ws);
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
      case "ping":
        return this.send(ws, { type: "pong" });
    }
  }

  private storeFor(roomId: RoomId): MessageStore {
    this.store ??= openStore(this.env, this.ctx, roomId);
    return this.store;
  }

  /** Everyone with at least one open socket, once each. */
  private present(except?: WebSocket): User[] {
    const users = new Map<string, User>();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except || socket.readyState !== WebSocket.OPEN) continue;
      const { user } = socket.deserializeAttachment() as Attachment;
      users.set(user.id, user);
    }
    return [...users.values()];
  }

  private leave(ws: WebSocket): void {
    const { user } = ws.deserializeAttachment() as Attachment;
    this.broadcast({ type: "typing", user, typing: false }, ws);
    this.broadcast({ type: "presence", present: this.present(ws) }, ws);
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
