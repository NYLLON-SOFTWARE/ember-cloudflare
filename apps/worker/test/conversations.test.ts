import { THREAD_CONTEXT, THREADS_LIMIT, type DirectPreviews, type FollowedThreads, type Message, type RoomId, type User } from "@ember/protocol";
import { MENTION_CONTENT_TYPE, mentionSgid } from "@ember/richtext";
import { beforeEach, describe, expect, it } from "vitest";
import { api, connect, direct, freshDeploy, freshRoom, post, roomSql, signIn, type Session, type Socket } from "./support";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until room `room` has nothing left in its log for the search index, which it forgets once the index has taken it. */
async function caughtUp(room: RoomId): Promise<void> {
  while ((await roomSql(room, "SELECT seq FROM unindexed_messages WHERE room_id = ?", room)).length > 0) await sleep(5);
}

/** A mention of `person`, as the composer writes one. */
const mention = (person: Pick<User, "id">) => `<action-text-attachment sgid="${mentionSgid(person.id)}" content-type="${MENTION_CONTENT_TYPE}"></action-text-attachment>`;

/** Posts a reply to `parent` in its thread as `client`. */
async function reply(client: Socket, parent: Pick<Message, "id">, body: string): Promise<Message> {
  const clientMessageId = crypto.randomUUID();
  client.send({ type: "message.create", clientMessageId, body, parentId: parent.id, alsoSend: false });
  for (;;) {
    const { message } = await client.next("message.created");
    if (message.clientMessageId === clientMessageId) return message;
  }
}

/** What `path` answers `session` with, as JSON, once it's answered 200. */
async function asked<T>(session: Session, path: string): Promise<T> {
  const response = await api(path, { headers: { Cookie: session.cookie } });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}

beforeEach(freshDeploy);

describe("DM previews", () => {
  it("answers each DM's latest message, not a reply in a thread, and how many others wrote since it was marked unread", async () => {
    const [ada, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const withGrace = await direct(ada, grace);
    const withLinus = await direct(ada, linus);
    const graceInDm = await connect(withGrace.id, grace);
    const first = await post(graceInDm, "<p>first</p>");
    const latest = await post(graceInDm, "<p>latest</p>");
    await reply(graceInDm, first, "<p>a reply</p>");
    await caughtUp(withGrace.id);

    // The Workspace marks the DM unread for Ada once its room tells it of Grace's messages, which can come
    // a moment after the index has them.
    let previews: DirectPreviews["previews"] = [];
    for (let tries = 0; tries < 200; tries++) {
      ({ previews } = await asked<DirectPreviews>(ada, "/api/directs"));
      if (previews.find(({ roomId }) => roomId === withGrace.id)?.unread === 2) break;
      await sleep(10);
    }
    const byRoom = new Map(previews.map((preview) => [preview.roomId, preview]));
    expect(byRoom.get(withGrace.id)?.latest?.id).toBe(latest.id);
    expect(byRoom.get(withGrace.id)?.unread).toBe(2);
    expect(byRoom.get(withLinus.id)).toEqual({ roomId: withLinus.id, latest: null, unread: 0 });
    // Grace's own messages are none she hasn't read.
    expect((await asked<DirectPreviews>(grace, "/api/directs")).previews).toEqual([expect.objectContaining({ roomId: withGrace.id, unread: 0 })]);
  });

  it("is only for people signed in", async () => {
    expect((await api("/api/directs")).status).toBe(401);
    expect((await api("/api/threads")).status).toBe(401);
  });
});

describe("Followed threads", () => {
  it("lists the threads you started, wrote in, or were mentioned in, latest active first, in rooms you're in", async () => {
    const [ada, grace, linus] = [await signIn("Ada"), await signIn("Grace"), await signIn("Linus")];
    const room = await freshRoom("threads");
    const [adaIn, graceIn] = [await connect(room, ada), await connect(room, grace)];
    const started = await post(adaIn, "<p>Ada's thread</p>");
    await reply(graceIn, started, "<p>answer</p>");
    const joined = await post(graceIn, "<p>Grace's thread</p>");
    await reply(adaIn, joined, "<p>Ada chimes in</p>");
    const mentioned = await post(graceIn, "<p>another</p>");
    await reply(graceIn, mentioned, `<p>what does ${mention(ada.user)} think?</p>`);
    const elsewhere = await post(graceIn, "<p>not Ada's</p>");
    await reply(graceIn, elsewhere, "<p>nothing to do with her</p>");
    await caughtUp(room);

    const { threads, next } = await asked<FollowedThreads>(ada, "/api/threads");
    expect(threads.map(({ parent }) => parent.id)).toEqual([mentioned.id, joined.id, started.id]);
    expect(threads[0]).toMatchObject({ roomId: room, count: 1, replies: [expect.objectContaining({ plainText: expect.stringContaining("think") })] });
    expect(next).toBeNull();
    expect((await asked<FollowedThreads>(linus, "/api/threads")).threads).toEqual([]);
  });

  it("shows a thread's first message and its latest replies, oldest first, and pages through the threads", async () => {
    const ada = await signIn("Ada");
    const room = await freshRoom("busy-threads");
    const adaIn = await connect(room, ada);
    const parents: Message[] = [];
    for (let i = 0; i <= THREADS_LIMIT; i++) {
      const parent = await post(adaIn, `<p>thread ${i}</p>`);
      parents.push(parent);
      await reply(adaIn, parent, `<p>reply ${i}</p>`);
    }
    const long = parents[0]!;
    const replies: Message[] = [];
    for (let i = 0; i < THREAD_CONTEXT + 2; i++) replies.push(await reply(adaIn, long, `<p>more ${i}</p>`));
    await caughtUp(room);

    const first = await asked<FollowedThreads>(ada, "/api/threads");
    expect(first.threads).toHaveLength(THREADS_LIMIT);
    expect(first.threads[0]).toMatchObject({ count: THREAD_CONTEXT + 3, parent: expect.objectContaining({ id: long.id }) });
    expect(first.threads[0]!.replies.map(({ id }) => id)).toEqual(replies.slice(-THREAD_CONTEXT).map(({ id }) => id));
    expect(first.next).not.toBeNull();
    const second = await asked<FollowedThreads>(ada, `/api/threads?cursor=${first.next}`);
    expect(second.threads.map(({ parent }) => parent.id)).toEqual([parents[1]!.id]);
    expect(second.next).toBeNull();
  });
});
