import type { Boost, Message, ServerFrame } from "@ember/protocol";
import { initialRoomState, isPending, paged, resumed, roomReducer, welcomed, type RoomAction, type RoomState } from "./room-state";

/**
 * A thread as its panel shows it: the message it's for, its parent, and its replies, a timeline of their
 * own, which the room's frames keep as they keep the room's.
 */
export interface ThreadState {
  parentId: string;
  /** The parent: undefined until the room has said, and null once it says it has no such message, or it goes. */
  parent: Message | null | undefined;
  replies: RoomState;
  /** The reply a permalink opens the thread at, until it has opened. */
  openingAt?: string;
}

export const initialThreadState = ({ parentId, replyId }: { parentId: string; replyId?: string }): ThreadState => ({
  parentId,
  parent: undefined,
  replies: initialRoomState,
  openingAt: replyId,
});

const withBoosts = (message: Message, boosts: Boost[]): Message => ({ ...message, boosts });

/**
 * The replies a thread opened again shows: those it showed caught up with the newest page, as a room's
 * timeline is with what changed while it was away. Those it showed that the page should hold and doesn't
 * have been deleted.
 */
function reopened(replies: RoomState, { messages, hasMore }: Extract<ServerFrame, { type: "thread.opened" }>): RoomState {
  const oldest = messages[0]?.id;
  const kept = new Set(messages.map((m) => m.id));
  const deletedIds = replies.messages.flatMap((m) => (!isPending(m) && !kept.has(m.id) && (!hasMore || (oldest !== undefined && m.id > oldest)) ? [m.id] : []));
  return resumed(replies, { messages, deletedIds }, []);
}

/** Whether an error is about replies the thread is sending, which it shows as not sent. */
function isAboutSending(replies: RoomState, error: Extract<ServerFrame, { type: "error" }>): boolean {
  const ids = error.clientMessageIds ?? (error.clientMessageId === undefined ? [] : [error.clientMessageId]);
  return replies.messages.some((m) => isPending(m) && ids.includes(m.clientMessageId));
}

export function threadReducer(state: ThreadState, action: RoomAction): ThreadState {
  if (action.type === "reset") return initialThreadState({ parentId: state.parentId });
  const withReplies = (replies: RoomState): ThreadState => (replies === state.replies ? state : { ...state, replies });
  if (action.type !== "frame") return withReplies(roomReducer(state.replies, action));
  const { frame } = action;
  const { parent, parentId } = state;
  switch (frame.type) {
    case "thread.opened": {
      if (frame.parentId !== parentId) return state;
      // The first time it opens, the thread goes to the reply its permalink names, if it's among the newest,
      // or else to its end. Each time after, as the room lets the page in again, the reader keeps their place.
      if (state.replies.connections > 0) return { ...state, parent: frame.parent, replies: reopened(state.replies, frame) };
      const around = frame.messages.some((m) => m.id === state.openingAt) ? state.openingAt! : null;
      const page = { messages: frame.messages, hasMore: frame.hasMore, hasNewer: false, around };
      return { parentId, parent: frame.parent, replies: welcomed(state.replies, page, []) };
    }
    case "thread.history":
      return frame.parentId === parentId ? withReplies(paged(state.replies, frame)) : state;
    case "message.created":
      return frame.message.parentId === parentId ? withReplies(roomReducer(state.replies, action)) : state;
    case "message.updated":
      return frame.message.id === parentId ? { ...state, parent: frame.message } : withReplies(roomReducer(state.replies, action));
    case "message.deleted":
      return frame.messageId === parentId ? { ...state, parent: null } : withReplies(roomReducer(state.replies, action));
    case "boost.created":
      return frame.boost.messageId === parentId && parent
        ? { ...state, parent: withBoosts(parent, [...parent.boosts, frame.boost]) }
        : withReplies(roomReducer(state.replies, action));
    case "boost.deleted":
      return frame.messageId === parentId && parent
        ? { ...state, parent: withBoosts(parent, parent.boosts.filter((b) => b.id !== frame.boostId)) }
        : withReplies(roomReducer(state.replies, action));
    case "message.checked":
      return withReplies(roomReducer(state.replies, action));
    case "error": {
      const { replies } = state;
      // The room doesn't say which reaction it refused to delete, so a reaction shown as going in the thread
      // may be the one, and it comes back.
      if (frame.failed === "boost.delete") return withReplies({ ...replies, refusedUnboosts: replies.refusedUnboosts + 1 });
      // A failed page of replies leaves nothing in flight, so paging can be tried again.
      if (frame.failed === "thread.open" || frame.failed === "thread.before") {
        return withReplies({ ...replies, notice: frame.message, loadingOlder: frame.failed === "thread.before" ? false : replies.loadingOlder });
      }
      return isAboutSending(replies, frame) ? withReplies(roomReducer(replies, action)) : state;
    }
    // The room's own pages, presence and typing aren't the thread's. As the room lets the page in again,
    // useThread opens the thread again.
    default:
      return state;
  }
}
