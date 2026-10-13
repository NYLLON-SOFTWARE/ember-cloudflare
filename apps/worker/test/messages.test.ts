import { feature } from "@ember/parity";
import { MAX_MESSAGE_LENGTH } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { MESSAGES_BEFORE, NEWEST_MESSAGES } from "../src/store";
import { connect, freshRoom, post, roomSql, settle, signIn } from "./support";

describe(feature("messages.create"), () => {
  it("delivers a message to everyone in the room, attributed to its sender", async () => {
    const room = freshRoom("create");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");

    ada.send({ type: "message.create", clientMessageId: "c1", body: "  Hello, Grace  " });
    const { message } = await grace.next("message.created");
    expect(message).toMatchObject({
      clientMessageId: "c1",
      roomId: room,
      body: "Hello, Grace",
      creator: ada.me,
      boosts: [],
    });
    expect(message.updatedAt).toBe(message.createdAt);
    expect((await ada.next("message.created")).message).toEqual(message);
  });

  it("keeps messages, so people who join later see them", async () => {
    const room = freshRoom("kept");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "Still here");
    ada.close();

    const grace = await connect(room, "Grace");
    expect(grace.welcome.messages).toEqual([message]);
  });

  it("gives later messages later ids, even when sent in a burst", async () => {
    const ada = await connect(freshRoom("burst"), "Ada");
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await post(ada, `burst ${i}`)).id);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(5);
  });

  it("keeps each room's messages to itself", async () => {
    const [first, second] = [freshRoom("one"), freshRoom("two")];
    const ada = await connect(first, "Ada");
    const grace = await connect(second, "Grace");
    await post(ada, "Only in the first room");
    await settle(ada, grace);

    expect(grace.pending("message.created")).toEqual([]);
    expect((await connect(second, "Linus")).welcome.messages).toEqual([]);
  });

  it(`refuses blank messages and messages over ${MAX_MESSAGE_LENGTH} characters`, async () => {
    const room = freshRoom("refused");
    const ada = await connect(room, "Ada");
    ada.send({ type: "message.create", clientMessageId: "blank", body: " \n " });
    expect((await ada.next("error")).message).toBe("Unrecognized frame");
    ada.send({ type: "message.create", clientMessageId: "long", body: "x".repeat(MAX_MESSAGE_LENGTH + 1) });
    expect((await ada.next("error")).message).toBe("Unrecognized frame");

    await post(ada, "x".repeat(MAX_MESSAGE_LENGTH));
    const later = await connect(room, "Grace");
    expect(later.welcome.messages).toHaveLength(1);
  });

  it("answers frames it can't read with an error, and keeps the socket open", async () => {
    const ada = await connect(freshRoom("garbage"), "Ada");
    for (const frame of ["not json", "null", JSON.stringify({ type: "message.create" }), JSON.stringify({ type: "nope" })]) {
      ada.sendRaw(frame);
      expect((await ada.next("error")).message).toBe("Unrecognized frame");
    }
    ada.sendRaw(new TextEncoder().encode("binary").buffer as ArrayBuffer);
    expect((await ada.next("error")).message).toBe("Unrecognized frame");
    await post(ada, "Still connected");
  });
});

