import { THREAD_CONTEXT, THREADS_LIMIT, type DirectPreviews, type ListedThread, type ListedThreads, type Message, type ScheduledList } from "@ember/protocol";
import { credentialsOf } from "./auth";
import type { Env } from "./env";
import { urlOf } from "./request-url";
import { numberAt, searchIndex, type ThreadMarks, type ThreadMessageRow } from "./search-index";
import { indexedMessages } from "./store";
import { workspace } from "./workspace";

// What the DMs page and the Threads page show, read from the search index, which keeps every room's
// messages in one place, so neither asks each room, and the scheduled messages Drafts & sent lists, which
// the Workspace keeps a copy of for the same reason.

const notSignedIn = () => Response.json({ error: "Not signed in" }, { status: 401 });

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * `GET /api/directs`: each of your DMs with its latest message, not counting replies in threads, and
 * how many messages others have written there since it was marked unread.
 */
export async function directPreviews(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return notSignedIn();
  const [sidebar, me] = await Promise.all([workspace(env).sidebar(credentials), workspace(env).me(credentials)]);
  if (!sidebar || !me) return notSignedIn();
  const directs = sidebar.rooms.flatMap((room) => (room.kind === "direct" ? [{ id: room.id, since: room.unread && room.unreadSince ? numberAt(room.unreadSince) : null }] : []));
  const indexed = directs.length === 0 ? [] : await searchIndex(env).directPreviews(directs, me.id);
  const latest = await messagesById(indexed.flatMap(({ message }) => message ?? []), env);
  const previews = indexed.map(({ roomId, message, unread }) => ({ roomId, latest: message === null ? null : (latest.get(idOf(message)) ?? null), unread }));
  return Response.json({ previews } satisfies DirectPreviews, { headers: NO_STORE });
}

/**
 * `GET /api/threads?cursor=`: a page of the threads in the rooms and DMs you're in, latest active first,
 * each with its first message and its latest replies, whether you follow it and whether it mentions you,
 * and the cursor of the page after, if there is one.
 */
export async function listedThreads(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const me = credentials && (await workspace(env).searcher(credentials, null));
  if (!me) return notSignedIn();
  const cursor = Number(urlOf(request).searchParams.get("cursor") ?? Number.NaN);
  const after = Number.isSafeInteger(cursor) ? cursor : null;
  const roomIds = me.rooms.map(({ id }) => id);
  const { rows, threads: marks, next } = await searchIndex(env).listedThreads(me.userId, roomIds, after, THREADS_LIMIT, THREAD_CONTEXT);
  const messages = await messagesById(rows.flatMap(({ message }) => message ?? []), env);
  const threads = threadsOf(marks, rows, messages);
  return Response.json({ threads, next } satisfies ListedThreads, { headers: NO_STORE });
}

/**
 * The threads `marks` names, in order, from their messages' rows, leaving out any whose first message
 * the index hasn't kept, each with its latest replies, so its card shows `THREAD_CONTEXT` messages at most.
 */
export function threadsOf(marks: ThreadMarks[], rows: ThreadMessageRow[], messages: Map<string, Message>): ListedThread[] {
  const byThread = Map.groupBy(rows, ({ threadId }) => threadId);
  return marks.flatMap(({ threadId, following, mentioned }) => {
    const inThread = byThread.get(threadId) ?? [];
    const parent = messages.get(threadId);
    if (!parent || inThread.length === 0) return [];
    const replies = inThread.flatMap(({ messageId }) => (messageId === threadId ? [] : (messages.get(messageId) ?? [])));
    return [{ roomId: inThread[0]!.roomId, parent, replies: replies.slice(-(THREAD_CONTEXT - 1)), count: inThread[0]!.total - 1, following: following === 1, mentioned: mentioned === 1 }];
  });
}

/** The messages the index kept as `rows`, by id. */
async function messagesById(rows: string[], env: Env): Promise<Map<string, Message>> {
  const messages = await indexedMessages(rows, env.SESSION_SECRET);
  return new Map(messages.map((message) => [message.id, message]));
}

/** The id of the message a row the index kept is. */
const idOf = (row: string) => (JSON.parse(row) as { id: string }).id;

/** `GET /api/scheduled`: your scheduled messages in the rooms you're still in, soonest first. */
export async function listScheduled(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const messages = credentials && (await workspace(env).scheduledMessages(credentials));
  if (!messages) return notSignedIn();
  return Response.json({ messages } satisfies ScheduledList, { headers: NO_STORE });
}
