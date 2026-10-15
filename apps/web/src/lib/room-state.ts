import type { Message, ServerFrame, User } from "@ember/protocol";

/** `gone` is a room that isn't there for this person any more, deleted or no longer theirs, which nothing reconnects to. */
export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "gone";

/**
 * ember-rust's page of messages (`Message::PAGE_SIZE`). The welcome card shows only in a room with no
 * more than this, which the room's first page, being longer, can tell.
 */
export const WELCOME_CARD_MESSAGES = 40;

export interface PendingMessage extends Message {
  pending: true;
  failed?: boolean;
  /** Written without a connection, to send once the room lets one in again, unless the page goes offline first. */
  queued?: boolean;
}

/** What a message that couldn't go says, as the room's own refusals do. */
const NOT_SENT = "Not connected. Your message wasn't sent.";

export interface RoomState {
  status: ConnectionStatus;
  /** Whether the room has been without a connection for 5 seconds, which stops sending until it's back. */
  offline: boolean;
  messages: Array<Message | PendingMessage>;
  present: User[];
  /** Who is typing, with when we last heard so stale entries can expire. */
  typing: Record<string, { user: User; at: number }>;
  hasMore: boolean;
  /**
   * The oldest message the room has sent this page, which history pages back from. It stays when that
   * message is deleted, so a timeline whose messages were all deleted can still page back to older ones.
   */
  oldestId: string | null;
  loadingOlder: boolean;
  notice: string | null;
  /**
   * Whether the room had more than `WELCOME_CARD_MESSAGES` when it first answered, or null until then.
   * As ember-rust decides when it renders the room's page, it holds until the room is opened again.
   */
  paged: boolean | null;
}

export type RoomAction =
  | { type: "reset" }
  | { type: "status"; status: ConnectionStatus }
  | { type: "offline"; offline: boolean }
  | { type: "frame"; frame: ServerFrame; now: number }
  | { type: "pending"; message: PendingMessage }
  | { type: "sent"; clientMessageIds: string[] }
  | { type: "loading-older" }
  | { type: "expire-typing"; before: number }
  | { type: "dismiss-notice" };

export const initialRoomState: RoomState = {
  status: "connecting",
  offline: false,
  messages: [],
  present: [],
  typing: {},
  hasMore: false,
  oldestId: null,
  loadingOlder: false,
  notice: null,
  paged: null,
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

const byId = (a: Message, b: Message) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The page's messages caught up with what changed while it was away, as `resumed` says. Deleted messages
 * go, changed ones are replaced, and new ones take their places by id, except those older than the
 * oldest the room has sent, which history brings as they are once it's paged to. The messages sent
 * before the connection dropped that none confirms stay as sending while useRoom asks the room about
 * them, as after a welcome: one may be older than the page a welcome before brought, which nothing since
 * names.
 */
function caughtUp({ messages, oldestId }: RoomState, { messages: changed, deletedIds }: Extract<ServerFrame, { type: "resumed" }>) {
  const deleted = new Set(deletedIds);
  const updates = new Map(changed.map((m) => [m.id, m]));
  const stored = messages.filter((m) => !isPending(m));
  const kept = stored.flatMap((m) => (deleted.has(m.id) ? [] : [updates.get(m.id) ?? m]));
  const loaded = new Set(stored.map((m) => m.id));
  const added = changed.filter((m) => !loaded.has(m.id) && (oldestId === null || m.id > oldestId));
  return [...[...kept, ...added].sort(byId), ...unconfirmed(messages, changed)];
}

const replace = (messages: RoomState["messages"], id: string, update: (m: Message) => Message) =>
  messages.map((m) => (m.id === id ? update(m) : m));

export const isQueued = (m: Message | PendingMessage): m is PendingMessage => isPending(m) && m.queued === true;

const dequeued = ({ queued: _, ...message }: PendingMessage): PendingMessage => message;

/** The messages waiting for a connection, shown as not sent. */
const notSent = (messages: RoomState["messages"]) => messages.map((m) => (isQueued(m) ? { ...dequeued(m), failed: true } : m));

/** Offline, the messages waiting for a connection show as not sent, and say so. */
function unsent(state: RoomState): RoomState {
  if (!state.offline || !state.messages.some(isQueued)) return state;
  return { ...state, messages: notSent(state.messages), notice: NOT_SENT };
}

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
      // Nobody shows as here with this person in a room that's gone, which nothing connects to again, so
      // what was waiting for a connection shows as not sent.
      return action.status === "gone"
        ? { ...state, status: action.status, offline: false, present: [], typing: {}, messages: notSent(state.messages) }
        : { ...state, status: action.status };
    case "offline":
      return action.offline ? unsent({ ...state, offline: true }) : { ...state, offline: false };
    case "pending":
      return unsent({ ...state, messages: [...state.messages, action.message] });
    case "sent": {
      const sent = (m: Message | PendingMessage): m is PendingMessage => isQueued(m) && action.clientMessageIds.includes(m.clientMessageId);
      return { ...state, messages: state.messages.map((m) => (sent(m) ? dequeued(m) : m)) };
    }
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
        oldestId: frame.messages[0]?.id ?? null,
        // A history request on the old socket will never be answered.
        loadingOlder: false,
        typing: {},
        paged: state.paged ?? (frame.hasMore || frame.messages.length > WELCOME_CARD_MESSAGES),
      };
    }
    case "resumed":
      // The pages already loaded stay, older ones included, where a welcome would replace them.
      return {
        ...state,
        status: "open",
        messages: caughtUp(state, frame),
        present: frame.present,
        // A history request on the old socket will never be answered.
        loadingOlder: false,
        typing: {},
      };
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
      return {
        ...state,
        messages: [...frame.messages, ...messages],
        hasMore: frame.hasMore,
        oldestId: frame.messages[0]?.id ?? state.oldestId,
        loadingOlder: false,
      };
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
