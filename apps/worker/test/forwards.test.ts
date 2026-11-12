import { MENTION_CONTENT_TYPE, mentionSgid } from "@ember/richtext";
import { env } from "cloudflare:test";
import { MAX_MESSAGE_LENGTH, searchQuery, type ActivityPage, type Message, type NewForward, type RoomId, type SearchResults } from "@ember/protocol";
import { describe, expect, it, vi } from "vitest";
import { ORIGINAL_DELETED } from "../src/chat-room";
import type { Env } from "../src/env";
import { objectKey } from "../src/files/blobs";
import { api, connect, createRoom, direct, freshRoom, origin, post, recordedImage, roomSql, signIn, upload, type Session } from "./support";

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

/** What `session` finds searching for `q`. */
async function found(session: Session, q: string): Promise<Message[]> {
  const response = await api(`/api/searches?${searchQuery({ q })}`, { headers: { Cookie: session.cookie } });
  expect(response.status).toBe(200);
  return ((await response.json()) as SearchResults).matches.map(({ message }) => message);
}

/** What `session`'s Activity previews. */
async function previews(session: Session): Promise<string[]> {
  return ((await (await api("/api/activity", { headers: { Cookie: session.cookie } })).json()) as ActivityPage).items.map((item) => item.preview);
}

describe("What a forward reads as outside its conversation", () => {
  it("reads as its note and whose message it forwards, or what it quotes, without the quote's time or link", async () => {
    const room = await freshRoom("forward-plain-text");
    const [adaSession, graceSession] = await Promise.all([signIn("Ada"), signIn("Grace")]);
    const original = await post(await connect(room, adaSession), "<p>Lunch at noon?</p>");
    const dm = await direct(adaSession, graceSession);
    expect((await forwarded(adaSession, room, original.id, { to: dm.id, note: "See this" })).plainText).toBe("See this — forwarded from Ada");
    const bare = await forwarded(adaSession, room, original.id, { to: dm.id });
    expect(bare.plainText).toBe("Lunch at noon?");
    expect(bare.plainText).not.toMatch(/UTC|#/);
  });
});

describe("A forward sent again", () => {
  it("posts once, answering the forward it posted for the same id", async () => {
    const room = await freshRoom("forward-again");
    const [adaSession, graceSession] = await Promise.all([signIn("Ada"), signIn("Grace")]);
    const original = await post(await connect(room, adaSession), "Once");
    const dm = await direct(adaSession, graceSession);
    const first = await forwarded(adaSession, room, original.id, { to: dm.id, clientMessageId: "f1" });
    const again = await forward(adaSession, room, original.id, { to: dm.id, clientMessageId: "f1" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as Message).id).toBe(first.id);
    expect((await connect(dm.id, graceSession)).welcome.messages.map((message) => message.id)).toEqual([first.id]);
  });

  it("takes a note as long as a message, whatever the quote's length", async () => {
    const room = await freshRoom("forward-long");
    const [adaSession, graceSession] = await Promise.all([signIn("Ada"), signIn("Grace")]);
    const original = await post(await connect(room, adaSession), `<p>${"x".repeat(MAX_MESSAGE_LENGTH - 10)}</p>`);
    const dm = await direct(adaSession, graceSession);
    await forwarded(adaSession, room, original.id, { to: dm.id, note: "y".repeat(MAX_MESSAGE_LENGTH) });
    expect((await forward(adaSession, room, original.id, { to: dm.id, note: "y".repeat(MAX_MESSAGE_LENGTH + 1) })).status).toBe(422);
  });
});

describe("Forwards follow their originals", () => {
  it("take what they quote of a private room's message away once it's deleted, keeping the note, in the room, search and Activity", async () => {
    const [adaSession, graceSession] = await Promise.all([signIn("Ada"), signIn("Grace")]);
    const secret = (await createRoom("Secret", { closedTo: [adaSession.user.id], as: adaSession })).id;
    const ada = await connect(secret, adaSession);
    const original = await post(ada, "<p>The aardvark plan</p>");
    const dm = await direct(adaSession, graceSession);
    const grace = await connect(dm.id, graceSession);
    const noted = await forwarded(adaSession, secret, original.id, { to: dm.id, note: "Look" });
    const bare = await forwarded(adaSession, secret, original.id, { to: dm.id });
    await vi.waitFor(async () => expect((await found(graceSession, "aardvark")).map((message) => message.id)).toEqual([bare.id]), { timeout: 10_000 });

    ada.send({ type: "message.delete", messageId: original.id });
    const updated = new Map<string, Message>();
    while (updated.size < 2) {
      const { message } = await grace.next("message.updated");
      updated.set(message.id, message);
    }
    expect(updated.get(noted.id)).toMatchObject({ body: `<p>Look</p><blockquote><p>${ORIGINAL_DELETED}</p></blockquote>`, editedAt: null });
    expect(updated.get(bare.id)!.body).toBe(`<blockquote><p>${ORIGINAL_DELETED}</p></blockquote>`);
    for (const message of updated.values()) expect(message.plainText).not.toContain("aardvark");
    expect((await connect(dm.id, graceSession)).welcome.messages.map((message) => message.body)).toEqual([...updated.values()].map((message) => message.body));
    await vi.waitFor(async () => expect(await found(graceSession, "aardvark")).toEqual([]), { timeout: 10_000 });
    await vi.waitFor(async () => expect((await previews(graceSession)).join(" ")).not.toContain("aardvark"), { timeout: 10_000 });
    // The original's room forgets them once their room has heard.
    await vi.waitFor(async () => expect(await roomSql(secret, "SELECT forward_id FROM forwards WHERE room_id = ?", secret)).toEqual([]), { timeout: 10_000 });
  });

  it("delete a forwarded file's copy once its original is deleted", async () => {
    const [adaSession, graceSession] = await Promise.all([signIn("Ada"), signIn("Grace")]);
    const secret = (await createRoom("Secret files", { closedTo: [adaSession.user.id], as: adaSession })).id;
    const ada = await connect(secret, adaSession);
    const original = await upload(adaSession, secret, "moon.jpg", recordedImage("moon-thumb.jpg"));
    const dm = await direct(adaSession, graceSession);
    const grace = await connect(dm.id, graceSession);
    const copy = (await forwarded(adaSession, secret, original.id, { to: dm.id })).attachment!;

    ada.send({ type: "message.delete", messageId: original.id });
    const { message } = await grace.next("message.updated");
    expect(message.attachment).toBeUndefined();
    await vi.waitFor(async () => expect(await (env as unknown as Env).FILES!.get(objectKey(copy.id))).toBeNull(), { timeout: 10_000 });
  });

  it("leave a forward deleted before its original as it is", async () => {
    const room = await freshRoom("forward-gone-first");
    const [adaSession, graceSession] = await Promise.all([signIn("Ada"), signIn("Grace")]);
    const ada = await connect(room, adaSession);
    const original = await post(ada, "Soon gone");
    const dm = await direct(adaSession, graceSession);
    const inDm = await connect(dm.id, adaSession);
    const forwardedOnce = await forwarded(adaSession, room, original.id, { to: dm.id });
    inDm.send({ type: "message.delete", messageId: forwardedOnce.id });
    await inDm.next("message.deleted");
    ada.send({ type: "message.delete", messageId: original.id });
    await vi.waitFor(async () => expect(await roomSql(room, "SELECT forward_id FROM forwards WHERE room_id = ?", room)).toEqual([]), { timeout: 10_000 });
    expect((await connect(dm.id, graceSession)).welcome.messages).toEqual([]);
  });
});


describe("Forwards of forwards", () => {
  it("take a deleted private original's text out of every forward down the chain, in the room and search", async () => {
    const [mayaSession, leoSession, samSession] = await Promise.all([signIn("Maya"), signIn("Leo"), signIn("Sam")]);
    const secret = (await createRoom("Private chain", { closedTo: [mayaSession.user.id], as: mayaSession })).id;
    const open = await freshRoom("forward-chain");
    const maya = await connect(secret, mayaSession);
    const original = await post(maya, "<p>The pangolin password</p>");
    const b = await forwarded(mayaSession, secret, original.id, { to: open });
    const dm = await direct(leoSession, samSession);
    const sam = await connect(dm.id, samSession);
    const c = await forwarded(leoSession, open, b.id, { to: dm.id });
    expect(c.body).toContain("pangolin");
    // Sam is in the open room too, so he finds B as well as C.
    await vi.waitFor(async () => expect((await found(samSession, "pangolin")).map((message) => message.id).sort()).toEqual([b.id, c.id].sort()), { timeout: 10_000 });

    maya.send({ type: "message.delete", messageId: original.id });
    const { message: retold } = await sam.next("message.updated");
    expect(retold.id).toBe(c.id);
    expect(retold.body).not.toContain("pangolin");
    expect(retold.body).toContain(ORIGINAL_DELETED);
    expect(retold.plainText).not.toContain("pangolin");
    expect((await connect(dm.id, samSession)).welcome.messages[0]!.body).not.toContain("pangolin");
    await vi.waitFor(async () => expect(await found(samSession, "pangolin")).toEqual([]), { timeout: 10_000 });
  });
});

describe("Forwards follow edits", () => {
  it("quote what their original says now, down the chain, keeping their notes", async () => {
    const [adaSession, graceSession] = await Promise.all([signIn("Ada"), signIn("Grace")]);
    const room = await freshRoom("forward-edits");
    const ada = await connect(room, adaSession);
    const original = await post(ada, "<p>Lunch at noon</p>");
    const dm = await direct(adaSession, graceSession);
    const grace = await connect(dm.id, graceSession);
    const noted = await forwarded(adaSession, room, original.id, { to: dm.id, note: "FYI" });
    const bare = await forwarded(adaSession, room, original.id, { to: dm.id });
    const again = await forwarded(adaSession, dm.id, bare.id, { to: room });

    ada.send({ type: "message.update", messageId: original.id, body: "<p>Lunch at one</p>" });
    const updated = new Map<string, Message>();
    while (updated.size < 2) {
      const { message } = await grace.next("message.updated");
      updated.set(message.id, message);
    }
    expect(updated.get(noted.id)).toMatchObject({ plainText: "FYI — forwarded from Ada", editedAt: null });
    expect(updated.get(noted.id)!.body).toMatch(/^<p>FYI<\/p><blockquote><p>Lunch at one<\/p><\/blockquote><cite>Ada · /);
    expect(updated.get(bare.id)).toMatchObject({ plainText: "Lunch at one" });
    // The forward of a forward follows the forward it quotes.
    await vi.waitFor(async () => {
      const shown = (await connect(room, adaSession)).welcome.messages.find((message) => message.id === again.id)!;
      expect(shown.body).toContain("Lunch at one");
      expect(shown.body).not.toContain("Lunch at noon");
    }, { timeout: 10_000 });
  });
});
