import { feature } from "@ember/parity";
import { CloseCode, FILE_TOO_LARGE, MAX_FILE_SIZE, uploadPartPath, type RoomId, type StoredFile, type Upload } from "@ember/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { fileUrls } from "../src/files/addresses";
import { UPLOAD_PART_SIZE } from "../src/files/uploads";
import { api, apiWith, createRoom, freshDeploy, freshRoom, recordedImage, roomSql, roomStub, sendPart, signIn, startUpload, upload, type Session } from "./support";

// Uploading files to a room in parts, which R2 keeps, and serving them from the addresses Ember signs, as
// ember-rust's Active Storage routes serve them (crates/ember/src/active_storage.rs, crates/storage/src/file_server.rs).

/** An Active Storage key. */
const KEY = /^[0-9a-z]{28}$/;

/** What the room keeps of upload `id`. */
const blobOf = async (room: RoomId, id: string) => ((await roomSql(room, "SELECT * FROM blobs WHERE id = ?", id)) as Array<Record<string, unknown>>)[0];

/** `length` bytes that start with `head` and go on counting, so any range of them is told apart. */
function fileOf(length: number, head: Uint8Array = new Uint8Array()): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = i % 251;
  bytes.set(head.subarray(0, length));
  return bytes;
}

/** `bytes`' SHA-256, as hex, to compare a large file by, since a failing comparison of its bytes would print them all. */
const digestOf = async (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Starts uploading `bytes` to `room` as `session`, named `name`, answering where its parts go. */
async function started(session: Session, room: RoomId, name: string, bytes: Uint8Array): Promise<Upload> {
  const response = await startUpload(session, room, { name, type: "", size: bytes.length });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as Upload;
}

/** The bytes of part `n` of `bytes`, uploading as `upload`. */
const partOf = (bytes: Uint8Array, { partSize }: Upload, n: number) => bytes.subarray((n - 1) * partSize, n * partSize);

/** `response`'s error. */
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error;

/** GETs `path`, a file's address, without a session, as anyone who has it can. */
const fetchFile = (path: string, headers: Record<string, string> = {}, method = "GET") => api(path, { method, headers });

beforeEach(freshDeploy);
afterEach(() => vi.restoreAllMocks());

describe(feature("attachments.types"), () => {
  it("uploads a file in one part, naming its type from its bytes and recording an image's size", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const moon = recordedImage("moon-thumb.jpg");

    const file = await upload(ada, room, "moon.jpg", moon);
    expect(file).toEqual({
      id: expect.stringMatching(KEY),
      name: "moon.jpg",
      contentType: "image/jpeg",
      byteSize: moon.length,
      width: 640,
      height: 640,
      url: expect.stringMatching(new RegExp(`^/files/${file.id}/[\\w-]{22}/moon\\.jpg$`)),
      downloadUrl: `${file.url}?disposition=attachment`,
    });
    expect(await blobOf(room, file.id)).toMatchObject({
      room_id: room,
      uploader_id: ada.user.id,
      filename: "moon.jpg",
      content_type: "image/jpeg",
      byte_size: moon.length,
      metadata: '{"identified":true,"width":640,"height":640,"analyzed":true}',
      multipart_upload_id: null,
      parts: "[]",
      completed_at: expect.any(String),
    });
    expect(new Uint8Array(await (await fetchFile(file.url)).arrayBuffer())).toEqual(moon);
  });

  it("uploads a larger file in parts, which can come in any order after the first, and puts them back together", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const earth = fileOf(2 * UPLOAD_PART_SIZE + 1_000, recordedImage("earth-thumb.png"));
    const upload = await started(ada, room, "earth.png", earth);
    expect(upload).toEqual({ id: expect.stringMatching(KEY), partSize: UPLOAD_PART_SIZE, parts: 3 });

    expect((await sendPart(ada, room, upload.id, 1, partOf(earth, upload, 1))).status).toBe(204);
    expect((await sendPart(ada, room, upload.id, 3, partOf(earth, upload, 3))).status).toBe(204);
    // A part sent again replaces the one R2 had.
    expect((await sendPart(ada, room, upload.id, 3, partOf(earth, upload, 3))).status).toBe(204);
    const last = await sendPart(ada, room, upload.id, 2, partOf(earth, upload, 2));
    expect(last.status).toBe(201);
    const file = (await last.json()) as StoredFile;
    expect(file).toMatchObject({ id: upload.id, name: "earth.png", contentType: "image/png", byteSize: earth.length, width: 640, height: 800 });
    expect(await digestOf(await (await fetchFile(file.url)).arrayBuffer())).toBe(await digestOf(earth));

    const blob = await blobOf(room, upload.id);
    expect(blob).toMatchObject({ multipart_upload_id: expect.any(String), completed_at: expect.any(String) });
    expect(JSON.parse(blob!.parts as string)).toEqual([1, 2, 3].map((partNumber) => ({ partNumber, etag: expect.any(String) })));
    // Once it's whole, a part sent again changes nothing, and answers the file.
    const again = await sendPart(ada, room, upload.id, 1, partOf(earth, upload, 1));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(file);
  });

  it("takes a file's type from its bytes over the type the browser declares and its name, as Marcel does", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const page = new TextEncoder().encode("<!DOCTYPE html><html></html>");
    expect(await upload(ada, room, "page.txt", page, "text/plain")).toMatchObject({ contentType: "text/html" });
    // Bytes that say nothing leave it to the declared type, then the name.
    const notes = new TextEncoder().encode("hello world");
    expect(await upload(ada, room, "notes.txt", notes, "text/plain")).toMatchObject({ contentType: "text/plain" });
    expect(await upload(ada, room, "notes.csv", notes)).toMatchObject({ contentType: "text/csv" });
    expect(await upload(ada, room, "notes", notes)).toMatchObject({ contentType: "application/octet-stream" });
    // An empty file, in one part.
    const empty = await startUpload(ada, room, { name: ".keep", type: "", size: 0 });
    expect(await empty.json()).toMatchObject({ parts: 1 });
    expect(await upload(ada, room, ".keep", new Uint8Array())).toMatchObject({ name: ".keep", contentType: "application/octet-stream", byteSize: 0 });
  });

  it("keeps the first part that arrives when two do, and lets the other's upload go", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const key = (await started(ada, room, "earth.png", fileOf(UPLOAD_PART_SIZE + 1))).id;
    const uploader = { userId: ada.user.id, tags: [ada.user.id], authorizedAt: Date.now() };
    const identified = { contentType: "image/png", metadata: '{"identified":true,"analyzed":true}' };
    const first = await roomStub(room).identifyUpload(room, uploader, key, identified, { multipartUploadId: "first", part: { partNumber: 1, etag: "a" } });
    expect(first).toMatchObject({ multipartUploadId: "first", parts: [{ partNumber: 1, etag: "a" }] });
    const second = await roomStub(room).identifyUpload(room, uploader, key, { ...identified, contentType: "text/plain" }, { multipartUploadId: "second", part: { partNumber: 1, etag: "b" } });
    expect(second).toEqual(first);
  });
});

