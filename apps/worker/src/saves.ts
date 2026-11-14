import { parseSave, type Message, type SavedItem, type SavedItems, type SavedMessage } from "@ember/protocol";
import { eachAtMost, ROOMS_AT_ONCE } from "./at-once";
import { credentialsOf } from "./auth";
import { jsonBodyOf } from "./bodies";
import { sharedDb } from "./db";
import type { Env } from "./env";
import { messagesInRoomWithIds } from "./store";
import { workspace, type Searcher } from "./workspace";

// Saving messages for later: a person's own list, in whatever rooms the messages live in. The rows keep
// only the ids, so the Saved pane asks each room for its messages as it shows them, as search results
// do, and each room answers only what it keeps, so a save naming another room's message reads nothing
// of it.

const problem = (status: number, message: string) => Response.json({ error: message }, { status });

const NOT_SIGNED_IN = "Not signed in";

/** `POST /api/saves`, a `roomId` and a `messageId`: saves the message for later for the person signed in, answering the save. 409 once they have it saved. */
export async function saveMessage(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const asked = parseSave(await jsonBodyOf(request));
  if (typeof asked === "string") return problem(400, asked);
  const saved = await workspace(env).saveMessage(credentials, asked.roomId, asked.messageId);
  if (!saved) return problem(401, NOT_SIGNED_IN);
  if (saved === "forbidden") return problem(403, "You can save a message only from a room you're in");
  if (saved === "saved already") return problem(409, "You've saved that message already");
  return Response.json({ save: saved } satisfies { save: SavedMessage }, { status: 201 });
}

/**
 * `GET /api/saves`: the messages you've saved for later, newest save first, each as its room has it now,
 * with the room each lives in among those you can see. A save whose message is gone, or whose room you
 * can no longer see, quietly leaves the answer and the table, so the pane cleans itself.
 */
export async function saves(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const searcher = credentials && (await workspace(env).searcher(credentials, null));
  if (!searcher) return problem(401, NOT_SIGNED_IN);
  const rows = await workspace(env).saves(credentials);
  if (!rows) return problem(401, NOT_SIGNED_IN);
  return Response.json({ saves: await answer(env, rows, searcher) } satisfies SavedItems, { headers: { "Cache-Control": "no-store" } });
}

/** `DELETE /api/saves/:id`: forgets your save `id`, answering 404 for one that isn't yours or isn't there. */
export async function forgetSave(request: Request, env: Env, id: string): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  return (await workspace(env).forgetSave(credentials, id)) ? new Response(null, { status: 204 }) : problem(404, "No such save");
}

/** The saves `rows` name that still answer: each with its message as the room has it, newest save first. */
async function answer(env: Env, rows: SavedMessage[], { rooms }: Searcher): Promise<SavedItem[]> {
  const visible = new Set(rooms.map(({ id }) => id));
  const seen = rows.filter(({ roomId }) => visible.has(roomId));
  // A save whose room is out of sight leaves, as one whose message is gone does below.
  const dropped = rows.flatMap(({ id, roomId }) => (visible.has(roomId) ? [] : [id]));
  const messages = new Map((await readNow(env, seen)).map((message) => [message.id, message]));
  const items: SavedItem[] = [];
  for (const save of seen) {
    const message = messages.get(save.messageId);
    if (message) items.push({ ...save, message });
    else dropped.push(save.id);
  }
  // A message deleted, or a room they're out of, drops its save for good, in this same request.
  await workspace(env).forgetSaves(dropped);
  return items;
}

/** The messages `saves` name that are still there, each from the room its save says it lives in, a room's worth at once. */
async function readNow(env: Env, saves: SavedMessage[]): Promise<Message[]> {
  if (saves.length === 0) return [];
  const db = sharedDb(env);
  const messages: Message[] = [];
  await eachAtMost([...Map.groupBy(saves, ({ roomId }) => roomId)], ROOMS_AT_ONCE, async ([roomId, inRoom]) => {
    // The room and the ids ask together, on D1 as in each room, so a save can't read a message its room
    // doesn't keep, as one naming another room's message would.
    const ids = inRoom.map(({ messageId }) => messageId);
    messages.push(...(db ? await messagesInRoomWithIds(db, roomId, ids, env.SESSION_SECRET) : await env.CHAT_ROOM.getByName(roomId).messagesWithIds(roomId, ids)));
  });
  return messages;
}