describe(feature("messages.edit"), () => {
  it("lets the author change a message, for everyone, and keeps the change", async () => {
    const room = freshRoom("edit");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    const original = await post(ada, "Helo");

    ada.send({ type: "message.update", messageId: original.id, body: " Hello " });
    const { message } = await grace.next("message.updated");
    expect(message).toMatchObject({ id: original.id, body: "Hello", creator: ada.me, createdAt: original.createdAt });
    expect(message.updatedAt >= original.createdAt).toBe(true);
    expect((await ada.next("message.updated")).message).toEqual(message);

    const later = await connect(room, "Linus");
    expect(later.welcome.messages).toEqual([message]);
  });

  it("refuses edits to someone else's message, telling only the person who tried", async () => {
    const room = freshRoom("edit-other");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    const original = await post(ada, "Mine");

    grace.send({ type: "message.update", messageId: original.id, body: "Hijacked" });
    expect((await grace.next("error")).message).toBe("You can only edit your own messages");
    await settle(grace, ada);
    expect(ada.pending("message.updated")).toEqual([]);
    expect(ada.pending("error")).toEqual([]);
    expect((await connect(room, "Linus")).welcome.messages[0]!.body).toBe("Mine");
  });

  it("refuses edits to messages that don't exist and blank edits", async () => {
    const ada = await connect(freshRoom("edit-missing"), "Ada");
    const original = await post(ada, "Here");
    ada.send({ type: "message.update", messageId: "missing", body: "Hello" });
    expect((await ada.next("error")).message).toBe("You can only edit your own messages");
    ada.send({ type: "message.update", messageId: original.id, body: "   " });
    expect((await ada.next("error")).message).toBe("Unrecognized frame");
  });

  it("keeps reactions that land while a message is being edited", async () => {
    const room = freshRoom("edit-boost");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    const message = await post(ada, "First draft");

    ada.send({ type: "message.update", messageId: message.id, body: "Second draft" });
    grace.send({ type: "boost.create", messageId: message.id, content: "🎉" });
    const { message: updated } = await ada.next("message.updated");
    await ada.next("boost.created");

    // Whichever lands second must not undo the first.
    const updatedAt = ada.log.findIndex((f) => f.type === "message.updated");
    const boostedAt = ada.log.findIndex((f) => f.type === "boost.created");
    if (boostedAt < updatedAt) expect(updated.boosts.map((b) => b.content)).toEqual(["🎉"]);
    const later = await connect(room, "Linus");
    expect(later.welcome.messages[0]).toMatchObject({ body: "Second draft", boosts: [{ content: "🎉" }] });
  });
});

describe(feature("messages.delete"), () => {
  it("lets the author delete a message, with its reactions, for everyone", async () => {
    const room = freshRoom("delete");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    const doomed = await post(ada, "Oops");
    const kept = await post(ada, "Keep this");
    grace.send({ type: "boost.create", messageId: doomed.id, content: "👍" });
    await ada.next("boost.created");

    ada.send({ type: "message.delete", messageId: doomed.id });
    expect(await grace.next("message.deleted")).toEqual({ type: "message.deleted", messageId: doomed.id });
    await ada.next("message.deleted");

    const later = await connect(room, "Linus");
    expect(later.welcome.messages.map((m) => m.id)).toEqual([kept.id]);
    grace.send({ type: "boost.create", messageId: doomed.id, content: "👍" });
    expect((await grace.next("error")).message).toBe("That message no longer exists");
  });

  it("keeps a message's reactions when deleting it fails", async () => {
    const room = freshRoom("delete-fails");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "Keep my reactions");
    ada.send({ type: "boost.create", messageId: message.id, content: "👍" });
    await ada.next("boost.created");

    // Make the storage refuse to delete this room's messages.
    const trigger = `refuse_deletes_${room.replaceAll("-", "_")}`;
    await roomSql(room, `CREATE TRIGGER ${trigger} BEFORE DELETE ON messages WHEN OLD.room_id = '${room}' BEGIN SELECT RAISE(ABORT, 'refused'); END`);
    ada.send({ type: "message.delete", messageId: message.id });
    expect(await ada.next("error")).toMatchObject({ failed: "message.delete" });
    expect(await roomSql(room, "SELECT content FROM boosts WHERE message_id = ?", message.id)).toEqual([{ content: "👍" }]);

    await roomSql(room, `DROP TRIGGER ${trigger}`);
    ada.send({ type: "message.delete", messageId: message.id });
    await ada.next("message.deleted");
    expect(await roomSql(room, "SELECT content FROM boosts WHERE message_id = ?", message.id)).toEqual([]);
  });

  it("refuses to delete someone else's message", async () => {
    const room = freshRoom("delete-other");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    const message = await post(ada, "Mine");

    grace.send({ type: "message.delete", messageId: message.id });
    expect((await grace.next("error")).message).toBe("You can only delete your own messages");
    await settle(grace, ada);
    expect(ada.pending("message.deleted")).toEqual([]);
    expect((await connect(room, "Linus")).welcome.messages).toHaveLength(1);
  });
});