describe(feature("attachments.serving"), () => {
  it("serves a file to anyone with its address, inline or as a download, for an hour of caching, without Campfire's version", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const moon = recordedImage("moon-thumb.jpg");
    const file = await upload(ada, room, "moon.jpg", moon);

    const shown = await fetchFile(file.url);
    expect(shown.status).toBe(200);
    expect(Object.fromEntries(shown.headers)).toMatchObject({
      "content-type": "image/jpeg",
      "content-disposition": `inline; filename="moon.jpg"; filename*=UTF-8''moon.jpg`,
      "content-length": String(moon.length),
      "cache-control": "max-age=3600, public",
      "last-modified": expect.stringMatching(/ GMT$/),
      "x-content-type-options": "nosniff",
    });
    expect(shown.headers.has("X-Version")).toBe(false);
    expect(new Uint8Array(await shown.arrayBuffer())).toEqual(moon);

    const downloaded = await fetchFile(file.downloadUrl);
    expect(downloaded.headers.get("Content-Disposition")).toBe(`attachment; filename="moon.jpg"; filename*=UTF-8''moon.jpg`);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(moon);
    // The last disposition asked for, as Rack reads a query.
    expect((await fetchFile(`${file.downloadUrl}&disposition=inline`)).headers.get("Content-Disposition")).toMatch(/^inline;/);

    const head = await fetchFile(file.url, {}, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Length")).toBe(String(moon.length));
    expect(head.headers.get("Last-Modified")).toBe(shown.headers.get("Last-Modified"));
    expect((await head.arrayBuffer()).byteLength).toBe(0);
  });

  it("names a file as Active Storage sanitizes its name, whatever its address says", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const report = await upload(ada, room, " report: Q3/Q4‮.pdf ", new TextEncoder().encode("%PDF-1.7\n"));
    expect(report).toMatchObject({ name: "report- Q3-Q4-.pdf", contentType: "application/pdf" });
    expect(report.url).toMatch(/\/report-%20Q3-Q4-\.pdf$/);
    const served = await fetchFile(report.url.replace(/[^/]+$/, "anything-else.exe"));
    expect(served.headers.get("Content-Type")).toBe("application/pdf");
    expect(served.headers.get("Content-Disposition")).toBe(`inline; filename="report- Q3-Q4-.pdf"; filename*=UTF-8''report-%20Q3-Q4-.pdf`);
  });

  it("serves only images and PDFs inline, and types a page could run as binary data", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const svg = await upload(ada, room, "drawing.svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "image/svg+xml");
    const page = await upload(ada, room, "page.html", new TextEncoder().encode("<!DOCTYPE html><html></html>"));
    const notes = await upload(ada, room, "notes.txt", new TextEncoder().encode("hello world"), "text/plain");
    expect([svg.contentType, page.contentType, notes.contentType]).toEqual(["image/svg+xml", "text/html", "text/plain"]);
    for (const [file, type] of [[svg, "application/octet-stream"], [page, "application/octet-stream"], [notes, "text/plain"]] as const) {
      const served = await fetchFile(file.url);
      expect(served.headers.get("Content-Type"), file.name).toBe(type);
      expect(served.headers.get("Content-Disposition"), file.name).toMatch(/^attachment;/);
    }
  });

  it("serves the byte ranges asked for, one as it is and several as multipart/byteranges", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const moon = recordedImage("moon-thumb.jpg");
    const file = await upload(ada, room, "moon.jpg", moon);

    const first = await fetchFile(file.url, { Range: "bytes=0-9" });
    expect(first.status).toBe(206);
    expect(first.headers.get("Content-Range")).toBe(`bytes 0-9/${moon.length}`);
    expect(first.headers.get("Content-Length")).toBe("10");
    expect(first.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(moon.subarray(0, 10));
    const end = await fetchFile(file.url, { Range: "bytes=-5" });
    expect(end.headers.get("Content-Range")).toBe(`bytes ${moon.length - 5}-${moon.length - 1}/${moon.length}`);
    expect(new Uint8Array(await end.arrayBuffer())).toEqual(moon.subarray(-5));

    const several = await fetchFile(file.url, { Range: "bytes=0-1, 10-12" });
    expect(several.status).toBe(206);
    const boundary = several.headers.get("Content-Type")!.match(/^multipart\/byteranges; boundary=([0-9a-f]{32})$/)![1];
    const part = (start: number, end: number) =>
      `\r\n--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Range: bytes ${start}-${end}/${moon.length}\r\n\r\n${String.fromCharCode(...moon.subarray(start, end + 1))}`;
    const body = `${part(0, 1)}${part(10, 12)}\r\n--${boundary}--\r\n`;
    const sent = new Uint8Array(await several.arrayBuffer());
    expect(String.fromCharCode(...sent)).toBe(body);
    expect(several.headers.get("Content-Length")).toBe(String(sent.length));

    const head = await fetchFile(file.url, { Range: "bytes=0-9" }, "HEAD");
    expect(head.status).toBe(206);
    expect(head.headers.get("Content-Range")).toBe(`bytes 0-9/${moon.length}`);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
  });

  it("answers 416 for ranges the file doesn't have, and sends the whole file for a header Rack can't read or too many ranges", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const moon = recordedImage("moon-thumb.jpg");
    const file = await upload(ada, room, "moon.jpg", moon);

    const unsatisfiable = await fetchFile(file.url, { Range: `bytes=${moon.length}-` });
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get("Content-Range")).toBe(`bytes */${moon.length}`);
    expect(unsatisfiable.headers.get("Content-Type")).toBe("image/jpeg");
    expect(unsatisfiable.headers.has("Last-Modified")).toBe(false);
    expect(await unsatisfiable.text()).toBe("Byte range unsatisfiable\n");

    for (const range of ["items=0-1", "bytes=5-1", `bytes=${"0-0,".repeat(49)}1-1`]) {
      const whole = await fetchFile(file.url, { Range: range });
      expect(whole.status, range).toBe(200);
      expect((await whole.arrayBuffer()).byteLength, range).toBe(moon.length);
    }
    // As many as Rack would send one by one, here still within a request's calls to R2.
    expect((await fetchFile(file.url, { Range: `bytes=${"0-0,".repeat(48)}1-1` })).status).toBe(206);
  });

  it("answers 304 to a browser whose copy is as new, and the file to one whose copy is older", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const file = await upload(ada, room, "moon.jpg", recordedImage("moon-thumb.jpg"));
    const lastModified = (await fetchFile(file.url)).headers.get("Last-Modified")!;

    // The very time, as Rack::Files checks it.
    const same = await fetchFile(file.url, { "If-Modified-Since": lastModified });
    expect(same.status).toBe(304);
    expect(same.headers.get("Content-Type")).toBe("image/jpeg");
    expect(same.headers.get("Cache-Control")).toBe("max-age=3600, public");
    expect(same.headers.has("Last-Modified")).toBe(false);
    // Any later time, as Rack::ConditionalGet checks it, unless the browser names a version too.
    const later = new Date(Date.parse(lastModified) + 60_000).toUTCString();
    const newer = await fetchFile(file.url, { "If-Modified-Since": later });
    expect(newer.status).toBe(304);
    expect(newer.headers.has("Content-Type")).toBe(false);
    expect((await fetchFile(file.url, { "If-Modified-Since": later, "If-None-Match": '"v1"' })).status).toBe(200);
    const earlier = new Date(Date.parse(lastModified) - 60_000).toUTCString();
    expect((await fetchFile(file.url, { "If-Modified-Since": earlier })).status).toBe(200);
  });

  it("answers an empty 404 for an address Ember didn't make or a file it doesn't have, and Campfire's 404 page to anything but a read", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const file = await upload(ada, room, "moon.jpg", recordedImage("moon-thumb.jpg"));
    const [, , key, signature] = file.url.split("/") as [string, string, string, string];
    const tampered = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    const other = await fileUrls("test-secret", "0".repeat(28), "moon.jpg");
    for (const path of [
      `/files/${key}/${tampered}/moon.jpg`,
      `/files/${key}/${signature}x/moon.jpg`,
      `/files/${key.toUpperCase()}/${signature}/moon.jpg`,
      `/files/${"0".repeat(28)}/${signature}/moon.jpg`,
      other.url,
    ]) {
      const response = await fetchFile(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("Content-Type"), path).toBe("text/html");
      expect(await response.text(), path).toBe("");
    }
    // Another Worker's addresses, signed with another secret.
    expect((await apiWith({ SESSION_SECRET: "another-secret" }, file.url)).status).toBe(404);
    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = await api(file.url, { method, headers: { Cookie: ada.cookie } });
      expect(response.status, method).toBe(404);
      expect(await response.text(), method).toContain("<html");
    }
  });
});

