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

/**
 * Whether `stored` is the room's copy of the optimistic message `m`. Anyone can send a
 * clientMessageId they've seen, so the sender has to match as well.
 */
const confirms = (stored: Message, m: Message | PendingMessage) =>
  isPending(m) && m.clientMessageId === stored.clientMessageId && m.creator.id === stored.creator.id;

/** The pending messages whose stored copies aren't in `snapshot`, the newest page a reconnect brings. */
export const unconfirmed = (messages: RoomState["messages"], snapshot: Message[]) =>
  messages.filter((m): m is PendingMessage => isPending(m) && !snapshot.some((stored) => confirms(stored, m)));

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
    case "expire-typing": {
      const fresh = Object.entries(state.typing).filter(([, t]) => t.at >= action.before);
      // This comes every second, so a room where nothing expired keeps its state and doesn't re-render.
      return fresh.length === Object.keys(state.typing).length ? state : { ...state, typing: Object.fromEntries(fresh) };
    }
    case "frame":
      return applyFrame(state, action.frame, action.now);
  }
}

function applyFrame(state: RoomState, frame: ServerFrame, now: number): RoomState {
  switch (frame.type) {
    case "welcome": {
      // Keep unconfirmed messages across a reconnect; everything else comes fresh from the room. The
      // old socket may have closed after the room stored one, so those it sent stay as sending while
      // useRoom asks the room about them.
      return {
        ...state,
        status: "open",
        messages: [...frame.messages, ...unconfirmed(state.messages, frame.messages)],
        present: frame.present,
        hasMore: frame.hasMore,
        // A history request on the old socket will never be answered.
        loadingOlder: false,
        typing: {},
      };
    }
    case "message.created": {
      const { message } = frame;
      // A confirmed message goes where the room put it, at the end, not where its optimistic copy sat:
      // the room may have stored someone else's first. ember-rust's messages_controller does the same.
      const others = state.messages.filter((m) => !confirms(message, m));
      const messages = others.some((m) => m.id === message.id) ? replace(others, message.id, () => message) : [...others, message];
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
    case "presence.joined":
      // Someone reopening the room while their last tab is still closing arrives before that tab leaves.
      return state.present.some((u) => u.id === frame.user.id) ? state : { ...state, present: [...state.present, frame.user] };
    case "presence.left":
      return { ...state, present: state.present.filter((u) => u.id !== frame.userId), typing: withoutTyping(state.typing, frame.userId) };
    case "typing":
      return {
        ...state,
        typing: frame.typing ? { ...state.typing, [frame.user.id]: { user: frame.user, at: now } } : withoutTyping(state.typing, frame.user.id),
      };
    case "message.checked": {
      const among = (ids: string[]) => (m: Message | PendingMessage) => isPending(m) && ids.includes(m.clientMessageId);
      const stored = among(frame.stored);
      const missing = among(frame.missing);
      // The room stored these before the oldest message of the snapshot it sent on reconnect, so they
      // belong in older history, where scrolling up finds them.
      const sent = state.messages.filter(stored).length;
      const messages = state.messages.flatMap((m) => (stored(m) ? [] : missing(m) ? [{ ...m, failed: true }] : [m]));
      const notice = sent === 0 ? state.notice : sent === 1 ? "Your message was sent. Scroll up to see it." : "Your messages were sent. Scroll up to see them.";
      return { ...state, messages, notice };
    }
    case "history": {
      // A page can hold the stored copy of a message that a reconnect left unconfirmed.
      const messages = state.messages.filter((m) => !frame.messages.some((stored) => confirms(stored, m)));
      return { ...state, messages: [...frame.messages, ...messages], hasMore: frame.hasMore, loadingOlder: false };
    }
    case "error": {
      // A message the room refused shows as not sent, as do the ones it couldn't check. An error about no
      // message keeps the same list: the timeline takes a new one for a change, and would ask again for a
      // page that just failed.
      const notSent = frame.clientMessageIds ?? (frame.clientMessageId === undefined ? [] : [frame.clientMessageId]);
      const messages = notSent.length
        ? state.messages.map((m) => (isPending(m) && notSent.includes(m.clientMessageId) ? { ...m, failed: true } : m))
        : state.messages;
      // A failed history request leaves nothing in flight, so paging can be tried again.
      const loadingOlder = frame.failed === "history.before" ? false : state.loadingOlder;
      return { ...state, messages, notice: frame.message, loadingOlder };
    }
    case "pong":
      return state;
  }
}
