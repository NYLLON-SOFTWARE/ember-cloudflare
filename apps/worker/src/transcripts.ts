import {
  isRoomId,
  parseTranscriptFormat,
  roomTranscriptMarkdown,
  transcriptJson,
  transcriptRoomOf,
  TRANSCRIPT_FORMAT_REFUSED,
  workspaceTranscriptMarkdown,
  type Room,
  type RoomId,
  type RoomTranscript,
  type TranscriptFormat,
  type TranscriptMessage,
  type User,
  type WorkspaceTranscript,
} from "@ember/protocol";
import { eachAtMost, ROOMS_AT_ONCE } from "./at-once";
import { credentialsOf } from "./auth";
import type { Env } from "./env";
import { contentDisposition, sanitizedFilename } from "./files/filename";
import { urlOf } from "./request-url";
import { workspace } from "./workspace";

const NOT_SIGNED_IN = "Not signed in";
const ROOM_NOT_FOUND = "Room not found or inaccessible";

const problem = (status: number, message: string) => Response.json({ error: message }, { status });

/**
 * `GET /api/rooms/<id>/transcript`: the room's messages as a file, Markdown unless `?format=json`.
 * Only a member of the room can read it. Thread replies go with their parent.
 */
export async function roomTranscript(request: Request, env: Env, roomId: RoomId): Promise<Response> {
  if (!isRoomId(roomId)) return problem(404, ROOM_NOT_FOUND);
  const format = parseTranscriptFormat(urlOf(request).searchParams.get("format"));
  const credentials = await credentialsOf(request, env);
  const found = credentials && (await workspace(env).roomForTranscript(credentials, roomId));
  if (!found) return problem(401, NOT_SIGNED_IN);
  if (found === "not found") return problem(404, ROOM_NOT_FOUND);
  if (format === null) return problem(422, TRANSCRIPT_FORMAT_REFUSED);
  const messages = await env.CHAT_ROOM.getByName(roomId).transcript(roomId);
  return fileOf(roomFile(found.user, found.room, messages), format);
}

/**
 * `GET /api/transcripts`: every room and DM the caller is in, as one Markdown or JSON file. A member
 * of room A never sees room B.
 */
export async function workspaceTranscript(request: Request, env: Env): Promise<Response> {
  const format = parseTranscriptFormat(urlOf(request).searchParams.get("format"));
  const credentials = await credentialsOf(request, env);
  const found = credentials && (await workspace(env).roomsForTranscript(credentials));
  if (!found) return problem(401, NOT_SIGNED_IN);
  if (format === null) return problem(422, TRANSCRIPT_FORMAT_REFUSED);
  const exportedAt = new Date().toISOString();
  const byId = new Map<RoomId, TranscriptMessage[]>();
  await eachAtMost(found.rooms, ROOMS_AT_ONCE, async (room) => {
    byId.set(room.id, await env.CHAT_ROOM.getByName(room.id).transcript(room.id));
  });
  const transcript: WorkspaceTranscript = {
    exportedAt,
    rooms: found.rooms.map((room) => ({
      room: transcriptRoomOf(room, found.user.id),
      exportedAt,
      messages: byId.get(room.id) ?? [],
    })),
  };
  return fileOf(transcript, format, "your-conversations");
}

function roomFile(user: User, room: Room, messages: TranscriptMessage[]): RoomTranscript {
  return { room: transcriptRoomOf(room, user.id), exportedAt: new Date().toISOString(), messages };
}

/** `transcript` as a download, named from `title` or the room's name. */
function fileOf(transcript: RoomTranscript | WorkspaceTranscript, format: TranscriptFormat, title?: string): Response {
  const name = title ?? ("room" in transcript ? transcript.room.name : "your-conversations");
  const body = format === "json" ? transcriptJson(transcript) : "room" in transcript ? roomTranscriptMarkdown(transcript) : workspaceTranscriptMarkdown(transcript);
  const filename = `${sanitizedFilename(name) || "transcript"}.${format === "json" ? "json" : "md"}`;
  return new Response(body, {
    headers: {
      "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
      "Content-Disposition": contentDisposition("attachment", filename),
      "Cache-Control": "no-store",
    },
  });
}
