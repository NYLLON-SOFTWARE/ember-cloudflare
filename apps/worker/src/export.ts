import { EXPORT_PAGE_SIZE, type ExportedListing, type ExportedMessages, type RoomId } from "@ember/protocol";
import { credentialsOf } from "./auth";
import type { Env } from "./env";
import { urlOf } from "./request-url";
import { workspace } from "./workspace";

// The workspace export, which scripts/export.ts writes as NDJSON for whoever keeps it: everyone and
// every room, then each room's messages a page at a time, as the search reindex reads them. An
// administrator's alone, since DMs and closed rooms are in it whoever they're for.

const problem = (status: number, message: string) => Response.json({ error: message }, { status });

const NOT_SIGNED_IN = "Not signed in";
const ADMINISTRATORS_ONLY = "Only administrators can export the workspace";

/**
 * `GET /api/export`: everyone, with their roles, and every room, the shared ones by name and the DMs
 * after them, with who's in each that's for just them. No messages, which each room's own object
 * reads, so that nothing queries a room's storage from outside it.
 */
export async function exportListing(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const listing = credentials && (await workspace(env).exportWorkspace(credentials));
  if (!listing) return problem(401, NOT_SIGNED_IN);
  if (listing === "forbidden") return problem(403, ADMINISTRATORS_ONLY);
  return Response.json(listing satisfies ExportedListing, { headers: { "Cache-Control": "no-store" } });
}

/**
 * `GET /api/export/rooms/<room id>/messages?after=<message id>`: the room's oldest messages after that
 * one, oldest first, replies sent only to their threads and deleted ones included, with whether the
 * room has more after them. The first page leaves `after` out.
 */
export async function exportRoomMessages(request: Request, env: Env, roomId: RoomId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const administrator = credentials && (await workspace(env).canAdminister(credentials));
  if (!credentials || administrator === null) return problem(401, NOT_SIGNED_IN);
  if (!administrator) return problem(403, ADMINISTRATORS_ONLY);
  const after = urlOf(request).searchParams.get("after");
  const page = await env.CHAT_ROOM.getByName(roomId).exportPage(roomId, after, EXPORT_PAGE_SIZE);
  return Response.json(page satisfies ExportedMessages, { headers: { "Cache-Control": "no-store" } });
}
