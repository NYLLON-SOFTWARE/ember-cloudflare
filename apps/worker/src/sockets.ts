import { CloseCode } from "@ember/protocol";

// What rooms and the Workspace, the Durable Objects that keep sockets, share about closing them.

/** What a socket closed with each code says, for anyone reading the close. */
export const CLOSE_REASONS: Record<CloseCode, string> = { [CloseCode.Reconnect]: "Reconnect", [CloseCode.Revoked]: "Revoked", [CloseCode.NotFound]: "NotFound" };

/**
 * A socket that closes with `code` as soon as it opens: a browser can't read why an upgrade was refused.
 * wrangler dev logs "Uncaught Error: Network connection lost." as each one finishes closing, even after
 * a clean close handshake: the runtime raises it once the close event has fired, where nothing here can
 * catch it, and the Worker's tests, which have no network between them and the Worker, never see it.
 */
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
export const RESERVED_CLOSE_CODES = new Set([1004, 1005, 1006, 1015]);
