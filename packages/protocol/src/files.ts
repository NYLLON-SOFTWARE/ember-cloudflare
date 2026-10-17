import type { RoomId } from "./index.ts";
import { MAX_ID_LENGTH } from "./pages.ts";

// Files attached to messages, which Ember keeps in R2. ember-rust takes a file with the message that
// carries it, in one request, as Campfire's composer posts it (crates/assets/overrides/models/file_uploader.js),
// but a Worker takes at most 100 MB a request, so the app uploads a file in parts that R2 puts back
// together, and the room posts its message once it has all of them.

/** The largest file Ember takes, in decimal bytes: ember-rust's `MAX_UPLOAD_BYTES` (crates/kit/src/body.rs). */
export const MAX_FILE_SIZE = 250_000_000;

/** What ember-rust's uploader says of a larger file, and the Worker's 413 says too. */
export const FILE_TOO_LARGE = "Files must be 250 MB or smaller.";

/** The longest file name Ember keeps, in UTF-16 code units: as long as common file systems let a name be. */
export const MAX_FILE_NAME_LENGTH = 255;

/** The longest type a browser can give a file: RFC 6838's 127 characters a side and the slash between. */
const MAX_TYPE_LENGTH = 255;

/** Where a file for `roomId` starts uploading. */
export const uploadsPath = (roomId: RoomId) => `/api/rooms/${encodeURIComponent(roomId)}/uploads`;

/** Where part `n`, from 1, of upload `uploadId` in `roomId` goes. */
export const uploadPartPath = (roomId: RoomId, uploadId: string, n: number) => `${uploadsPath(roomId)}/${uploadId}/parts/${n}`;

/**
 * What the app sends to start uploading a file: its name, the type the browser gives it, which may be
 * empty, its size in bytes, and the id it gives the message the file becomes, as it gives each message
 * it sends one (`Message.clientMessageId`).
 */
export interface NewUpload {
  name: string;
  type: string;
  size: number;
  clientMessageId: string;
}

/**
 * An upload under way, as starting one answers it: the bytes each part but the last carries, the last
 * having the rest, and how many parts there are, at least one, even for an empty file.
 */
export interface Upload {
  id: string;
  partSize: number;
  parts: number;
}

/**
 * A file message's file, as Active Storage's blob describes it: its name as Active Storage keeps it
 * (`ActiveStorage::Filename#sanitized`), the type its bytes say it has, its size in bytes, and an image's
 * width and height, where they can be read, with the addresses that show it and download it. Neither
 * address expires, as ember-rust's signed blob links don't.
 */
export interface StoredFile {
  id: string;
  name: string;
  contentType: string;
  byteSize: number;
  width?: number;
  height?: number;
  url: string;
  downloadUrl: string;
}

/** A UTF-16 surrogate without its pair, which no file name can hold. */
const LONE_SURROGATE = /\p{Surrogate}/u;

/** Parses an untrusted `NewUpload`, or returns why it's refused: `FILE_TOO_LARGE` for a file too large. */
export function parseNewUpload(data: unknown): NewUpload | string {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "Expected a JSON object";
  const { name, type, size, clientMessageId } = data as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) return "A file needs a name";
  if (name.length > MAX_FILE_NAME_LENGTH || LONE_SURROGATE.test(name)) return "That file's name can't be kept";
  if (typeof type !== "string" || type.length > MAX_TYPE_LENGTH) return "A file's type must be text";
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return "A file's size must be a number of bytes";
  if (size > MAX_FILE_SIZE) return FILE_TOO_LARGE;
  if (typeof clientMessageId !== "string" || clientMessageId.length === 0 || clientMessageId.length > MAX_ID_LENGTH) return "A file needs an id for its message";
  return { name, type, size, clientMessageId };
}
