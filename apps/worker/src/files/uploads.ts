import { FILE_TOO_LARGE, parseNewUpload, type RoomId, type StoredFile, type Upload, type UserId } from "@ember/protocol";
import { credentialsOf } from "../auth";
import type { Env } from "../env";
import { addressTag, MAX_ADDRESS_LENGTH, sessionTag } from "../revocations";
import { workspace, type Credentials } from "../workspace";
import { fileUrls } from "./addresses";
import { objectKey, type Identified, type RoomBlob } from "./blobs";
import { sanitizedFilename } from "./filename";
import { imageSize } from "./images";
import { identify } from "./marcel";

// Uploading files to a room into R2, in parts, since a Worker takes at most 100 MB a request where
// ember-rust takes a file of up to 250 MB in one. The room keeps each upload (blobs.ts), and the first
// part says what the file is, as Active Storage identifies a blob, then analyzes it, once it has it all.
// R2 keeps the file with its type and name, so serving it (serving.ts) needs nothing else.

/** How much of a file each part but the last carries: more than R2's least, 5 MiB, and few enough parts for the largest file. */
export const UPLOAD_PART_SIZE = 10 * 1024 * 1024;

/** How many parts a file of `size` bytes goes in: at least one, for an empty file. */
export const uploadParts = (size: number) => Math.max(1, Math.ceil(size / UPLOAD_PART_SIZE));

/** How many bytes part `n`, from 1, of a file of `size` bytes carries. */
export const partLength = (size: number, n: number) => Math.min(UPLOAD_PART_SIZE, size - (n - 1) * UPLOAD_PART_SIZE);

/**
 * Active Storage's metadata for a file of type `contentType` whose first bytes are `bytes`, as it writes
 * it once it has identified and analyzed the file: an image's width and height, where they can be read.
 */
export const metadataOf = (bytes: Uint8Array, contentType: string) => JSON.stringify({ identified: true, ...imageSize(bytes, contentType), analyzed: true });

const NOT_SIGNED_IN = "Not signed in";
const ROOM_NOT_FOUND = "Room not found or inaccessible";
const UPLOAD_NOT_FOUND = "Upload not found";
const NO_STORAGE = "Ember isn't set up to store files";

const problem = (status: number, message: string) => Response.json({ error: message }, { status });

/** What a banned IP address's requests to change something answer, as the Worker's own check does. */
const tooManyRequests = () => new Response(null, { status: 429, headers: { "Content-Type": "text/html" } });

/** Someone uploading to a room, as the room checks them: the tags a revocation would name them by, and when the Workspace let them in. */
export interface Uploader {
  userId: UserId;
  tags: string[];
  authorizedAt: number;
}

/**
 * Who `credentials` signs in, if they may upload to room `roomId`, or what the request answers: 401
 * without a session, 404 when they aren't in the room, and 429 when a ban blocks their IP address.
 * The room tags them as it tags their sockets, so it turns them away as it would turn those away.
 */
async function uploaderIn(env: Env, credentials: Credentials, roomId: RoomId): Promise<Uploader | Response> {
  const access = await workspace(env).roomAccess(credentials, roomId);
  if (!access) return problem(401, NOT_SIGNED_IN);
  if (!access.member) return problem(404, ROOM_NOT_FOUND);
  if (access.banned) return tooManyRequests();
  const { ip } = credentials.client;
  const tags = [access.user.id, sessionTag(access.sessionId), ...(ip !== null && ip.length <= MAX_ADDRESS_LENGTH ? [addressTag(ip)] : [])];
  return { userId: access.user.id, tags, authorizedAt: access.authorizedAt };
}

/**
 * `POST /api/rooms/<room>/uploads`, a `NewUpload`: starts uploading a file to the room, answering 201
 * with where its parts go. As for other changes, who's asking and whether they're in the room are
 * checked before what they sent.
 */
export async function startUpload(request: Request, env: Env, roomId: RoomId): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  if (!env.FILES) return problem(503, NO_STORAGE);
  const uploader = await uploaderIn(env, credentials, roomId);
  if (uploader instanceof Response) return uploader;
  const file = parseNewUpload(await request.json().catch(() => null));
  if (typeof file === "string") return problem(file === FILE_TOO_LARGE ? 413 : 422, file);
  const key = await env.CHAT_ROOM.getByName(roomId).startUpload(roomId, uploader, file);
  if (!key) return problem(404, ROOM_NOT_FOUND);
  return Response.json({ id: key, partSize: UPLOAD_PART_SIZE, parts: uploadParts(file.size) } satisfies Upload, { status: 201 });
}

/**
 * `PUT /api/rooms/<room>/uploads/<key>/parts/<n>`, the part's bytes, which have to be as many as the
 * part carries: stores part `n` of one of the uploader's own uploads, answering 204 while there are
 * parts to come, then 201 with the file once R2 has all of it, or 200 with it for a part sent after
 * that. The first part comes first, since it says what the file is.
 */
