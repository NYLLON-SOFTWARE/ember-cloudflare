import { isPreviewed, type RoomId, type StoredFile, type UserId } from "@ember/protocol";
import { statement, type Db, type Statement } from "../db";
import { sanitizedFilename } from "./filename";
import type { ImageSize } from "./images";

// A room's files as its storage keeps them (migrations/0028_blobs.sql), in its Durable Object SQLite
// storage or in D1 (see db.ts), from when someone starts uploading one until R2 has all of it and the
// room has posted it as their message (migrations/0029_file_messages.sql).

/** Where R2 keeps the file whose key is `key`. */
export const objectKey = (key: string) => `files/${key}`;

/** Where R2 keeps the preview of the file whose key is `key`. */
export const previewKey = (key: string) => `previews/${key}`;

/** A part of a file that R2 holds, which putting the parts together names. */
export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/** A file uploaded to a room, as far as its upload has come. */
export interface RoomBlob {
  /** Its key, by which R2 keeps it too. */
  id: string;
  uploaderId: UserId;
  /** Its name, as it was given. */
  filename: string;
  /** The type the browser declared until the first part identifies it. */
  contentType: string;
  byteSize: number;
  /** Active Storage's metadata, as JSON, written once the first part has identified the file. */
  metadata: string | null;
  /** R2's upload of a file in more than one part, once the first part has started it. */
  multipartUploadId: string | null;
  /** The parts R2 has of a file in more than one part, in order. */
  parts: UploadedPart[];
  /** The id the app gave the file's message, or null for an upload started before files were messages. */
  clientMessageId: string | null;
  completedAt: string | null;
  /** The message the room posted the file as, once R2 has all of it. */
  messageId: string | null;
  /** Its preview's size, once its uploader has sent one (migrations/0030_file_previews.sql). */
  preview: ImageSize | null;
}

interface BlobRow {
  id: string;
  uploader_id: UserId;
  filename: string;
  content_type: string;
  byte_size: number;
  metadata: string | null;
  multipart_upload_id: string | null;
  parts: string;
  client_message_id: string | null;
  completed_at: string | null;
  message_id: string | null;
  preview: string | null;
}

const toBlob = (row: BlobRow): RoomBlob => ({
  id: row.id,
  uploaderId: row.uploader_id,
  filename: row.filename,
  contentType: row.content_type,
  byteSize: row.byte_size,
  metadata: row.metadata,
  multipartUploadId: row.multipart_upload_id,
  parts: JSON.parse(row.parts) as UploadedPart[],
  clientMessageId: row.client_message_id,
  completedAt: row.completed_at,
  messageId: row.message_id,
  preview: row.preview === null ? null : (JSON.parse(row.preview) as ImageSize),
});

/** What the first part of a file says of it: its type and Active Storage's metadata. */
export interface Identified {
  contentType: string;
  metadata: string;
}

/**
 * A file as its message keeps it (`messages.attachment`): as it shows, but for its addresses, which are
 * signed as it's read, and whether it has a preview to sign one for.
 */
export type AttachedFile = Omit<StoredFile, "url" | "downloadUrl" | "previewUrl"> & { preview?: true };

/**
 * What the message `blob` is posted as keeps of it, once its first part has identified it, as `identified`
 * says if it isn't recorded yet: with its preview, if it's a file shown by one, and that preview's size
 * where its own can't be read.
 */
export function attachedFile(blob: RoomBlob, identified?: Identified): AttachedFile {
  const { contentType, metadata } = identified ?? { contentType: blob.contentType, metadata: blob.metadata! };
  const { width, height } = JSON.parse(metadata) as Partial<ImageSize>;
  const preview = isPreviewed(contentType) ? blob.preview : null;
  const size = width !== undefined && height !== undefined ? { width, height } : preview;
  return {
    id: blob.id,
    name: sanitizedFilename(blob.filename),
    contentType,
    byteSize: blob.byteSize,
    ...(size && { width: size.width, height: size.height }),
    ...(preview && { preview: true as const }),
  };
}

