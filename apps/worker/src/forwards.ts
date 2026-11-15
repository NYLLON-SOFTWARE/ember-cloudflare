import { parseNewForward, threadPath, type Message, type RoomId } from "@ember/protocol";
import { bodyFromPlainText, quoteMarkup } from "@ember/richtext";
import { credentialsOf } from "./auth";
import { jsonBodyOf } from "./bodies";
import { MESSAGE_GONE, type ChatRoom, type KeptFile } from "./chat-room";
import type { Env } from "./env";
import { objectKey, previewKey } from "./files/blobs";
import type { ImageSize } from "./files/images";
import { storeArriving } from "./files/streamed";
import { NO_STORAGE, uploaderIn, type Uploader } from "./files/uploads";
import { mentionedName, quotedNodes, quotedText } from "./forward-quotes";
import { sortableId } from "./ids";

// Forward message, as Slack's is: someone posts a message they can see into another conversation they're
// in, or a thread there, after a note of their own, as a quote of it, as Quote writes one. The Worker builds
// the quote from the message as its room keeps it, so a forward shows only what was forwarded, and copies
// a file message's file into the conversation it goes to, whose people may not see the room it came from.

const NOT_SIGNED_IN = "Not signed in";
const MESSAGE_NOT_FOUND = "Message not found";
const problem = (status: number, message: string) => Response.json({ error: message }, { status });

/** The quote's time, as anything that shows its text as written reads it, which readers' apps show in their own time zone. */
const whenFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/** A path's segment, percent-decoded, or null when it can't be. */
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Where a message is, as its permalink, on the site `origin`: in its room, or in its thread. */
function permalinkOf({ roomId, id, parentId }: Message, origin: string): string {
  const path = parentId === undefined ? `/rooms/${encodeURIComponent(roomId)}/@${encodeURIComponent(id)}` : threadPath(roomId, parentId, id);
  return new URL(path, origin).href;
}

/**
 * What a forward of `original` from the site `origin` posts: `note`, if there is one, then a quote of
 * what `original` shows, without its link previews and with each mention as the bare name it had, as
 * Quote quotes one, citing its author, when they wrote it and linking to it (forward-quotes.ts).
 */
export function forwardMarkup(original: Message, note: string | undefined, origin: string, host: string): string {
  const citation = { author: original.creator.name, createdAt: original.createdAt, when: `${whenFormat.format(new Date(original.createdAt))} UTC`, link: permalinkOf(original, origin) };
  const nameOf = mentionedName(original);
  return (note === undefined ? "" : bodyFromPlainText(note)) + quoteMarkup(quotedNodes(original, host), citation, ({ userId }) => nameOf(userId));
}

/**
 * What Activity, search and pushes read of a forward of `original`: its note and whose message it forwards,
 * "See this — forwarded from Ada", or without a note, what it quotes, its text or its file's name. The
 * quote's time and link show only in the conversation, which shows the time in the reader's time zone.
 */
export function forwardPlainText(original: Message, note: string | undefined): string {
  return note === undefined ? quotedText(original) : `${note} — forwarded from ${original.creator.name}`;
}

/**
 * `POST /api/rooms/<room>/messages/<message>/forwards`, a `NewForward`: posts the message into the
 * conversation it names, as the forwarder's message quoting it, answering 201 with the message posted, or
 * 200 with the one a forward with the same id posted already, as a forward sent again whose answer was lost
 * finds it. It answers 404 unless they're in both conversations and the message is still there, and 422 for
 * a thread that isn't, or a note too long. The original's room records the forward first, so that deleting
 * the original takes what the forward quotes away, however this request ends.
 */
export async function forwardMessage(request: Request, env: Env, roomId: RoomId, messageSegment: string): Promise<Response> {
  const messageId = decoded(messageSegment);
  if (messageId === null) return problem(404, MESSAGE_NOT_FOUND);
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const from = await uploaderIn(env, credentials, roomId);
  if (from instanceof Response) return from;
  const forward = parseNewForward(await jsonBodyOf(request));
  if (typeof forward === "string") return problem(422, forward);
  const to = await uploaderIn(env, credentials, forward.to);
  if (to instanceof Response) return to;
  const destination = env.CHAT_ROOM.getByName(forward.to);
  const sent = await destination.sentAlready(forward.to, to, forward.clientMessageId);
  if (sent) return Response.json(sent, { status: 200 });
  const source = env.CHAT_ROOM.getByName(roomId);
  const found = await source.forwardable(roomId, from, messageId);
  if (!found) return problem(404, MESSAGE_NOT_FOUND);
  const { message } = found;
  const id = sortableId();
  if (!(await source.recordForward(roomId, from, messageId, forward.to, id))) return problem(404, MESSAGE_NOT_FOUND);

  let kept: KeptFile | undefined;
  if (message.attachment) {
    if (!env.FILES) return problem(503, NO_STORAGE);
    const copied = await copyFile(env.FILES, destination, forward.to, to, message, found.preview);
    if (copied instanceof Response) return copied;
    kept = copied;
  }
  const url = new URL(request.url);
  const markup = forwardMarkup(message, forward.note, url.origin, url.hostname);
  const plainText = forwardPlainText(message, forward.note);
  const posted = await destination.postForward(forward.to, to, { id, clientMessageId: forward.clientMessageId, markup, plainText, parentId: forward.parentId, kept });
  const postedHere = typeof posted === "object" && posted !== null && posted.id === id;
  // The copy of a file that isn't posted goes from R2 at once, as when a forward sent at the same time
  // posted first; the room's alarm forgets its upload.
  if (kept && !postedHere) await env.FILES!.delete([objectKey(kept.key), previewKey(kept.key)]);
  if (posted === null) return problem(404, MESSAGE_NOT_FOUND);
  if (typeof posted === "string") return problem(422, posted === MESSAGE_GONE ? "That thread no longer exists" : posted);
  return Response.json(posted, { status: postedHere ? 201 : 200 });
}

/**
 * Copies `message`'s file, and its preview of `preview`'s size, if it has one, to the room `roomId` for
 * `person`'s forward, as R2 keeps a bot's file as it arrives, answering the copy, or what the request
 * answers when the room turns them away, or R2 no longer has the file.
 */
async function copyFile(
  files: R2Bucket,
  room: DurableObjectStub<ChatRoom>,
  roomId: RoomId,
  person: Uploader,
  message: Message,
  preview: ImageSize | null,
): Promise<KeptFile | Response> {
  const file = message.attachment!;
  const original = await files.get(objectKey(file.id));
  if (!original) return problem(404, MESSAGE_NOT_FOUND);
  const started = await room.startForwardedFile(roomId, person, { filename: file.name, declaredType: file.contentType });
  if (!started) {
    await original.body.cancel();
    return problem(404, MESSAGE_NOT_FOUND);
  }
  const reader = original.body.getReader();
  const read = async () => {
    const { done, value } = await reader.read();
    return done ? null : value;
  };
  const stored = await storeArriving(files, objectKey(started.key), { filename: file.name, declaredType: file.contentType, limit: Infinity, read });
  const previewed = preview && (await files.get(previewKey(file.id)));
  if (previewed) await files.put(previewKey(started.key), await previewed.arrayBuffer(), { httpMetadata: previewed.httpMetadata });
  return { key: started.key, file: { ...stored!, ...(previewed && preview && { preview }) } };
}
