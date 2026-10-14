import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef } from "react";
import { CloseCode, HISTORY_PAGE_SIZE, MAX_CHECKED_MESSAGES, parseServerFrame, type ClientFrame, type Me, type Message, type User } from "@ember/protocol";
import { plainText } from "@ember/richtext/dom";
import { ApiError, fetchMe, roomSocketUrl } from "@/lib/api";
import { reconnectingSocket, type ReconnectingSocket } from "@/lib/reconnecting-socket";
import { initialRoomState, isQueued, roomReducer, unconfirmed, type PendingMessage } from "@/lib/room-state";
import { settledVisibility } from "@/lib/visibility";

/** How long someone shows as typing after the room last heard them start, as Campfire's typing_tracker.js keeps them. */
const TYPING_TTL_MS = 5_000;
/** How often typing tells the room, as Campfire's typing_notifications_controller.js throttles it. */
const TYPING_THROTTLE_MS = 1_000;

/** Whom a message being sent mentions, until the room says: the composer can't write a mention yet. */
const NO_ONE = () => undefined;

/**
 * One room's live state over a reconnecting WebSocket to its ChatRoom Durable Object, as `me`.
 * `onSessionChanged` hears when the browser's session stops signing in `me`: null once it has expired,
 * or whoever another tab signed in as.
 */