describe(feature("messages.history"), () => {
  it("opens a room on its newest 50 messages, oldest first, and says when there are more", async () => {
    const room = freshRoom("page");
    const ada = await connect(room, "Ada");
    for (let i = 1; i <= 52; i++) await post(ada, `message ${i}`);

    const grace = await connect(room, "Grace");
    expect(grace.welcome.messages).toHaveLength(50);
    expect(grace.welcome.messages[0]!.body).toBe("message 3");
    expect(grace.welcome.messages.at(-1)!.body).toBe("message 52");
    expect(grace.welcome.hasMore).toBe(true);
  });

  it("pages backwards from the oldest message shown until there's nothing left", async () => {
    const room = freshRoom("back");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    const posted = [];
    for (let i = 1; i <= 5; i++) posted.push(await post(ada, `message ${i}`));

    ada.send({ type: "history.before", before: posted[4]!.id, limit: 3 });
    const middle = await ada.next("history");
    expect(middle.messages.map((m) => m.body)).toEqual(["message 2", "message 3", "message 4"]);
    expect(middle.hasMore).toBe(true);

    ada.send({ type: "history.before", before: middle.messages[0]!.id, limit: 3 });
    const last = await ada.next("history");
    expect(last.messages.map((m) => m.body)).toEqual(["message 1"]);
    expect(last.hasMore).toBe(false);

    await settle(ada, grace);
    expect(grace.pending("history")).toEqual([]);
  });

  it("hands out the largest history page a client may ask for", async () => {
    const room = freshRoom("long-history");
    const ada = await connect(room, "Ada");
    const bodies = Array.from({ length: 101 }, (_, i) => `long ${i}`);
    const ids: string[] = [];
    for (const body of bodies) ids.push((await post(ada, body)).id);
    for (const content of ["👍", "🎉"]) {
      ada.send({ type: "boost.create", messageId: ids[0]!, content });
      await ada.next("boost.created");
    }

    // 100 is the most parseClientFrame lets through, and both backends bind at most 100 values a
    // statement, so a page can't bind its message ids to look up their boosts.
    ada.send({ type: "history.before", before: ids[100]!, limit: 100 });
    const page = await ada.next("history");
    expect(page.messages.map((m) => m.body)).toEqual(bodies.slice(0, 100));
    expect(page.messages[0]!.boosts.map((b) => b.content)).toEqual(["👍", "🎉"]);
    expect(page.hasMore).toBe(false);
  });

  it("pages history by seeking the room's index from the cursor", async () => {
    const room = freshRoom("paging-plan");
    await connect(room, "Ada");
    const plan = async (query: string, ...params: Array<string | number>) =>
      (await roomSql(room, `EXPLAIN QUERY PLAN ${query}`, ...params)).map((row) => (row as { detail: string }).detail).join("; ");

    const before = await plan(MESSAGES_BEFORE, room, "cursor", 51);
    const newest = await plan(NEWEST_MESSAGES, room, 51);

    // Seeking (room_id=?) alone would walk the room from its newest message down to the cursor.
    expect(before).toContain("index_messages_on_room_id_and_id (room_id=? AND id<?)");
    expect(`${before}; ${newest}`).not.toContain("TEMP B-TREE");
  });

  it("gives someone joining mid-conversation every message exactly once, snapshot first", async () => {
    const room = freshRoom("joining");
    const ada = await connect(room, "Ada");
    const session = await signIn("Grace");

    // Ada keeps talking while Grace's socket loads its snapshot.
    const joining = connect(room, session);
    const bodies = Array.from({ length: 10 }, (_, i) => `joining ${i}`);
    for (const [i, body] of bodies.entries()) {
      ada.send({ type: "message.create", clientMessageId: `j${i}`, body });
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const grace = await joining;
    for (const _ of bodies) await ada.next("message.created");
    await settle(grace);

    const [first, ...rest] = grace.log;
    expect(first?.type).toBe("welcome");
    const live = rest.flatMap((f) => (f.type === "message.created" ? [f.message.body] : []));
    expect([...grace.welcome.messages.map((m) => m.body), ...live]).toEqual(bodies);
  });

  it("includes each message's reactions in history", async () => {
    const room = freshRoom("history-boosts");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "React to me");
    ada.send({ type: "boost.create", messageId: message.id, content: "🎉" });
    const { boost } = await ada.next("boost.created");

    const grace = await connect(room, "Grace");
    expect(grace.welcome.messages[0]!.boosts).toEqual([boost]);
  });
});