export class Blobs {
  constructor(
    private readonly db: Db,
    readonly roomId: RoomId,
  ) {}

  /** Records that `blob`'s upload has started, at `createdAt`. */
  async create(blob: Pick<RoomBlob, "id" | "uploaderId" | "filename" | "contentType" | "byteSize" | "clientMessageId">, createdAt: string): Promise<void> {
    await this.db.run(
      `INSERT INTO blobs (id, room_id, uploader_id, filename, content_type, byte_size, client_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      blob.id,
      this.roomId,
      blob.uploaderId,
      blob.filename,
      blob.contentType,
      blob.byteSize,
      blob.clientMessageId,
      createdAt,
    );
  }

  async find(id: string): Promise<RoomBlob | null> {
    const [row] = await this.db.all<BlobRow>(`SELECT * FROM blobs WHERE room_id = ? AND id = ?`, this.roomId, id);
    return row ? toBlob(row) : null;
  }

  /**
   * Records what the first part of file `id`, in more than one part, identified it as, unless that's
   * recorded already, with the multipart upload and first part R2 has of it. Answers the file as it is
   * then, or null if it was identified already.
   */
  async identify(id: string, { contentType, metadata }: Identified, multipartUploadId: string, part: UploadedPart): Promise<RoomBlob | null> {
    const [row] = await this.db.all<BlobRow>(
      `UPDATE blobs SET content_type = ?, metadata = ?, multipart_upload_id = ?, parts = ?
        WHERE room_id = ? AND id = ? AND metadata IS NULL RETURNING *`,
      contentType,
      metadata,
      multipartUploadId,
      JSON.stringify([part]),
      this.roomId,
      id,
    );
    return row ? toBlob(row) : null;
  }

  /**
   * Records that `uploaderId`'s file `id` has a preview of `size`, in place of any it had, unless it's
   * posted already, answering the file as it is then, or null if they have no such file.
   */
  async recordPreview(id: string, uploaderId: UserId, size: ImageSize): Promise<RoomBlob | null> {
    const [row] = await this.db.all<BlobRow>(
      `UPDATE blobs SET preview = ? WHERE room_id = ? AND id = ? AND uploader_id = ? AND completed_at IS NULL RETURNING *`,
      JSON.stringify({ width: size.width, height: size.height }),
      this.roomId,
      id,
      uploaderId,
    );
    if (row) return toBlob(row);
    const blob = await this.find(id);
    return blob?.uploaderId === uploaderId ? blob : null;
  }

  /** Records `part` of file `id`, in place of any it had with its number, and answers the file as it is then. */
  async recordPart(blob: RoomBlob, part: UploadedPart): Promise<RoomBlob> {
    const parts = [...blob.parts.filter(({ partNumber }) => partNumber !== part.partNumber), part].sort((a, b) => a.partNumber - b.partNumber);
    await this.db.run(`UPDATE blobs SET parts = ? WHERE room_id = ? AND id = ?`, JSON.stringify(parts), this.roomId, blob.id);
    return { ...blob, parts };
  }

  /**
   * What records that R2 has all of file `id`, at `completedAt`, and that it's posted as message
   * `messageId`, for the batch that stores the message, with what its one part identified it as, for a
   * file in one part.
   */
  finished(id: string, messageId: string, completedAt: string, identified?: Identified): Statement {
    return identified
      ? statement(
          `UPDATE blobs SET content_type = ?, metadata = ?, completed_at = ?, message_id = ? WHERE room_id = ? AND id = ?`,
          identified.contentType,
          identified.metadata,
          completedAt,
          messageId,
          this.roomId,
          id,
        )
      : statement(`UPDATE blobs SET completed_at = ?, message_id = ? WHERE room_id = ? AND id = ?`, completedAt, messageId, this.roomId, id);
  }

  /** Forgets every file the room has, once it's deleted. */
  async deleteAll(): Promise<void> {
    await this.db.run(`DELETE FROM blobs WHERE room_id = ?`, this.roomId);
  }
}