describe(feature("attachments.size-limit"), () => {
  it("refuses a file over 250 MB before any of it arrives, and takes one of exactly 250 MB in 24 parts", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const tooLarge = await startUpload(ada, room, { name: "earth.png", type: "image/png", size: MAX_FILE_SIZE + 1 });
    expect(tooLarge.status).toBe(413);
    expect(await errorOf(tooLarge)).toBe(FILE_TOO_LARGE);
    const largest = await startUpload(ada, room, { name: "earth.png", type: "image/png", size: MAX_FILE_SIZE });
    expect(largest.status).toBe(201);
    const { id, ...parts } = (await largest.json()) as Upload;
    expect(parts).toEqual({ partSize: UPLOAD_PART_SIZE, parts: 24 });
    // The room keeps only the file it took.
    expect(await roomSql(room, "SELECT id FROM blobs")).toEqual([{ id }]);
  });

  it("takes each part only at its length, the first before the others", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const earth = fileOf(UPLOAD_PART_SIZE + 10);
    const upload = await started(ada, room, "earth.png", earth);

    const short = await sendPart(ada, room, upload.id, 1, earth.subarray(0, 100));
    expect(short.status).toBe(400);
    expect(await errorOf(short)).toBe(`Part 1 is ${UPLOAD_PART_SIZE} bytes`);
    const long = await sendPart(ada, room, upload.id, 2, earth.subarray(UPLOAD_PART_SIZE - 1));
    expect(long.status).toBe(413);
    expect(await errorOf(long)).toBe("Part 2 is 10 bytes");
    const early = await sendPart(ada, room, upload.id, 2, partOf(earth, upload, 2));
    expect(early.status).toBe(409);
    expect(await errorOf(early)).toBe("The first part goes first");
    const streamed = new ReadableStream({
      start(controller) {
        controller.enqueue(partOf(earth, upload, 2));
        controller.close();
      },
    });
    const unmeasured = await api(uploadPartPath(room, upload.id, 2), { method: "PUT", headers: { Cookie: ada.cookie }, body: streamed });
    expect(unmeasured.status).toBe(411);
    // Parts the file doesn't have.
    expect((await sendPart(ada, room, upload.id, 3, earth.subarray(0, 1))).status).toBe(404);
    expect((await sendPart(ada, room, upload.id, 0, earth.subarray(0, 1))).status).toBe(404);

    expect((await sendPart(ada, room, upload.id, 1, partOf(earth, upload, 1))).status).toBe(204);
    expect((await sendPart(ada, room, upload.id, 2, partOf(earth, upload, 2))).status).toBe(201);
  });
});