export function useRoom(roomId: string, me: User, onSessionChanged: (me: Me | null) => void) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const socket = useRef<ReconnectingSocket | null>(null);
  const lastTypingStarted = useRef(-Infinity);
  const sessionChanged = useEffectEvent(onSessionChanged);
  const isSomeoneElse = useEffectEvent((user: User) => user.id !== me.id);

  // ember-rust posts each message over HTTP, and shows it as failed only when that request fails
  // (composer_controller.js). A socket can lose the answer instead: it can close after the room stored a
  // message but before the confirmation came back, and a reconnect's welcome only holds the newest page.
  // So ask the room about the sent messages the welcome doesn't confirm, which the reducer keeps as
  // sending until it answers. Those written while it was away never went, so they aren't asked about.
  const checkUnconfirmed = useEffectEvent((room: ReconnectingSocket, snapshot: Message[]) => {
    const clientMessageIds = unconfirmed(state.messages, snapshot).flatMap((m) => (m.failed || m.queued ? [] : [m.clientMessageId]));
    for (let i = 0; i < clientMessageIds.length; i += MAX_CHECKED_MESSAGES) {
      room.send({ type: "message.check", clientMessageIds: clientMessageIds.slice(i, i + MAX_CHECKED_MESSAGES) });
    }
  });

  // Sends the messages written while the room was away, in the order they were written.
  const sendQueued = useEffectEvent((room: ReconnectingSocket) => {
    const queued = state.messages.filter(isQueued);
    if (queued.length === 0) return;
    for (const { clientMessageId, body } of queued) room.send({ type: "message.create", clientMessageId, body });
    dispatch({ type: "sent", clientMessageIds: queued.map((m) => m.clientMessageId) });
  });

  useEffect(() => {
    let closed = false;

    // Tells the room when the tab has been shown or hidden for a while, unless its socket's address or an
    // earlier frame said so already. Until the room lets the socket in, the welcome tells it.
    let told: boolean;
    const tellVisibility = (visible: boolean) => {
      if (visible !== told && room.send({ type: "presence.visible", visible })) told = visible;
    };
    const visibility = settledVisibility(tellVisibility);

    // Asks who this browser is signed in as now and hands over to them, or to sign in, unless it's still
    // this person or it can't tell, when it does `then`. A session check that answers once this room
    // has closed is dropped: by then it may be about a session that has since been replaced.
    const unlessSessionChanged = (then: () => void) => {
      dispatch({ type: "status", status: "reconnecting" });
      void fetchMe().then(
        (user) => !closed && (isSomeoneElse(user) ? sessionChanged(user) : then()),
        (error) => !closed && (error instanceof ApiError && error.status === 401 ? sessionChanged(null) : then()),
      );
    };

    const onMessage = (data: string) => {
      const frame = parseServerFrame(data);
      if (!frame) return;
      if (frame.type === "welcome" && isSomeoneElse(frame.you)) {
        // Another tab signed this browser out and in as someone else, and the cookie went with it. Leave
        // the room rather than show them this person's, or send as them, and hand over to whoever the
        // server says is signed in, which the room only partly knows: by then it may be this person again.
        room.hold();
        unlessSessionChanged(() => room.retry());
        return;
      }
      dispatch({ type: "frame", frame, now: Date.now() });
      if (frame.type !== "welcome") return;
      room.connected();
      tellVisibility(visibility.visible);
      checkUnconfirmed(room, frame.messages);
      sendQueued(room);
    };

    const onClose = (code: number, opened: boolean) => {
      // The person lost access for good, removed from the workspace or banned, which ends all their
      // sessions, so they connect again only if the browser is still signed in as them.
      if (code === CloseCode.Revoked) {
        unlessSessionChanged(() => room.retry());
        return false;
      }
      // The room isn't there for whoever the browser is signed in as: deleted, or no longer theirs. If
      // that's still this person, there's nothing to connect to.
      if (code === CloseCode.NotFound) {
        unlessSessionChanged(() => {
          room.close();
          dispatch({ type: "status", status: "gone" });
        });
        return false;
      }
      // A refused upgrade looks like any other failure, so ask whether the session has expired, as
      // when the room says to reconnect, which it does when this browser signs out.
      if (!opened || code === CloseCode.Reconnect) {
        void fetchMe().catch((error) => !closed && error instanceof ApiError && error.status === 401 && sessionChanged(null));
      }
      return true;
    };

    dispatch({ type: "reset" });
    const room = reconnectingSocket({
      url: () => roomSocketUrl(roomId, { visible: (told = visibility.visible) }),
      onMessage,
      onConnecting: (status) => dispatch({ type: "status", status }),
      onOffline: (offline) => dispatch({ type: "offline", offline }),
      onClose,
    });
    socket.current = room;

    const expire = setInterval(() => dispatch({ type: "expire-typing", before: Date.now() - TYPING_TTL_MS }), 1_000);
    return () => {
      closed = true;
      clearInterval(expire);
      visibility.stop();
      room.close();
      socket.current = null;
    };
  }, [roomId]);

  const send = useCallback((frame: ClientFrame) => socket.current?.send(frame) ?? false, []);

  const postMessage = useCallback(
    (body: string) => {
      const clientMessageId = crypto.randomUUID();
      const now = new Date().toISOString();
      const message: PendingMessage = {
        id: clientMessageId,
        clientMessageId,
        roomId,
        creator: me,
        body,
        plainText: plainText(body, NO_ONE),
        mentions: [],
        createdAt: now,
        updatedAt: now,
        editedAt: null,
        boosts: [],
        pending: true,
      };
      // Until the room has let a connection in, it waits, behind any already waiting, and shows as not sent
      // once the page is offline.
      if (!send({ type: "message.create", clientMessageId, body })) message.queued = true;
      dispatch({ type: "pending", message });
    },
    [me, roomId, send],
  );

  // Starting is throttled, and stopping isn't, as in ember-rust: a start within a second of the last
  // one goes nowhere, even after a stop. A sent message needs no stop, since everyone else stops
  // showing its author as typing when it arrives.
  const typing = useCallback(
    (active: boolean) => {
      if (!active) return void send({ type: "typing.stop" });
      const now = Date.now();
      if (now - lastTypingStarted.current < TYPING_THROTTLE_MS) return;
      lastTypingStarted.current = now;
      send({ type: "typing.start" });
    },
    [send],
  );

  const loadOlder = useCallback(() => {
    const oldest = state.messages.find((m) => !("pending" in m));
    if (!oldest || state.loadingOlder) return;
    if (send({ type: "history.before", before: oldest.id, limit: HISTORY_PAGE_SIZE })) dispatch({ type: "loading-older" });
  }, [send, state.messages, state.loadingOlder]);

  const messageActions = useMemo(() => {
    // Unlike new messages, these aren't kept to send later, so say when one couldn't go.
    const sendOrWarn = (frame: ClientFrame) => {
      const sent = send(frame);
      if (!sent) dispatch({ type: "frame", frame: { type: "error", message: "Not connected. Try again once you're reconnected." }, now: Date.now() });
      return sent;
    };
    return {
      edit: (messageId: string, body: string) => sendOrWarn({ type: "message.update", messageId, body }),
      remove: (messageId: string) => void sendOrWarn({ type: "message.delete", messageId }),
      boost: (messageId: string, content: string) => void sendOrWarn({ type: "boost.create", messageId, content }),
      unboost: (boostId: string) => void sendOrWarn({ type: "boost.delete", boostId }),
    };
  }, [send]);

  const dismissNotice = useCallback(() => dispatch({ type: "dismiss-notice" }), []);

  return { state, postMessage, typing, loadOlder, messageActions, dismissNotice };
}
