import type { Message, ServerFrame, User } from "@ember/protocol";

export type ConnectionStatus = "connecting" | "open" | "reconnecting";

export interface PendingMessage extends Message {
  pending: true;
  failed?: boolean;
}

export interface RoomState {
  status: ConnectionStatus;
  messages: Array<Message | PendingMessage>;
  present: User[];
  /** Who is typing, with when we last heard so stale entries can expire. */
  typing: Record<string, { user: User; at: number }>;
  hasMore: boolean;
  loadingOlder: boolean;
  notice: string | null;
}

export type RoomAction =
  | { type: "reset" }
  | { type: "status"; status: ConnectionStatus }
  | { type: "frame"; frame: ServerFrame; now: number }
  | { type: "pending"; message: PendingMessage }
  | { type: "loading-older" }
  | { type: "expire-typing"; before: number }
  | { type: "dismiss-notice" };

export const initialRoomState: RoomState = {
  status: "connecting",
  messages: [],
  present: [],
  typing: {},
  hasMore: false,
  loadingOlder: false,
  notice: null,
};

export const isPending = (m: Message | PendingMessage): m is PendingMessage => "pending" in m;

const replace = (messages: RoomState["messages"], id: string, update: (m: Message) => Message) =>
  messages.map((m) => (m.id === id ? update(m) : m));

function withoutTyping(typing: RoomState["typing"], userId: string) {
  if (!(userId in typing)) return typing;
  const { [userId]: _, ...rest } = typing;
  return rest;
}

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case "reset":
      return initialRoomState;
    case "status":
      return { ...state, status: action.status };
    case "pending":
      return { ...state, messages: [...state.messages, action.message] };
    case "loading-older":
      return { ...state, loadingOlder: true };
    case "dismiss-notice":
      return { ...state, notice: null };
    case "expire-typing":
      return {
        ...state,
        typing: Object.fromEntries(Object.entries(state.typing).filter(([, t]) => t.at >= action.before)),
      };
    case "frame":
      return applyFrame(state, action.frame, action.now);
  }
}

function applyFrame(state: RoomState, frame: ServerFrame, now: number): RoomState {
  switch (frame.type) {
    case "welcome": {
      // Keep unsent messages across a reconnect; everything else comes fresh from the room.
      const unsent = state.messages.filter((m) => isPending(m) && !frame.messages.some((s) => s.clientMessageId === m.clientMessageId));
      return {
        ...state,
        status: "open",
        messages: [...frame.messages, ...unsent],
        present: frame.present,
        hasMore: frame.hasMore,
        // A history request on the old socket will never be answered.
        loadingOlder: false,
        typing: {},
      };
    }
    case "message.created": {
      const { message } = frame;
      const exists = state.messages.some((m) => m.clientMessageId === message.clientMessageId);
      const messages = exists
        ? state.messages.map((m) => (m.clientMessageId === message.clientMessageId ? message : m))
        : [...state.messages, message];
      return { ...state, messages, typing: withoutTyping(state.typing, message.creator.id) };
    }
    case "message.updated":
      return { ...state, messages: replace(state.messages, frame.message.id, () => frame.message) };
    case "message.deleted":
      return { ...state, messages: state.messages.filter((m) => m.id !== frame.messageId) };
    case "boost.created":
      return {
        ...state,
        messages: replace(state.messages, frame.boost.messageId, (m) => ({ ...m, boosts: [...m.boosts, frame.boost] })),
      };
    case "boost.deleted":
      return {
        ...state,
        messages: replace(state.messages, frame.messageId, (m) => ({ ...m, boosts: m.boosts.filter((b) => b.id !== frame.boostId) })),
      };
    case "presence":
      return { ...state, present: frame.present };
    case "typing":
      return {
        ...state,
        typing: frame.typing ? { ...state.typing, [frame.user.id]: { user: frame.user, at: now } } : withoutTyping(state.typing, frame.user.id),
      };
    case "history":
      return { ...state, messages: [...frame.messages, ...state.messages], hasMore: frame.hasMore, loadingOlder: false };
    case "error": {
      const messages = frame.clientMessageId
        ? state.messages.map((m) => (m.clientMessageId === frame.clientMessageId && isPending(m) ? { ...m, failed: true } : m))
        : state.messages;
      return { ...state, messages, notice: frame.message };
    }
    case "pong":
      return state;
  }
}
