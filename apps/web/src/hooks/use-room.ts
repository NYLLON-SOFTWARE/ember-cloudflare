import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef } from "react";
import {
  CloseCode,
  HISTORY_PAGE_SIZE,
  isMessageTooLong,
  MAX_CHECKED_MESSAGES,
  MAX_MESSAGE_HTML_LENGTH,
  MESSAGE_TOO_LONG,
  parseServerFrame,
  type ClientFrame,
  type Me,
  type Message,
  type User,
} from "@ember/protocol";
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
 * Whether the room would refuse `body`, whose plain text is `text`, as too long: more text than it
 * takes, or more markup than a frame carries, which only so much formatting makes.
 */
const isTooLong = (body: string, text: string) => isMessageTooLong(text) || body.length > MAX_MESSAGE_HTML_LENGTH;

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
  // message but before the confirmation came back, and a reconnect's welcome only holds the newest page,
  // which a later `resumed` doesn't go back past. So ask the room about the sent messages a reconnect
  // doesn't confirm, which the reducer keeps as sending until it answers. Those written while it was away
  // never went, so they aren't asked about.
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
    // The latest change to the room this page has heard of, by its number, which a socket that connects
    // again names, so the room sends what changed since rather than its newest page. The room numbers its
    // changes one after another, so a gap is one it never announced, as when D1 saves a batch whose answer
    // is lost: this stays at the change before it, and connecting again brings what it missed.
    let seen: number | undefined;

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
      const opening = frame.type === "welcome" || frame.type === "resumed";
      if (opening && isSomeoneElse(frame.you)) {
        // Another tab signed this browser out and in as someone else, and the cookie went with it. Leave
        // the room rather than show them this person's, or send as them, and hand over to whoever the
        // server says is signed in, which the room only partly knows: by then it may be this person again.
        room.hold();
        unlessSessionChanged(() => room.retry());
        return;
      }
      // A room from before rooms numbered their changes opens without a number, which leaves none to name.
      if (opening) seen = frame.seq;
      else if ("seq" in frame && seen !== undefined && frame.seq === seen + 1) seen = frame.seq;
      dispatch({ type: "frame", frame, now: Date.now() });
      if (!opening) return;
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
      url: () => roomSocketUrl(roomId, { visible: (told = visibility.visible), since: seen }),
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
  // Says why something written didn't go, as the room says why it refused something.
  const warn = useCallback((message: string) => dispatch({ type: "frame", frame: { type: "error", message }, now: Date.now() }), []);

  // Answers whether the message went. One longer than the room takes doesn't, and stays where it was written.
  const postMessage = useCallback(
    (body: string) => {
      const text = plainText(body, NO_ONE);
      if (isTooLong(body, text)) {
        warn(MESSAGE_TOO_LONG);
        return false;
      }
      const clientMessageId = crypto.randomUUID();
      const now = new Date().toISOString();
      const message: PendingMessage = {
        id: clientMessageId,
        clientMessageId,
        roomId,
        creator: me,
        body,
        plainText: text,
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
      return true;
    },
    [me, roomId, send, warn],
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
    const before = state.oldestId;
    if (before === null || state.loadingOlder) return;
    if (send({ type: "history.before", before, limit: HISTORY_PAGE_SIZE })) dispatch({ type: "loading-older" });
  }, [send, state.oldestId, state.loadingOlder]);

  const messageActions = useMemo(() => {
    // Unlike new messages, these aren't kept to send later, so say when one couldn't go.
    const sendOrWarn = (frame: ClientFrame) => {
      const sent = send(frame);
      if (!sent) warn("Not connected. Try again once you're reconnected.");
      return sent;
    };
    return {
      // An edit longer than the room takes isn't sent either, so its editor keeps it.
      edit: (messageId: string, body: string) => {
        if (!isTooLong(body, plainText(body, NO_ONE))) return sendOrWarn({ type: "message.update", messageId, body });
        warn(MESSAGE_TOO_LONG);
        return false;
      },
      remove: (messageId: string) => sendOrWarn({ type: "message.delete", messageId }),
      boost: (messageId: string, content: string) => void sendOrWarn({ type: "boost.create", messageId, content }),
      unboost: (boostId: string) => void sendOrWarn({ type: "boost.delete", boostId }),
    };
  }, [send, warn]);

  const dismissNotice = useCallback(() => dispatch({ type: "dismiss-notice" }), []);

  return { state, postMessage, typing, loadOlder, messageActions, dismissNotice };
}
