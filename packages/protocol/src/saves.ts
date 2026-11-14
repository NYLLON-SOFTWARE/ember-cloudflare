import type { Message, RoomId } from "./index.ts";
import { MAX_ID_LENGTH } from "./pages.ts";

// Saving messages for later: what Slack's Saved items keeps, a person's own list of messages, in
// whatever rooms they live in.

/**
 * How many messages one person keeps saved for later: the ones they saved most recently. Keeping any
 * number, and fetching each one's message to answer the list whenever the page loads, would have
 * opening chat cost more the more one person saves, whether the Saved pane is open or not.
 */
export const MAX_SAVES = 50;

/** A message someone saved for later: the ids it's kept by, and when it was saved, in milliseconds since the epoch. */
export interface SavedMessage {
  /** The save's own id, which removing it names. */
  id: string;
  /** The room the message lives in, which the pane asks for it, as search results do. */
  roomId: RoomId;
  /** The message saved, which nothing is snapshotted of: it shows as it is now, and its save leaves the pane once it's gone. */
  messageId: string;
  /** When it was saved, in milliseconds since the epoch. */
  createdAt: number;
}

/** A saved message, with the message as its room has it now, as `GET /api/saves` answers it. */
export interface SavedItem extends SavedMessage {
  message: Message;
}

/** What `GET /api/saves` answers: the messages you've saved, newest save first. */
export interface SavedItems {
  saves: SavedItem[];
}

/** What `POST /api/saves` answers it made. */
export interface SaveMade {
  save: SavedMessage;
}

/**
 * Parses what `POST /api/saves` takes: the room a message lives in and the message itself. Returns why
 * it's refused instead.
 */
export function parseSave(data: unknown): { roomId: RoomId; messageId: string } | string {
  if (typeof data !== "object" || data === null) return "Saving a message names the room it's in";
  const { roomId, messageId } = data as Record<string, unknown>;
  if (typeof roomId !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(roomId)) return "A saved message names a room by its id";
  if (typeof messageId !== "string" || messageId === "" || messageId.length > MAX_ID_LENGTH) return "A saved message names a message by its id";
  return { roomId, messageId };
}
