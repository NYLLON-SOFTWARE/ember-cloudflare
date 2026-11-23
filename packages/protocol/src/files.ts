import type { RoomId } from "./index.ts";
import { MAX_ID_LENGTH } from "./pages.ts";

// Files attached to messages, which Ember keeps in R2. Campfire takes a file with the message that
// carries it, in one request, as its composer posts it, but a Worker takes at most 100 MB a request, so
// the app uploads a file in parts that R2 puts back together, and the room posts its message once it has
// all of them.

/** The largest file Ember takes, in decimal bytes. */
export const MAX_FILE_SIZE = 250_000_000;

/** What the app's uploader says of a larger file, and the Worker's 413 says too. */
export const FILE_TOO_LARGE = "Files must be 250 MB or smaller.";

/** The longest file name Ember keeps, in UTF-16 code units: as long as common file systems let a name be. */
export const MAX_FILE_NAME_LENGTH = 255;

/** The longest type a browser can give a file: RFC 6838's 127 characters a side and the slash between. */
export const MAX_FILE_TYPE_LENGTH = 255;

/** Where a file for `roomId` starts uploading. */
export const uploadsPath = (roomId: RoomId) => `/api/rooms/${encodeURIComponent(roomId)}/uploads`;

/** Where part `n`, from 1, of upload `uploadId` in `roomId` goes. */
export const uploadPartPath = (roomId: RoomId, uploadId: string, n: number) => `${uploadsPath(roomId)}/${uploadId}/parts/${n}`;

/** Where the preview of upload `uploadId` in `roomId` goes, before its last part. */
export const uploadPreviewPath = (roomId: RoomId, uploadId: string) => `${uploadsPath(roomId)}/${uploadId}/preview`;

/**
 * The box a file's preview fits within: Campfire's `Message::Attachment::THUMBNAIL_MAX_WIDTH` and
 * `THUMBNAIL_MAX_HEIGHT`.
 */
export const PREVIEW_MAX_WIDTH = 1200;
export const PREVIEW_MAX_HEIGHT = 800;

/**
 * The most bytes a message shows of a file in its place: its preview, or a picture's own bytes where it
 * has none.
 */
export const MAX_PREVIEW_SIZE = 5 * 1024 * 1024;

/**
 * The pictures Campfire resizes, for a thumbnail or an avatar: Active Storage's `variable_content_types`,
 * less the BMP, ICO and PSD that its config/initializers/vips.rb takes out.
 */
const VARIABLE_TYPES = new Set(["image/png", "image/gif", "image/jpeg", "image/tiff", "image/webp", "image/avif", "image/heic", "image/heif"]);

/** Active Storage's `web_image_content_types`: the pictures every browser shows. */
const WEB_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Whether Campfire resizes a picture of `contentType`: `ActiveStorage::Blob#variable?`. */
export const isVariable = (contentType: string) => VARIABLE_TYPES.has(contentType);

/** Whether a message shows a file of `contentType` by its preview: a picture's thumbnail or a video's poster. */
export const isPreviewed = (contentType: string) => isVariable(contentType) || contentType.startsWith("video");

/** Whether every browser shows a picture of `contentType`. */
export const isWebImage = (contentType: string) => WEB_IMAGE_TYPES.has(contentType);

/** How many levels a sound's waveform has, from its start to its end. */
export const WAVEFORM_LENGTH = 100;

/** A waveform's loudest level: each is from 0, silence, to 100, as loud as the sound gets. */
export const WAVEFORM_LOUDEST = 100;

/** Why Ember refuses a waveform. */
export const WAVEFORM_REFUSED = "A waveform is 100 levels from 0 to 100";

/** Whether `levels` is a sound's waveform: `WAVEFORM_LENGTH` whole numbers from 0 to `WAVEFORM_LOUDEST`. */
export const isWaveform = (levels: unknown): levels is number[] =>
  Array.isArray(levels) && levels.length === WAVEFORM_LENGTH && levels.every((level) => Number.isInteger(level) && level >= 0 && level <= WAVEFORM_LOUDEST);

/** The longest a video's length can be, in seconds: a day. */
export const MAX_DURATION = 24 * 60 * 60;

/** Why Ember refuses a video's length. */
export const DURATION_REFUSED = "A video's length is a number of seconds, more than 0 and at most a day";

