import { FILE_TOO_LARGE, MAX_FILE_SIZE, uploadPartPath, uploadsPath, type Message, type RoomId, type Upload } from "@ember/protocol";

// Uploading a file as a message of its own, as ember-rust's FileUploader does
// (crates/assets/overrides/models/file_uploader.js), but in parts that R2 puts back together, since a
// Worker takes at most 100 MB a request: the app starts the upload, sends its parts one after another,
// and the room posts the file as a message once it has the last.

/** What a failed upload says, as ember-rust's uploader rejects with, unless the file is too large. */
export const UPLOAD_FAILED = "Upload failed. Please attach the file and try again.";

/** What an upload says when the connection drops. */
export const CONNECTION_LOST = "Connection lost. Please attach the file and try again.";

/** Why the composer leaves out a file picked to send, as ember-rust's does, before any of it goes. */
export const tooLargeToAttach = (name: string) => `${name} is too large. Choose a file that’s 250 MB or smaller.`;

/** Why an upload failed, as its card says it. */
export class UploadError extends Error {}

/** Why an answer with `status` failed an upload: as ember-rust's uploader reads a 413, and any other. */
const refused = (status: number) => new UploadError(status === 413 ? FILE_TOO_LARGE : UPLOAD_FAILED);

/** How much of `total` bytes `sent` is, as a percentage rounded down, as ember-rust's uploader counts. */
const percentOf = (sent: number, total: number) => (total === 0 ? 100 : Math.min(100, Math.floor((sent / total) * 100)));

/** The message the part that finished an upload answers with, or an UploadError for anything else, such as a sign-in page. */
function messageIn(text: string): Message {
  try {
    const message = JSON.parse(text) as Message;
    if (typeof message?.id === "string") return message;
  } catch {
    // Not the message, then.
  }
  throw new UploadError(UPLOAD_FAILED);
}

/**
 * Sends `part` to `path` with an XMLHttpRequest, whose upload reports its progress, as fetch's can't,
 * telling `onSent` how many of its bytes have gone, and answers the response's status and text.
 */
function sendPart(path: string, part: Blob, onSent: (bytes: number) => void): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", path);
    request.upload.addEventListener("progress", (event) => event.lengthComputable && onSent(event.loaded));
    request.addEventListener("load", () => resolve({ status: request.status, text: request.responseText }));
    request.addEventListener("error", () => reject(new UploadError(CONNECTION_LOST)));
    request.send(part);
  });
}

/**
 * Uploads `file` to `roomId` as the message `clientMessageId` names, telling `onProgress` how much of it
 * has gone, as a percentage rounded down, each time that changes, and answers the message the room posts
 * it as. It fails with an UploadError saying why, as the file's card says it.
 */
export async function uploadFile(roomId: RoomId, file: File, clientMessageId: string, onProgress: (percent: number) => void): Promise<Message> {
  if (file.size > MAX_FILE_SIZE) throw new UploadError(FILE_TOO_LARGE);
  const started = await fetch(uploadsPath(roomId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, type: file.type, size: file.size, clientMessageId }),
  }).catch(() => {
    throw new UploadError(CONNECTION_LOST);
  });
  if (started.status !== 201) throw refused(started.status);
  const { id, partSize, parts } = (await started.json()) as Upload;

  let shown = 0;
  const progress = (sent: number) => {
    const percent = percentOf(sent, file.size);
    if (percent !== shown) onProgress((shown = percent));
  };
  for (let n = 1; n < parts; n++) {
    const start = (n - 1) * partSize;
    const { status } = await sendPart(uploadPartPath(roomId, id, n), file.slice(start, start + partSize), (bytes) => progress(start + bytes));
    if (status !== 204) throw refused(status);
  }
  const start = (parts - 1) * partSize;
  const { status, text } = await sendPart(uploadPartPath(roomId, id, parts), file.slice(start), (bytes) => progress(start + bytes));
  if (status !== 201 && status !== 200) throw refused(status);
  progress(file.size);
  return messageIn(text);
}
