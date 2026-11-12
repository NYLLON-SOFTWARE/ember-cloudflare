import { parseNewForward, threadPath, type Message, type RoomId } from "@ember/protocol";
import { bodyFromPlainText, displayBody, quoteMarkup, type DisplayNode } from "@ember/richtext";
import { credentialsOf } from "./auth";
import { jsonBodyOf } from "./bodies";
import { MESSAGE_GONE, type ChatRoom, type KeptFile } from "./chat-room";
import type { Env } from "./env";
import { objectKey, previewKey } from "./files/blobs";
import type { ImageSize } from "./files/images";
import { storeArriving } from "./files/streamed";
import { NO_STORAGE, uploaderIn, type Uploader } from "./files/uploads";

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

/** Whether there's text outside link previews, where a mention is the name it shows. */
const hasText = (nodes: DisplayNode[]): boolean =>
  nodes.some((node) => node.kind === "mention" || (node.kind === "text" ? node.value.trim() !== "" : node.kind === "element" && hasText(node.children)));

/**
 * What a forward of `original` from the site `origin` posts: `note`, if there is one, then a quote of
 * what `original` shows, without its link previews and with each mention as the bare name it had, as
 * Quote quotes one, citing its author, when they wrote it and linking to it. A message that shows no text,
 * only link previews or a bot's cards, is quoted by its plain text, and a file message by its file's
 * name, under which its file shows.
 */
export function forwardMarkup(original: Message, note: string | undefined, origin: string, host: string): string {
  const shown = original.attachment ? [] : displayBody(original.body, original.plainText, host);
  const quoted: DisplayNode[] = hasText(shown) ? shown : [{ kind: "element", name: "p", attrs: {}, children: [{ kind: "text", value: original.plainText }] }];
  const citation = { author: original.creator.name, createdAt: original.createdAt, when: `${whenFormat.format(new Date(original.createdAt))} UTC`, link: permalinkOf(original, origin) };
  const nameOf = (userId: string) => original.mentions.find((person) => person.id === userId)?.name ?? "☒";
  return (note === undefined ? "" : bodyFromPlainText(note)) + quoteMarkup(quoted, citation, ({ userId }) => nameOf(userId));
}

/**
 * `POST /api/rooms/<room>/messages/<message>/forwards`, a `NewForward`: posts the message into the
 * conversation it names, as the forwarder's message quoting it, answering 201 with the message posted. It
 * answers 404 unless they're in both conversations and the message is still there, and 422 for a thread
 * that isn't, or a forward the room won't keep, such as one too long.
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
  const found = await env.CHAT_ROOM.getByName(roomId).forwardable(roomId, from, messageId);
  if (!found) return problem(404, MESSAGE_NOT_FOUND);
  const { message } = found;

  const destination = env.CHAT_ROOM.getByName(forward.to);
  let kept: KeptFile | undefined;
  if (message.attachment) {
    if (!env.FILES) return problem(503, NO_STORAGE);
    const copied = await copyFile(env.FILES, destination, forward.to, to, message, found.preview);
    if (copied instanceof Response) return copied;
    kept = copied;
  }
  const url = new URL(request.url);
  const markup = forwardMarkup(message, forward.note, url.origin, url.hostname);
  const posted = await destination.postForward(forward.to, to, { clientMessageId: forward.clientMessageId, markup, parentId: forward.parentId, kept });
  if (typeof posted !== "object" || posted === null) {
    // The copy of a file that isn't posted goes from R2 at once; the room's alarm forgets its upload.
    if (kept) await env.FILES!.delete([objectKey(kept.key), previewKey(kept.key)]);
    if (posted === null) return problem(404, MESSAGE_NOT_FOUND);
    return problem(422, posted === MESSAGE_GONE ? "That thread no longer exists" : posted);
  }
  return Response.json(posted, { status: 201 });
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
