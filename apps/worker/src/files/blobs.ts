import type { RoomId, UserId } from "@ember/protocol";
import type { Db } from "../db";

// A room's files as its storage keeps them (migrations/0028_blobs.sql), in its Durable Object SQLite
// storage or in D1 (see db.ts), from when someone starts uploading one until R2 has all of it.

/** Where R2 keeps the file whose key is `key`. */
export const objectKey = (key: string) => `files/${key}`;

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
  completedAt: string | null;
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
  completed_at: string | null;
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
  completedAt: row.completed_at,
});

/** What the first part of a file says of it: its type and Active Storage's metadata. */
export interface Identified {
  contentType: string;
  metadata: string;
}

export class Blobs {
  constructor(
    private readonly db: Db,
    readonly roomId: RoomId,
  ) {}

  /** Records that `blob`'s upload has started, at `createdAt`. */
  async create(blob: Pick<RoomBlob, "id" | "uploaderId" | "filename" | "contentType" | "byteSize">, createdAt: string): Promise<void> {
    await this.db.run(
      `INSERT INTO blobs (id, room_id, uploader_id, filename, content_type, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      blob.id,
      this.roomId,
      blob.uploaderId,
      blob.filename,
      blob.contentType,
      blob.byteSize,
      createdAt,
    );
  }

  async find(id: string): Promise<RoomBlob | null> {
    const [row] = await this.db.all<BlobRow>(`SELECT * FROM blobs WHERE room_id = ? AND id = ?`, this.roomId, id);
    return row ? toBlob(row) : null;
  }

  /**
   * Records what the first part of file `id` identified it as, unless that's recorded already, with the
   * multipart upload and first part R2 has of it, or for a file in one part, that it has all of it, at
   * `completedAt`. Answers the file as it is then, or null if it was identified already.
   */
  async identify(id: string, { contentType, metadata }: Identified, upload: { multipartUploadId: string; part: UploadedPart } | { completedAt: string }): Promise<RoomBlob | null> {
    const [row] = await this.db.all<BlobRow>(
      `UPDATE blobs SET content_type = ?, metadata = ?, multipart_upload_id = ?, parts = ?, completed_at = ?
        WHERE room_id = ? AND id = ? AND metadata IS NULL RETURNING *`,
      contentType,
      metadata,
      "multipartUploadId" in upload ? upload.multipartUploadId : null,
      JSON.stringify("part" in upload ? [upload.part] : []),
      "completedAt" in upload ? upload.completedAt : null,
      this.roomId,
      id,
    );
    return row ? toBlob(row) : null;
  }

  /** Records `part` of file `id`, in place of any it had with its number, and answers the file as it is then. */
  async recordPart(blob: RoomBlob, part: UploadedPart): Promise<RoomBlob> {
    const parts = [...blob.parts.filter(({ partNumber }) => partNumber !== part.partNumber), part].sort((a, b) => a.partNumber - b.partNumber);
    await this.db.run(`UPDATE blobs SET parts = ? WHERE room_id = ? AND id = ?`, JSON.stringify(parts), this.roomId, blob.id);
    return { ...blob, parts };
  }

  /** Records that R2 has put file `id` together, at `completedAt`, unless it had already, and answers the file. */
  async complete(id: string, completedAt: string): Promise<RoomBlob | null> {
    const [row] = await this.db.all<BlobRow>(
      `UPDATE blobs SET completed_at = coalesce(completed_at, ?) WHERE room_id = ? AND id = ? RETURNING *`,
      completedAt,
      this.roomId,
      id,
    );
    return row ? toBlob(row) : null;
  }

  /** Forgets every file the room has, once it's deleted. */
  async deleteAll(): Promise<void> {
    await this.db.run(`DELETE FROM blobs WHERE room_id = ?`, this.roomId);
  }
}
