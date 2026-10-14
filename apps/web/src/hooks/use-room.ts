import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef } from "react";
import { HISTORY_PAGE_SIZE, MAX_CHECKED_MESSAGES, parseServerFrame, SESSION_ENDED, type ClientFrame, type Message, type User } from "@ember/protocol";
import { ApiError, fetchMe, roomSocketUrl } from "@/lib/api";
import { initialRoomState, roomReducer, unconfirmed } from "@/lib/room-state";

const HEARTBEAT_MS = 25_000;
const TYPING_TTL_MS = 6_000;
const TYPING_RESEND_MS = 3_000;
const MAX_BACKOFF_MS = 15_000;

/**
 * One room's live state over a reconnecting WebSocket to its ChatRoom Durable Object, as `me`.
 * `onSessionChanged` hears when the browser's session stops signing in `me`: null once it has expired,
 * or whoever another tab signed in as.
 */
export function useRoom(roomId: string, me: User, onSessionChanged: (me: User | null) => void) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const socket = useRef<WebSocket | null>(null);
  const lastTypingSent = useRef(0);
  const sessionChanged = useEffectEvent(onSessionChanged);
  const isSomeoneElse = useEffectEvent((user: User) => user.id !== me.id);

  // ember-rust posts each message over HTTP, and shows it as failed only when that request fails
  // (composer_controller.js). A socket can lose the answer instead: it can close after the room stored a
  // message but before the confirmation came back, and a reconnect's welcome only holds the newest page.
  // So ask the room about the sent messages the welcome doesn't confirm, which the reducer keeps as
  // sending until it answers.
  const checkUnconfirmed = useEffectEvent((ws: WebSocket, snapshot: Message[]) => {
    const clientMessageIds = unconfirmed(state.messages, snapshot).flatMap((m) => (m.failed ? [] : [m.clientMessageId]));
    for (let i = 0; i < clientMessageIds.length; i += MAX_CHECKED_MESSAGES) {
      const check: ClientFrame = { type: "message.check", clientMessageIds: clientMessageIds.slice(i, i + MAX_CHECKED_MESSAGES) };
      ws.send(JSON.stringify(check));
    }
  });

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const reconnect = () => {
      clearInterval(heartbeat);
      const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt++) * (0.75 + Math.random() / 2);
      dispatch({ type: "status", status: "reconnecting" });
      retry = setTimeout(open, delay);
    };

    const open = () => {
      dispatch({ type: "status", status: attempt === 0 ? "connecting" : "reconnecting" });
      const ws = new WebSocket(roomSocketUrl(roomId));
      socket.current = ws;
      let opened = false;
      let unanswered = false;

      ws.onopen = () => {
        opened = true;
        attempt = 0;
        heartbeat = setInterval(() => {
          if (unanswered) {
            // Nothing came back since the last ping, so the network dropped without closing the socket.
            ws.onclose = null;
            ws.close();
            return reconnect();
          }
          unanswered = true;
          ws.send('{"type":"ping"}');
        }, HEARTBEAT_MS);
      };
      ws.onmessage = (event) => {
        unanswered = false;
        const frame = parseServerFrame(String(event.data));
        if (!frame) return;
        if (frame.type === "welcome" && isSomeoneElse(frame.you)) {
          // Another tab signed this browser out and in as someone else, and the cookie went with it. Leave
          // the room rather than show them this person's, or send as them.
          clearInterval(heartbeat);
          ws.onclose = null;
          ws.close(1000);
          return sessionChanged(frame.you);
        }
        dispatch({ type: "frame", frame, now: Date.now() });
        if (frame.type === "welcome") checkUnconfirmed(ws, frame.messages);
      };
      ws.onclose = (event) => {
        clearInterval(heartbeat);
        if (closed) return;
        // A refused upgrade looks like any other failure, so ask whether the session has expired, as
        // when the room says it has ended. An answer that comes after the room closed may be about a
        // session that has since been replaced.
        if (!opened || event.code === SESSION_ENDED) {
          void fetchMe().catch((error) => !closed && error instanceof ApiError && error.status === 401 && sessionChanged(null));
        }
        reconnect();
      };
    };

    dispatch({ type: "reset" });
    open();

    const expire = setInterval(() => dispatch({ type: "expire-typing", before: Date.now() - TYPING_TTL_MS }), 1_000);
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      clearInterval(expire);
      socket.current?.close(1000);
      socket.current = null;
    };
  }, [roomId]);

  const send = useCallback((frame: ClientFrame) => {
    const ws = socket.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(frame));
    return true;
  }, []);

  const postMessage = useCallback(
    (body: string) => {
      const clientMessageId = crypto.randomUUID();
      const now = new Date().toISOString();
      dispatch({
        type: "pending",
        message: { id: clientMessageId, clientMessageId, roomId, creator: me, body, createdAt: now, updatedAt: now, boosts: [], pending: true },
      });
      lastTypingSent.current = 0;
      if (!send({ type: "message.create", clientMessageId, body })) {
        dispatch({ type: "frame", frame: { type: "error", message: "Not connected. Your message wasn't sent.", clientMessageId }, now: Date.now() });
      }
    },
    [me, roomId, send],
  );

  const typing = useCallback(
    (active: boolean) => {
      const now = Date.now();
      if (active && now - lastTypingSent.current < TYPING_RESEND_MS) return;
      lastTypingSent.current = active ? now : 0;
      send({ type: active ? "typing.start" : "typing.stop" });
    },
    [send],
  );

  const loadOlder = useCallback(() => {
    const oldest = state.messages.find((m) => !("pending" in m));
    if (!oldest || state.loadingOlder) return;
    if (send({ type: "history.before", before: oldest.id, limit: HISTORY_PAGE_SIZE })) dispatch({ type: "loading-older" });
  }, [send, state.messages, state.loadingOlder]);

  const messageActions = useMemo(() => {
    // Unlike new messages, these aren't kept to show as unsent, so say when one couldn't go.
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