/** Whether `seconds` is how long a video plays: a number of seconds, more than 0 and at most `MAX_DURATION`. */
export const isDuration = (seconds: unknown): seconds is number => typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_DURATION;

/**
 * The most pixels a picture or video has for Ember to preview it or show it in its place, as a small
 * file can hold a picture far too large to decode: Campfire's
 * `Message::Attachment::THUMBNAIL_MAX_PIXELS`.
 */
export const MAX_PREVIEW_PIXELS = 250_000_000;

/**
 * Whether a picture or video of `width` by `height` pixels may be previewed: both known and above 0, and
 * at most 250 megapixels between them.
 */
export const isPreviewableSize = ({ width, height }: { width?: number; height?: number }) =>
  width !== undefined && height !== undefined && width > 0 && height > 0 && width * height <= MAX_PREVIEW_PIXELS;

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
  /** The message in whose thread the file is a reply, which `alsoSend` sends to the room too. */
  parentId?: string;
  alsoSend?: boolean;
  /** A sound's waveform, which the app works out from the file as it sends it, for the message's player to draw. */
  waveform?: number[];
  /** How long a video plays, in seconds, which the app reads from the file as it sends it, for the message's player to show. */
  duration?: number;
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
 * (`ActiveStorage::Filename#sanitized`), the type its bytes say it has, its size in bytes, and an
 * image's width and height, where they can be read, with the addresses that show it and download it.
 * Neither address expires.
 */
export interface StoredFile {
  id: string;
  name: string;
  contentType: string;
  byteSize: number;
  /** Where an image's can't be read, as a video's can't, its preview's, which has its shape. */
  width?: number;
  height?: number;
  url: string;
  downloadUrl: string;
  /**
   * The address of its preview, where its uploader's browser made one: a picture's thumbnail or a
   * video's poster within 1200×800, which its message shows.
   */
  previewUrl?: string;
  /**
   * A sound's waveform, where its uploader's browser could hear it: how loud it is along its length, as
   * `WAVEFORM_LENGTH` levels from 0 to 100, which its message's player draws.
   */
  waveform?: number[];
  /**
   * How long a video plays, in seconds, where its uploader's browser could read it, which its message's
   * player shows without loading the video.
   */
  duration?: number;
}

/** A UTF-16 surrogate without its pair, which no file name can hold. */
const LONE_SURROGATE = /\p{Surrogate}/u;

/** Why Ember keeps no file of a name: one longer than common file systems allow, or holding half a character. */
export const FILE_NAME_NOT_KEPT = "That file's name can't be kept";

/** Whether Ember can keep a file named `name`, once it has a name. */
export const isKeepableFileName = (name: string) => name.length <= MAX_FILE_NAME_LENGTH && !LONE_SURROGATE.test(name);

/** Parses an untrusted `NewUpload`, or returns why it's refused: `FILE_TOO_LARGE` for a file too large. */
export function parseNewUpload(data: unknown): NewUpload | string {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "Expected a JSON object";
  const { name, type, size, clientMessageId, parentId, alsoSend, waveform, duration } = data as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) return "A file needs a name";
  if (!isKeepableFileName(name)) return FILE_NAME_NOT_KEPT;
  if (typeof type !== "string" || type.length > MAX_FILE_TYPE_LENGTH) return "A file's type must be text";
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return "A file's size must be a number of bytes";
  if (size > MAX_FILE_SIZE) return FILE_TOO_LARGE;
  if (typeof clientMessageId !== "string" || clientMessageId.length === 0 || clientMessageId.length > MAX_ID_LENGTH) return "A file needs an id for its message";
  if (waveform !== undefined && !isWaveform(waveform)) return WAVEFORM_REFUSED;
  if (duration !== undefined && !isDuration(duration)) return DURATION_REFUSED;
  const measured = { ...(isWaveform(waveform) && { waveform }), ...(isDuration(duration) && { duration }) };
  if (parentId === undefined) return { name, type, size, clientMessageId, ...measured };
  if (typeof parentId !== "string" || parentId.length === 0 || parentId.length > MAX_ID_LENGTH) return "A reply's thread must be a message's id";
  return { name, type, size, clientMessageId, parentId, alsoSend: alsoSend === true, ...measured };
}
