import {
  isRoomId,
  parseTranscriptFormat,
  roomTranscriptMarkdown,
  transcriptRoomOf,
  TRANSCRIPT_FORMAT_REFUSED,
  type Room,
  type RoomId,
  type TranscriptFormat,
  type TranscriptMessage,
  type TranscriptRoom,
  type User,
} from "@ember/protocol";
import { credentialsOf } from "./auth";
import type { Env } from "./env";
import { contentDisposition, sanitizedFilename } from "./files/filename";
import { urlOf } from "./request-url";
import { workspace } from "./workspace";

const NOT_SIGNED_IN = "Not signed in";
const ROOM_NOT_FOUND = "Room not found or inaccessible";
const encoder = new TextEncoder();

const problem = (status: number, message: string) => Response.json({ error: message }, { status });

/**
 * `GET /api/rooms/<id>/transcript`: the room's messages as a file, Markdown unless `?format=json`.
 * Only a member of the room can read it. Thread replies go with their parent. Pages over RPC so a long
 * room still fits, and writes the file as it goes.
 */
export async function roomTranscript(request: Request, env: Env, roomId: RoomId): Promise<Response> {
  if (!isRoomId(roomId)) return problem(404, ROOM_NOT_FOUND);
  const format = parseTranscriptFormat(urlOf(request).searchParams.get("format"));
  const credentials = await credentialsOf(request, env);
  const found = credentials && (await workspace(env).roomForTranscript(credentials, roomId));
  if (!found) return problem(401, NOT_SIGNED_IN);
  if (found === "not found") return problem(404, ROOM_NOT_FOUND);
  if (format === null) return problem(422, TRANSCRIPT_FORMAT_REFUSED);
  const exportedAt = new Date().toISOString();
  const room = transcriptRoomOf(found.room, found.user.id);
  return fileOf(room.name, format, streamOf((write) => writeRoom(write, env, roomId, room, exportedAt, format)));
}

/**
 * `GET /api/transcripts`: every room and DM the caller is in, as one Markdown or JSON file. A member
 * of room A never sees room B. One room at a time, paged over RPC.
 */
export async function workspaceTranscript(request: Request, env: Env): Promise<Response> {
  const format = parseTranscriptFormat(urlOf(request).searchParams.get("format"));
  const credentials = await credentialsOf(request, env);
  const found = credentials && (await workspace(env).roomsForTranscript(credentials));
  if (!found) return problem(401, NOT_SIGNED_IN);
  if (format === null) return problem(422, TRANSCRIPT_FORMAT_REFUSED);
  const exportedAt = new Date().toISOString();
  return fileOf("your-conversations", format, streamOf((write) => writeWorkspace(write, env, found.user, found.rooms, exportedAt, format)));
}

/** `name` as a download of `format`, written as `run` produces it. */
function fileOf(name: string, format: TranscriptFormat, body: ReadableStream<Uint8Array>): Response {
  const filename = `${sanitizedFilename(name) || "transcript"}.${format === "json" ? "json" : "md"}`;
  return new Response(body, {
    headers: {
      "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
      "Content-Disposition": contentDisposition("attachment", filename),
      "Cache-Control": "no-store",
    },
  });
}

function streamOf(run: (write: (text: string) => void) => Promise<void>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      try {
        await run((text) => controller.enqueue(encoder.encode(text)));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/** One page of `roomId`'s transcript at a time, oldest first. */
async function* pagesOf(env: Env, roomId: RoomId): AsyncGenerator<TranscriptMessage[]> {
  let after: string | undefined;
  for (;;) {
    const page = after === undefined ? await env.CHAT_ROOM.getByName(roomId).transcriptPage(roomId) : await env.CHAT_ROOM.getByName(roomId).transcriptPage(roomId, after);
    if (page.messages.length > 0) yield page.messages;
    if (page.after === undefined) return;
    after = page.after;
  }
}

async function messagesOf(env: Env, roomId: RoomId): Promise<TranscriptMessage[]> {
  const messages: TranscriptMessage[] = [];
  for await (const page of pagesOf(env, roomId)) messages.push(...page);
  return messages;
}

async function writeRoom(write: (text: string) => void, env: Env, roomId: RoomId, room: TranscriptRoom, exportedAt: string, format: TranscriptFormat): Promise<void> {
  if (format === "json") {
    write(`{\n  "room": ${JSON.stringify(room)},\n  "exportedAt": ${JSON.stringify(exportedAt)},\n  "messages": [`);
    let first = true;
    for await (const page of pagesOf(env, roomId)) {
      for (const message of page) {
        write(first ? "\n    " : ",\n    ");
        first = false;
        write(JSON.stringify(message));
      }
    }
    write(first ? "]\n}\n" : "\n  ]\n}\n");
    return;
  }
  // Markdown groups replies under their parent, so one room is gathered after it's paged over RPC.
  write(roomTranscriptMarkdown({ room, exportedAt, messages: await messagesOf(env, roomId) }));
}

async function writeWorkspace(write: (text: string) => void, env: Env, user: User, rooms: Room[], exportedAt: string, format: TranscriptFormat): Promise<void> {
  if (format === "json") {
    write(`{\n  "exportedAt": ${JSON.stringify(exportedAt)},\n  "rooms": [`);
    let firstRoom = true;
    for (const listed of rooms) {
      const room = transcriptRoomOf(listed, user.id);
      write(firstRoom ? "\n    " : ",\n    ");
      firstRoom = false;
      write(`{\n      "room": ${JSON.stringify(room)},\n      "exportedAt": ${JSON.stringify(exportedAt)},\n      "messages": [`);
      let firstMessage = true;
      for await (const page of pagesOf(env, listed.id)) {
        for (const message of page) {
          write(firstMessage ? "\n        " : ",\n        ");
          firstMessage = false;
          write(JSON.stringify(message));
        }
      }
      write(firstMessage ? "]\n    }" : "\n      ]\n    }");
    }
    write(rooms.length === 0 ? "]\n}\n" : "\n  ]\n}\n");
    return;
  }
  write(`# Your conversations\n\nExported ${exportedAt}.\n`);
  if (rooms.length === 0) return;
  write("\n");
  for (const [index, listed] of rooms.entries()) {
    if (index > 0) write("\n---\n\n");
    write(roomTranscriptMarkdown({ room: transcriptRoomOf(listed, user.id), exportedAt, messages: await messagesOf(env, listed.id) }));
  }
}
