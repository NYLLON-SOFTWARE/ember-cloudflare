import type { Room, RoomId, RoomKind, User, UserId } from "./index.ts";

// Downloading a room or DM as a transcript: Markdown or JSON of the messages the caller can read.

/** How a transcript is written: Markdown for reading, JSON for keeping. */
export const TRANSCRIPT_FORMATS = ["markdown", "json"] as const;
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];

/** Why a transcript request is refused when `format` isn't Markdown or JSON. */
export const TRANSCRIPT_FORMAT_REFUSED = "A transcript is Markdown or JSON.";

/**
 * Reads `format` from a transcript's address: Markdown when it's missing or blank, JSON when it says
 * so, or null when it isn't either, which the Worker refuses as `TRANSCRIPT_FORMAT_REFUSED`.
 */
export function parseTranscriptFormat(value: string | null): TranscriptFormat | null {
  if (value === null || value.trim() === "" || value === "markdown") return "markdown";
  if (value === "json") return "json";
  return null;
}

/** `GET /api/rooms/<id>/transcript`: that room's messages, as Markdown unless `format=json`. */
export const roomTranscriptPath = (roomId: RoomId, format: TranscriptFormat = "markdown") =>
  `/api/rooms/${encodeURIComponent(roomId)}/transcript${format === "markdown" ? "" : "?format=json"}`;

/** `GET /api/transcripts`: every room and DM the caller is in, as Markdown unless `format=json`. */
export const workspaceTranscriptPath = (format: TranscriptFormat = "markdown") =>
  format === "markdown" ? "/api/transcripts" : "/api/transcripts?format=json";

/** A message in a transcript: who wrote it, when, its text, and which message it replies to. */
export interface TranscriptMessage {
  id: string;
  author: User;
  createdAt: string;
  /** Plain text, as the room keeps it. Empty once the message is deleted. */
  text: string;
  /** Markup as stored, when the message has any. */
  body?: string;
  /** The message this replies to, when it's a reply in a thread. */
  parentId?: string;
  /** Whether a reply was also sent to the room. */
  alsoSent?: boolean;
  /** A message deleted while replies in its thread are left, which keeps its place for them. */
  deleted?: boolean;
}

/** One room or DM as a transcript names it: its id, the name the caller reads it by, and its kind. */
export interface TranscriptRoom {
  id: RoomId;
  name: string;
  kind: RoomKind;
}

/** A room's messages, oldest first, with replies naming their parent. */
export interface RoomTranscript {
  room: TranscriptRoom;
  exportedAt: string;
  messages: TranscriptMessage[];
}

/** Every room and DM the caller is in, in the order their sidebar lists them. */
export interface WorkspaceTranscript {
  exportedAt: string;
  rooms: RoomTranscript[];
}

/**
 * Names in a sentence, as a DM's name joins them: "Ada", "Ada and Grace", or "Ada, Grace, and Alan".
 */
export function toSentence(names: string[]): string {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/**
 * A room's name as the person `meId` reads it in a transcript: a shared room's own, and a DM's others'
 * names in a sentence, or their own in their DM with themselves.
 */
export function transcriptTitle(room: Room, meId: UserId): string {
  if (room.kind !== "direct") return room.name;
  const others = room.members.filter((member) => member.id !== meId);
  return toSentence((others.length > 0 ? others : room.members).map((member) => member.name));
}

/** A room as a transcript names it for the person `meId`. */
export const transcriptRoomOf = (room: Room, meId: UserId): TranscriptRoom => ({
  id: room.id,
  name: transcriptTitle(room, meId),
  kind: room.kind,
});

/** `transcript` as JSON, with a trailing newline. */
export const transcriptJson = (transcript: RoomTranscript | WorkspaceTranscript) => `${JSON.stringify(transcript, null, 2)}\n`;

/** A room's transcript as Markdown: its name, then each message, with replies under their parent. */
export function roomTranscriptMarkdown({ room, exportedAt, messages }: RoomTranscript): string {
  return [`# ${room.name}`, "", `Exported ${exportedAt}.`, "", ...markdownMessages(messages)].join("\n").trimEnd() + "\n";
}

/** Every room's transcript as Markdown, each after a rule. */
export function workspaceTranscriptMarkdown({ exportedAt, rooms }: WorkspaceTranscript): string {
  const heading = ["# Your conversations", "", `Exported ${exportedAt}.`, ""];
  if (rooms.length === 0) return heading.join("\n").trimEnd() + "\n";
  return [...heading, rooms.map(roomTranscriptMarkdown).join("\n---\n\n")].join("\n");
}

/** Messages as Markdown, oldest first, with each thread's replies under the message they reply to. */
function markdownMessages(messages: TranscriptMessage[]): string[] {
  const replies = new Map<string, TranscriptMessage[]>();
  const roots: TranscriptMessage[] = [];
  for (const message of messages) {
    if (message.parentId === undefined) roots.push(message);
    else {
      const thread = replies.get(message.parentId);
      if (thread) thread.push(message);
      else replies.set(message.parentId, [message]);
    }
  }
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const message of roots) {
    seen.add(message.id);
    lines.push(...markdownMessage(message, ""), "");
    for (const reply of replies.get(message.id) ?? []) {
      seen.add(reply.id);
      lines.push(...markdownMessage(reply, "  "), "");
    }
  }
  // A reply whose parent isn't in the transcript still appears, so nothing is dropped.
  for (const message of messages) {
    if (seen.has(message.id)) continue;
    lines.push(...markdownMessage(message, ""), "");
  }
  return lines;
}

/** One message as Markdown lines, indented when it's a reply. */
function markdownMessage(message: TranscriptMessage, indent: string): string[] {
  const heading = `${indent}**${message.author.name}** · ${message.createdAt}`;
  const body = message.deleted || message.text === "" ? `${indent}_Deleted._` : message.text.split("\n").map((line) => `${indent}${line}`);
  return [heading, "", ...(typeof body === "string" ? [body] : body)];
}