describe(feature("rooms.member-only-access"), () => {
  it("lets only the room's members upload to it, each to their own uploads, once signed in", async () => {
    const [ada, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const design = await createRoom("design", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const file = { name: "moon.jpg", type: "", size: 1 };

    const outsider = await startUpload(linus, design.id, file);
    expect(outsider.status).toBe(404);
    expect(await errorOf(outsider)).toBe("Room not found or inaccessible");
    expect((await api(`/api/rooms/${design.id}/uploads`, { method: "POST", body: JSON.stringify(file) })).status).toBe(401);
    expect((await startUpload(ada, "nowhere" as RoomId, file)).status).toBe(404);
    expect((await startUpload(ada, "no%20room" as RoomId, file)).status).toBe(404);

    const upload = await started(ada, design.id, "moon.jpg", new Uint8Array(1));
    const notTheirs = await sendPart(grace, design.id, upload.id, 1, new Uint8Array(1));
    expect(notTheirs.status).toBe(404);
    expect(await errorOf(notTheirs)).toBe("Upload not found");
    expect((await sendPart(linus, design.id, upload.id, 1, new Uint8Array(1))).status).toBe(404);
    expect((await api(uploadPartPath(design.id, upload.id, 1), { method: "PUT", body: new Uint8Array(1) })).status).toBe(401);
    expect(await blobOf(design.id, upload.id)).toMatchObject({ metadata: null, completed_at: null });
  });

  it("stops an upload once its uploader leaves the room, and refuses uploads to a deleted room", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const design = await createRoom("design", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const earth = fileOf(UPLOAD_PART_SIZE + 10);
    const upload = await started(grace, design.id, "earth.png", earth);
    expect((await sendPart(grace, design.id, upload.id, 1, partOf(earth, upload, 1))).status).toBe(204);

    const change = await api(`/api/rooms/${design.id}`, { method: "PATCH", headers: { Cookie: ada.cookie }, body: JSON.stringify({ kind: "closed", memberIds: [ada.user.id] }) });
    expect(change.status).toBe(200);
    const after = await sendPart(grace, design.id, upload.id, 2, partOf(earth, upload, 2));
    expect(after.status).toBe(404);
    expect(await errorOf(after)).toBe("Room not found or inaccessible");
    expect(await blobOf(design.id, upload.id)).toMatchObject({ completed_at: null });

    expect((await api(`/api/rooms/${design.id}`, { method: "DELETE", headers: { Cookie: ada.cookie } })).status).toBe(204);
    expect((await startUpload(ada, design.id, { name: "moon.jpg", type: "", size: 1 })).status).toBe(404);
  });

  it("refuses an upload once the room hears the uploader's access ended after the Workspace let them in", async () => {
    const grace = await signIn("Grace");
    const room = await freshRoom("lobby");
    const file = { name: "moon.jpg", type: "", size: 1 };
    const authorizedAt = Date.now();
    const uploader = (at: number) => ({ userId: grace.user.id, tags: [grace.user.id], authorizedAt: at });
    await roomStub(room).revoke(room, [{ tag: grace.user.id, code: CloseCode.NotFound }], authorizedAt);

    expect(await roomStub(room).startUpload(room, uploader(authorizedAt), file)).toBeNull();
    const key = (await roomStub(room).startUpload(room, uploader(authorizedAt + 1), file))!;
    expect(key).toMatch(KEY);
    const identified = { contentType: "image/jpeg", metadata: '{"identified":true,"analyzed":true}' };
    expect(await roomStub(room).identifyUpload(room, uploader(authorizedAt), key, identified, { completedAt: new Date().toISOString() })).toBeNull();
    expect(await roomStub(room).recordUploadPart(room, uploader(authorizedAt), key, { partNumber: 2, etag: "a" })).toBeNull();
    expect(await blobOf(room, key)).toMatchObject({ metadata: null, completed_at: null });
  });
});

describe(feature("platform.health"), () => {
  it("answers 503 to an upload, and 404 at a file's address, when no bucket is bound", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("lobby");
    const file = await upload(ada, room, "moon.jpg", recordedImage("moon-thumb.jpg"));
    const unbound = { FILES: undefined } satisfies Partial<Env>;

    const response = await apiWith(unbound, `/api/rooms/${room}/uploads`, { method: "POST", headers: { Cookie: ada.cookie }, body: JSON.stringify({ name: "moon.jpg", type: "", size: 1 }) });
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe("Ember isn't set up to store files");
    expect((await apiWith(unbound, file.url)).status).toBe(404);
  });
});
