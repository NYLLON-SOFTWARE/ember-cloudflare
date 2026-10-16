import type { RoomId, RoomKind } from "@ember/protocol";

// What a push of a new message says, as ember-rust's `MessagePusher` builds it
// (crates/db/src/models/push_subscription.rs) and `WebPush::Notification` writes it
// (crates/ember/src/integrations/web_push.rs), for the service worker to show as it is.

/**
 * How long a push's title and text may be, counted as the bytes they take in its JSON, which ember-rust
 * cuts them to so the push still fits once it's encrypted: a push service takes 4,096 bytes at most.
 */
export const MAX_TITLE_BYTES = 256;
export const MAX_BODY_BYTES = 3072;

/** What a push shows, and the page opening it opens. */
export interface PushPayload {
  title: string;
  body: string;
  path: string;
}

/** What a message's push says of the room it's in and who wrote it. */
export interface PushedRoom {
  kind: RoomKind;
  /** Null for a DM. */
  name: string | null;
}

/**
 * A new message's push, as ember-rust's `build_payload` makes it: a DM's is titled with the sender's
 * name and reads the message's plain text, and any other room's is titled with the room's name and
 * reads "<sender>: <text>". Opening it opens the room, not the message. A title or text too long is cut
 * short, with an ellipsis, as ember-rust's are and Rails' weren't.
 */
export function messagePayload(roomId: RoomId, room: PushedRoom, senderName: string, plainText: string): PushPayload {
  const [title, body] = room.kind === "direct" ? [senderName, plainText] : [room.name ?? "", `${senderName}: ${plainText}`];
  return { title: truncated(title, MAX_TITLE_BYTES), body: truncated(body, MAX_BODY_BYTES), path: `/rooms/${roomId}` };
}

/**
 * The push as the service worker reads it, with the count `badge` sets the app's badge to, in the order
 * and escaping ember-rust's `encoded_message` writes it, which `JSON.stringify`'s match. Its icon is the
 * workspace's logo.
 */
export const encodedPush = ({ title, body, path }: PushPayload, badge: number): string =>
  JSON.stringify({ title, options: { body, icon: "/account/logo", data: { path, badge } } });

const ELLIPSIS = "…";

/** `text`, cut short with an ellipsis if it takes more than `maxBytes` as a JSON string's contents, as ember-rust's `truncate_json_string` cuts it. */
function truncated(text: string, maxBytes: number): string {
  const characters = [...text];
  if (characters.reduce((bytes, character) => bytes + jsonLength(character), 0) <= maxBytes) return text;
  let used = jsonLength(ELLIPSIS);
  const kept = characters.findIndex((character) => (used += jsonLength(character)) > maxBytes);
  return characters.slice(0, kept).join("") + ELLIPSIS;
}

/**
 * The bytes a character takes in a JSON string: a quote, a backslash and the control characters with
 * short escapes take two, other control characters six (`\u001f`), as does an unpaired surrogate, which
 * `JSON.stringify` escapes too, and anything else its UTF-8.
 */
function jsonLength(character: string): number {
  const code = character.codePointAt(0)!;
  if ('"\\\n\r\t\b\f'.includes(character)) return 2;
  if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff)) return 6;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
}
