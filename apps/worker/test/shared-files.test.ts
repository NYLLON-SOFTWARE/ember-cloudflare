import { sharedFilesPath, uploadPreviewPath, type RoomId, type Upload } from "@ember/protocol";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { objectKey, previewKey } from "../src/files/blobs";
import { api, connect, createRoom, recordedImage, sendPart, signIn, startUpload, upload, type FileMessage, type Session } from "./support";

// Sharing a file posted in one room in another, as the composer's Files in Ember does: R2 copies it for the
// room it's shared in, which posts it as the sharer's message, with the card an upload gets.

const files = () => (env as unknown as Env).FILES!;

/** Shares file `fileId`, posted in `from`, in `room` as `session`, answering how the Worker answered. */
const share = (session: Session, room: RoomId, shared: Record<string, unknown>) =>
  api(sharedFilesPath(room), { method: "POST", headers: { Cookie: session.cookie }, body: JSON.stringify({ clientMessageId: crypto.randomUUID(), ...shared }) });

/** Shares as `share` does, expecting the message the room posts. */
async function shared(session: Session, room: RoomId, from: RoomId, fileId: string, more: Record<string, unknown> = {}): Promise<FileMessage> {
  const response = await share(session, room, { roomId: from, fileId, ...more });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as FileMessage;
}

/** The bytes served at a file's address `path`. */
const served = async (path: string) => new Uint8Array(await (await api(path)).arrayBuffer());

const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error;

describe("Files in Ember", () => {
  it("posts a file shared from another room as the sharer's message, with a copy of the file and its preview for this room", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const design = await createRoom("design", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const launch = await createRoom("launch", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const moon = recordedImage("moon-thumb.jpg");

    // Ada's picture, with the thumbnail her browser sent.
    const started = await startUpload(ada, design.id, { name: "moon.jpg", type: "", size: moon.length, clientMessageId: crypto.randomUUID() });
    const { id } = (await started.json()) as Upload;
    const preview = await api(uploadPreviewPath(design.id, id), { method: "PUT", headers: { Cookie: ada.cookie, "Content-Length": String(moon.length) }, body: moon });
    expect(preview.status).toBe(204);
    const original = (await (await sendPart(ada, design.id, id, 1, moon)).json()) as FileMessage;
    expect(original.attachment.previewUrl).toBeDefined();

    const watching = await connect(launch.id, grace);
    const message = await shared(grace, launch.id, design.id, original.attachment.id, { clientMessageId: "5s1fw6nd9fk" });
    expect(message).toMatchObject({ clientMessageId: "5s1fw6nd9fk", roomId: launch.id, creator: { id: grace.user.id }, body: "", plainText: "moon.jpg" });
    const { id: copy, url, previewUrl, ...file } = message.attachment;
    const { id: _, url: _url, downloadUrl: _download, previewUrl: _preview, ...originally } = original.attachment;
    expect(copy).not.toBe(original.attachment.id);
    expect(file).toEqual({ ...originally, downloadUrl: `${url}?disposition=attachment` });
    expect((await watching.next("message.created")).message).toEqual(message);
    expect(await served(url)).toEqual(moon);
    expect(previewUrl).toBeDefined();
    expect(await served(previewUrl!)).toEqual(moon);

    // The copy is this room's, so it stays once the other room's file is deleted.
    await files().delete([objectKey(original.attachment.id), previewKey(original.attachment.id)]);
    expect(await served(url)).toEqual(moon);
  });

  it("shares a file as a reply in a thread, sent to the room too when asked", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const design = await createRoom("design", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const launch = await createRoom("launch", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const plan = await upload(ada, design.id, "plan.txt", new TextEncoder().encode("the plan"));
    const socket = await connect(launch.id, grace);
    socket.send({ type: "message.create", clientMessageId: crypto.randomUUID(), body: "<p>Thread</p>" });
    const root = (await socket.next("message.created")).message;

    const reply = await shared(grace, launch.id, design.id, plan.attachment.id, { parentId: root.id, alsoSend: true });
    expect(reply).toMatchObject({ parentId: root.id, alsoSent: true, attachment: { name: "plan.txt", contentType: "text/plain", byteSize: 8 } });
  });

  it("shares only a file in a room the sharer is in, still there, in a room they're in too", async () => {
    const [ada, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const design = await createRoom("design", { closedTo: [ada.user.id, grace.user.id], as: ada });
    const launch = await createRoom("launch", { closedTo: [ada.user.id, grace.user.id, linus.user.id], as: ada });
    const secret = await createRoom("secret", { closedTo: [ada.user.id], as: ada });
    const plan = await upload(ada, design.id, "plan.txt", new TextEncoder().encode("the plan"));

    // Linus isn't in the room it was posted in, so to him it isn't there.
    const outsider = await share(linus, launch.id, { roomId: design.id, fileId: plan.attachment.id });
    expect(outsider.status).toBe(404);
    expect(await errorOf(outsider)).toBe("File not found or inaccessible");
    // Grace isn't in the room she'd share it in.
    expect((await share(grace, secret.id, { roomId: design.id, fileId: plan.attachment.id })).status).toBe(404);
    expect((await share(grace, launch.id, { roomId: design.id, fileId: "nothing" })).status).toBe(404);
    expect((await share(grace, launch.id, { roomId: "no%20room", fileId: plan.attachment.id })).status).toBe(404);
    expect((await share(grace, launch.id, { fileId: plan.attachment.id })).status).toBe(422);
    expect((await api(sharedFilesPath(launch.id), { method: "POST", body: JSON.stringify({ roomId: design.id, fileId: plan.attachment.id }) })).status).toBe(401);

    // Nor once its message is deleted.
    const socket = await connect(design.id, ada);
    socket.send({ type: "message.delete", messageId: plan.id });
    await socket.next("message.deleted");
    expect((await share(grace, launch.id, { roomId: design.id, fileId: plan.attachment.id })).status).toBe(404);
  });
});
