import { MENTION_CONTENT_TYPE, mentionSgid } from "@ember/richtext";
import { env } from "cloudflare:test";
import type { Message, NewForward, RoomId } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { objectKey } from "../src/files/blobs";
import { api, connect, createRoom, direct, freshRoom, origin, post, recordedImage, signIn, upload, type Session } from "./support";

/** Forwards `messageId` from `room` as `session`, answering how the Worker answered. */
const forward = (session: Session, room: RoomId, messageId: string, newForward: Omit<NewForward, "clientMessageId"> & { clientMessageId?: string }) =>
  api(`/api/rooms/${room}/messages/${encodeURIComponent(messageId)}/forwards`, {
    method: "POST",
    headers: { Cookie: session.cookie },
    body: JSON.stringify({ clientMessageId: crypto.randomUUID(), ...newForward }),
  });

/** Forwards as `forward` does, expecting the message posted. */
async function forwarded(...args: Parameters<typeof forward>): Promise<Message> {
  const response = await forward(...args);
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as Message;
}

const mention = (userId: string) => `<action-text-attachment sgid="${mentionSgid(userId)}" content-type="${MENTION_CONTENT_TYPE}"></action-text-attachment>`;

/** The `<cite>` a forward quoting `original` ends with, from its `<time>` on. */
const citedTime = (original: Message) => `<time datetime="${original.createdAt}">`;

describe("Forward a message", () => {
  it("posts it into a DM as the forwarder's message, after their note, quoting it with its author, time and a link to it", async () => {
    const room = await freshRoom("forward-to-direct");
    const [adaSession, graceSession] = await Promise.all([signIn("Ada"), signIn("Grace")]);
    const ada = await connect(room, adaSession);
    const original = await post(ada, `<p>Lunch at noon, ${mention(graceSession.user.id)}?</p>`);
    const dm = await direct(adaSession, graceSession);
    const grace = await connect(dm.id, graceSession);

    const message = await forwarded(adaSession, room, original.id, { to: dm.id, note: "See this\nfrom the room" });
    expect(message).toMatchObject({ roomId: dm.id, creator: { id: adaSession.user.id }, mentions: [] });
    expect(message.body).toBe(
      "<p>See this<br>from the room</p>" +
        `<blockquote><p>Lunch at noon, Grace?</p></blockquote><cite>Ada · ${citedTime(original)}` +
        `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(original.createdAt))} UTC</time> ` +
        `<a href="${origin}/rooms/${room}/@${original.id}">#</a></cite>`,
    );
    expect((await grace.next("message.created")).message).toEqual(message);
  });

  it("forwards from a thread, linking to the reply there, and into a thread", async () => {
    const room = await freshRoom("forward-threads");
    const [adaSession, graceSession] = await Promise.all([signIn("Ada"), signIn("Grace")]);
    const ada = await connect(room, adaSession);
    const parent = await post(ada, "Plans?");
    ada.send({ type: "message.create", clientMessageId: "r1", body: "<p>Picnic</p>", parentId: parent.id });
    const reply = (await ada.next("message.created")).message;
    const dm = await direct(adaSession, graceSession);
    const grace = await connect(dm.id, graceSession);
    const topic = await post(grace, "Weekend");

    const message = await forwarded(adaSession, room, reply.id, { to: dm.id, parentId: topic.id });
    expect(message).toMatchObject({ roomId: dm.id, parentId: topic.id });
    expect(message.body).toContain(`<a href="${origin}/rooms/${room}/threads/${parent.id}/@${reply.id}">#</a>`);
    // Into the thread only, as a reply is unless it's also sent.
    expect(message.alsoSent).toBeFalsy();
  });

  it("forwards within a room too", async () => {
    const room = await freshRoom("forward-here");
    const ada = await connect(room, "Ada");
    const original = await post(ada, "Again");
    const message = await forwarded(ada.session, room, original.id, { to: room });
    expect(message.body).toContain("<blockquote>Again</blockquote>");
  });

  it("forwards only from and into conversations the forwarder is in, and only messages still there", async () => {
    const [adaSession, graceSession] = await Promise.all([signIn("Ada"), signIn("Grace")]);
    const secret = (await createRoom("Secret", { closedTo: [adaSession.user.id], as: adaSession })).id;
    const open = await freshRoom("forward-open");
    const hidden = await post(await connect(secret, adaSession), "Between us");
    const shared = await post(await connect(open, graceSession), "Hello");

    // Grace isn't in Secret, so she can neither forward from it nor into it, and learns nothing of what's there.
    expect((await forward(graceSession, secret, hidden.id, { to: open })).status).toBe(404);
    expect((await forward(graceSession, open, shared.id, { to: secret })).status).toBe(404);
    expect((await forward(adaSession, open, "missing", { to: secret })).status).toBe(404);
    const thread = await forward(adaSession, open, shared.id, { to: secret, parentId: "missing" });
    expect([thread.status, await thread.json()]).toEqual([422, { error: "That thread no longer exists" }]);
    expect((await forward(adaSession, open, shared.id, { to: "Not a room" } as NewForward)).status).toBe(422);
    const signedOut = await api(`/api/rooms/${open}/messages/${shared.id}/forwards`, { method: "POST", body: JSON.stringify({ to: secret, clientMessageId: "c1" }) });
    expect(signedOut.status).toBe(401);
  });

  it("copies a file message's file into the conversation it goes to, quoting its name", async () => {
    const room = await freshRoom("forward-file");
    const [adaSession, graceSession] = await Promise.all([signIn("Ada"), signIn("Grace")]);
    const image = recordedImage("moon-thumb.jpg");
    const original = await upload(adaSession, room, "moon.jpg", image);
    const dm = await direct(adaSession, graceSession);

    const message = await forwarded(adaSession, room, original.id, { to: dm.id });
    expect(message.attachment).toMatchObject({ name: "moon.jpg", contentType: original.attachment.contentType, byteSize: image.length });
    expect(message.attachment!.id).not.toBe(original.attachment.id);
    expect(message.body).toContain("<blockquote><p>moon.jpg</p></blockquote>");
    const copy = await (env as unknown as Env).FILES!.get(objectKey(message.attachment!.id));
    expect(new Uint8Array(await copy!.arrayBuffer())).toEqual(image);
    // Grace can download it from the DM, though she isn't in the room it came from.
    const download = await api(message.attachment!.downloadUrl, { headers: { Cookie: graceSession.cookie } });
    expect(download.status).toBe(200);
  });
});
