import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef } from "react";
import { HISTORY_PAGE_SIZE, parseServerFrame, type ClientFrame, type User } from "@ember/protocol";
import { ApiError, fetchMe, roomSocketUrl } from "@/lib/api";
import { initialRoomState, roomReducer } from "@/lib/room-state";

const HEARTBEAT_MS = 25_000;
const TYPING_TTL_MS = 6_000;
const TYPING_RESEND_MS = 3_000;
const MAX_BACKOFF_MS = 15_000;

/** One room's live state over a reconnecting WebSocket to its ChatRoom Durable Object. */
export function useRoom(roomId: string, token: string, me: User, onSessionExpired: () => void) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const socket = useRef<WebSocket | null>(null);
  const lastTypingSent = useRef(0);
  const sessionExpired = useEffectEvent(onSessionExpired);

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
      const ws = new WebSocket(roomSocketUrl(roomId, token));
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
        if (frame) dispatch({ type: "frame", frame, now: Date.now() });
      };
      ws.onclose = () => {
        clearInterval(heartbeat);
        if (closed) return;
        // A refused upgrade looks like any other failure, so ask whether the session has expired.
        if (!opened) void fetchMe(token).catch((error) => error instanceof ApiError && error.status === 401 && sessionExpired());
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
  }, [roomId, token]);

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

  const messageActions = useMemo(
    () => ({
      edit: (messageId: string, body: string) => void send({ type: "message.update", messageId, body }),
      remove: (messageId: string) => void send({ type: "message.delete", messageId }),
      boost: (messageId: string, content: string) => void send({ type: "boost.create", messageId, content }),
      unboost: (boostId: string) => void send({ type: "boost.delete", boostId }),
    }),
    [send],
  );

  const dismissNotice = useCallback(() => dispatch({ type: "dismiss-notice" }), []);

  return { state, postMessage, typing, loadOlder, messageActions, dismissNotice };
}