export async function uploadPart(request: Request, env: Env, roomId: RoomId, key: string, n: number): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials) return problem(401, NOT_SIGNED_IN);
  const files = env.FILES;
  if (!files) return problem(503, NO_STORAGE);
  let uploader = await uploaderIn(env, credentials, roomId);
  if (uploader instanceof Response) return uploader;
  const room = env.CHAT_ROOM.getByName(roomId);
  const upload = await room.uploadOf(roomId, uploader.userId, key);
  if (!upload || n > uploadParts(upload.byteSize)) return problem(404, UPLOAD_NOT_FOUND);
  if (upload.completedAt) return Response.json(await storedFile(env, upload));

  const length = Number(request.headers.get("Content-Length") ?? NaN);
  if (!Number.isSafeInteger(length)) return problem(411, "A part needs its Content-Length");
  const expected = partLength(upload.byteSize, n);
  if (length < expected) return problem(400, `Part ${n} is ${expected} bytes`);
  if (length > expected) return problem(413, `Part ${n} is ${expected} bytes`);
  if (upload.metadata === null && n > 1) return problem(409, "The first part goes first");

  if (upload.metadata === null) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    // Again now the part has arrived, which can take as long as its sender likes: long enough for
    // their access to end, or for the Workspace's word to be too old for the room to take.
    uploader = await uploaderIn(env, credentials, roomId);
    if (uploader instanceof Response) return uploader;
    return storeFirstPart(env, files, roomId, uploader, upload, bytes);
  }

  // A part after the first, or the first again, once the first has started the upload.
  if (upload.multipartUploadId === null) return problem(409, "The first part goes first");
  const multipart = files.resumeMultipartUpload(objectKey(key), upload.multipartUploadId);
  const { partNumber, etag } = await multipart.uploadPart(n, request.body!);
  // Again, as for the first part.
  uploader = await uploaderIn(env, credentials, roomId);
  if (uploader instanceof Response) return uploader;
  const recorded = await room.recordUploadPart(roomId, uploader, key, { partNumber, etag });
  if (!recorded) return problem(404, UPLOAD_NOT_FOUND);
  if (recorded.completedAt) return Response.json(await storedFile(env, recorded), { status: 201 });
  if (recorded.parts.length < uploadParts(recorded.byteSize)) return new Response(null, { status: 204 });

  try {
    await multipart.complete(recorded.parts);
  } catch (error) {
    // A request that put the parts together but didn't live to record it leaves the file whole.
    if ((await files.head(objectKey(key)))?.size !== recorded.byteSize) throw error;
  }
  const completed = await room.completeUpload(roomId, key);
  return completed ? Response.json(await storedFile(env, completed), { status: 201 }) : problem(404, UPLOAD_NOT_FOUND);
}

/**
 * Stores the first part of `upload`, which says what the file is, as Active Storage identifies a blob
 * on upload and analyzes it after: its type, from its first bytes, the type the browser declared and its
 * name, and an image's size. A file in one part is then whole; a larger one starts its multipart upload.
 */
async function storeFirstPart(env: Env, files: R2Bucket, roomId: RoomId, uploader: Uploader, upload: RoomBlob, bytes: Uint8Array): Promise<Response> {
  const room = env.CHAT_ROOM.getByName(roomId);
  const contentType = identify(bytes, sanitizedFilename(upload.filename), upload.contentType);
  const identified: Identified = { contentType, metadata: metadataOf(bytes, contentType) };
  const options = { httpMetadata: { contentType }, customMetadata: { filename: upload.filename } };
  const key = objectKey(upload.id);

  if (uploadParts(upload.byteSize) === 1) {
    await files.put(key, bytes, options);
    const stored = await room.identifyUpload(roomId, uploader, upload.id, identified, { completedAt: new Date().toISOString() });
    return stored ? Response.json(await storedFile(env, stored), { status: 201 }) : problem(404, UPLOAD_NOT_FOUND);
  }
  const multipart = await files.createMultipartUpload(key, options);
  const { partNumber, etag } = await multipart.uploadPart(1, bytes);
  const started = await room.identifyUpload(roomId, uploader, upload.id, identified, { multipartUploadId: multipart.uploadId, part: { partNumber, etag } });
  if (started?.multipartUploadId === multipart.uploadId) return new Response(null, { status: 204 });
  // The room turned the uploader away, or another request sent the first part first.
  await multipart.abort();
  return started ? problem(409, "The first part is already uploading") : problem(404, UPLOAD_NOT_FOUND);
}

/**
 * The file `blob` is once R2 has all of it: its name as Active Storage keeps it, its type, size, and an
 * image's width and height, with the addresses that show it and download it.
 */
async function storedFile(env: Env, blob: RoomBlob): Promise<StoredFile> {
  const name = sanitizedFilename(blob.filename);
  const { width, height } = JSON.parse(blob.metadata!) as { width?: number; height?: number };
  return {
    id: blob.id,
    name,
    contentType: blob.contentType,
    byteSize: blob.byteSize,
    ...(width !== undefined && height !== undefined && { width, height }),
    ...(await fileUrls(env.SESSION_SECRET, blob.id, name)),
  };
}
