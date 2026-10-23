import { feature } from "@ember/parity";
import { MAX_SEARCH_LENGTH, SEARCH_TOO_LONG, searchTerms, type Me, type Message, type NewWorkspace, type RoomId, type SearchResults, type UserId } from "@ember/protocol";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRoom } from "../src/chat-room";
import type { Env } from "../src/env";
import { MIGRATIONS } from "../src/migrations";
import { SEARCH_PROBE, type IndexedMessage } from "../src/search-index";
import type { Workspace } from "../src/workspace";
import {
  api,
  connect,
  cookieOf,
  createRoom,
  direct,
  freshDeploy,
  freshRoom,
  post,
  recordedImage,
  roomSql,
  roomStub,
  searchIndexStub,
  searchSql,
  shown,
  signIn,
  upload,
  workspaceSql,
  workspaceStub,
  type Session,
  type Socket,
} from "./support";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until room `room` has nothing left in its log for the search index, which it forgets once the index has taken it. */
async function indexed(room: RoomId): Promise<void> {
  while ((await roomSql(room, "SELECT seq FROM unindexed_messages WHERE room_id = ?", room)).length > 0) await sleep(5);
}

/** What `GET /api/searches` answers `session` for `q`. */
const searchAs = (session: Session | null, q: string) => api(`/api/searches?q=${encodeURIComponent(q)}`, { headers: session ? { Cookie: session.cookie } : {} });

/** What `POST /api/searches` answers `session` for `body`, sent as JSON unless it's a string. */
const record = (session: Session | null, body: unknown) =>
  api("/api/searches", { method: "POST", headers: session ? { Cookie: session.cookie } : {}, body: typeof body === "string" ? body : JSON.stringify(body) });

/** What `DELETE /api/searches` answers `session`. */
const clear = (session: Session | null) => api("/api/searches", { method: "DELETE", headers: session ? { Cookie: session.cookie } : {} });

/** What `session` finds searching for `q`. */
async function resultsFor(session: Session, q: string): Promise<SearchResults> {
  const response = await searchAs(session, q);
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}

/** The ids of the messages `session` finds searching for `q`, in order. */
const found = async (session: Session, q: string) => (await resultsFor(session, q)).messages.map(({ id }) => id);

/** `session`'s recent searches, as the search page lists them. */
const recentOf = async (session: Session) => (await resultsFor(session, "")).recent;

/** The searches stored for `userId`, newest first. */
const storedSearches = async (userId: UserId) =>
  ((await workspaceSql("SELECT query FROM searches WHERE user_id = ? ORDER BY position DESC", userId)) as Array<{ query: string }>).map(({ query }) => query);

/** Edits `message` as `client`. */
async function edit(client: Socket, message: Message, body: string): Promise<void> {
  client.send({ type: "message.update", messageId: message.id, body });
  await client.next("message.updated");
}

/** Deletes `message` as `client`. */
async function remove(client: Socket, message: Message): Promise<void> {
  client.send({ type: "message.delete", messageId: message.id });
  await client.next("message.deleted");
}

/** Has the search index forget everything, as it is before it's first filled. */
async function emptyIndex(): Promise<void> {
  for (const table of ["search_index", "search_messages", "search_rooms"]) await searchSql(`DELETE FROM ${table}`);
}

/**
 * Makes the search index unreachable from room `room` until the function this answers is called, as the
 * index is while it's restarting.
 */
async function cutOff(room: RoomId): Promise<() => Promise<void>> {
  let original: Env | undefined;
  await runInDurableObject(roomStub(room), (instance: ChatRoom) => {
    const object = instance as unknown as { env: Env };
    original = object.env;
    const unreachable = { apply: () => Promise.reject(new Error("The search index is unreachable")) };
    object.env = { ...original, SEARCH_INDEX: { getByName: () => unreachable } as unknown as Env["SEARCH_INDEX"] };
  });
  return () =>
    runInDurableObject(roomStub(room), (instance: ChatRoom) => {
      (instance as unknown as { env: Env }).env = original!;
    });
}

/** Runs room `room`'s alarm, as it goes off. */
const runRoomAlarm = (room: RoomId) => runInDurableObject(roomStub(room), (instance: ChatRoom) => instance.alarm());

beforeEach(freshDeploy);

afterEach(() => {
  vi.restoreAllMocks();
});

describe(feature("search.messages"), () => {
  it("finds a message by its words, stemmed, as its text is now", async () => {
    const room = await freshRoom("eels");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "My hovercraft is full of eels");
    await indexed(room);
    expect(await found(ada.session, "eel")).toEqual([message.id]);
    expect(await found(ada.session, "HOVERCRAFT")).toEqual([message.id]);

    await edit(ada, message, "My hovercraft is full of sharks");
    await indexed(room);
    expect(await found(ada.session, "sharks")).toEqual([message.id]);
    expect(await found(ada.session, "eels")).toEqual([]);

    await remove(ada, message);
    await indexed(room);
    expect(await found(ada.session, "sharks")).toEqual([]);
    expect(await searchSql("SELECT count(*) AS n FROM search_messages")).toEqual([{ n: 0 }]);
  });

  it("searches every word as a word, never as FTS5's syntax", async () => {
    const room = await freshRoom("syntax");
    const jason = await connect(room, "Jason");
    const message = await post(jason, "Do NOT feed the eel OR the shark");
    await indexed(room);
    // As ember-rust's test asks the index, quoting each word but not sanitizing them first.
    for (const query of ["NOT", "OR", "AND", "NEAR", "eel NOT", "NOT eel", "shark OR", '"', "*", "", "a\0b", "\0", "́"]) {
      await expect(searchIndexStub().search(searchTerms(query), [room]), JSON.stringify(query)).resolves.toBeInstanceOf(Array);
      expect((await searchAs(jason.session, query)).status, JSON.stringify(query)).toBe(200);
    }
    expect(await found(jason.session, "NOT eel")).toEqual([message.id]);
    expect(await found(jason.session, "eel dolphin")).toEqual([]);
    expect(await found(jason.session, "eel\0shark")).toEqual([message.id]);
    expect(await found(jason.session, '"feed" OR (shark*)')).toEqual([message.id]);
    expect(await found(jason.session, "feed NEAR(shark)")).toEqual([]);
  });

  it("answers what it searched for, punctuation turned to spaces, and nothing for a search with no words", async () => {
    const room = await freshRoom("queries");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "hello world");
    await indexed(room);
    expect(await resultsFor(ada.session, "hello, world!")).toMatchObject({ query: "hello  world ", messages: [{ id: message.id }] });
    for (const q of ["", "   ", "!!!", "😀 ❤"]) expect(await resultsFor(ada.session, q), JSON.stringify(q)).toEqual({ query: null, messages: [], rooms: [], recent: [] });
    expect(await resultsFor(ada.session, "dolphin")).toEqual({ query: "dolphin", messages: [], rooms: [], recent: [] });
  });

  it("finds a message by its plain text, not its markup", async () => {
    const room = await freshRoom("markup");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "<p><span>My hovercraft</span> is <strong>full</strong> of eels</p>");
    await indexed(room);
    expect(await found(ada.session, "span")).toEqual([]);
    expect(await found(ada.session, "strong")).toEqual([]);
    expect(await found(ada.session, "hovercraft full eels")).toEqual([message.id]);
  });

  it("finds a file message by its file's name, its plain text, and answers it with its file", async () => {
    const room = await freshRoom("files");
    const ada = await connect(room, "Ada");
    const message = await upload(ada.session, room, "Moon landing.jpg", recordedImage("moon-thumb.jpg"));
    await indexed(room);
    expect((await resultsFor(ada.session, "landing")).messages).toEqual([message]);
  });

  it("lists its matches oldest first, as they were written", async () => {
    const room = await freshRoom("cats");
    const ada = await connect(room, "Ada");
    const ids: string[] = [];
    for (const body of ["first cat", "second cat", "third cat", "cat cat cat"]) ids.push((await post(ada, body)).id);
    await indexed(room);
    expect(await found(ada.session, "cat")).toEqual(ids);
  });

  it("finds only messages in the rooms the searcher is in, the ones they've hidden and DMs too, and answers those rooms", async () => {
    const [ada, bender, cat] = [await signIn("Ada"), await signIn("Bender"), await signIn("Cat")];
    const open = await freshRoom("open");
    const closed = await createRoom("closed", { closedTo: [ada.user.id, cat.user.id] });
    const dm = await direct(ada, cat);
    const posted: Message[] = [];
    for (const [room, body] of [
      [open, "hovercraft in the open"],
      [closed.id, "hovercraft behind doors"],
      [dm.id, "hovercraft between us"],
    ] as const) {
      const client = await connect(room, ada);
      posted.push(await post(client, body));
      client.close();
      await indexed(room);
    }
    await workspaceSql("UPDATE memberships SET involvement = 'invisible' WHERE room_id = ? AND user_id = ?", closed.id, ada.user.id);

    const results = await resultsFor(ada, "hovercraft");
    expect(results.messages.map(({ id }) => id)).toEqual(posted.map(({ id }) => id));
    expect(results.rooms.map(({ id }) => id).sort()).toEqual([open, closed.id, dm.id].sort());
    expect(results.rooms.find(({ id }) => id === dm.id)).toMatchObject({ kind: "direct", members: expect.arrayContaining([ada.user, cat.user]) });
    expect(results.rooms.find(({ id }) => id === closed.id)).toEqual({ id: closed.id, kind: "closed", name: "closed", icon: closed.icon });

    expect(await found(bender, "hovercraft")).toEqual([posted[0]!.id]);
    expect((await resultsFor(bender, "hovercraft")).rooms.map(({ id }) => id)).toEqual([open]);
  });

  it("finds the newest 100 matches, oldest first", async () => {
    const room = await freshRoom("aardvarks");
    const ada = await connect(room, "Ada");
    const ids: string[] = [];
    for (let n = 0; n < 105; n++) ids.push((await post(ada, `aardvark ${n}`)).id);
    await indexed(room);
    expect(await found(ada.session, "aardvark")).toEqual(ids.slice(5));

    // A search stops reading matches once its page is full, which keeps nothing from the next change or search.
    const newest = await post(ada, "aardvark 105");
    await indexed(room);
    expect(await found(ada.session, "aardvark")).toEqual([...ids.slice(6), newest.id]);
  });

  it("reads the newest matches off the index in order, with nothing to sort", async () => {
    await searchIndexStub().search('"aardvark"', []);
    const plan = (await searchSql(`EXPLAIN QUERY PLAN ${SEARCH_PROBE}`, '"aardvark"', "[]")).map((row) => (row as { detail: string }).detail).join("; ");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  it("looks in the searcher's rooms alone when newer matches elsewhere fill what it reads first", async () => {
    const room = await freshRoom("sparse");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "sparsekeyword");
    await indexed(room);
    // 1,100 newer matches in a room Ada isn't in.
    await searchSql(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1100)
       INSERT INTO search_messages (id, message_id, room_id) SELECT (SELECT max(id) FROM search_messages) + i, 'private-' || i, 'elsewhere' FROM n`,
    );
    await searchSql(`INSERT INTO search_index (rowid, body) SELECT id, 'sparsekeyword' FROM search_messages WHERE room_id = 'elsewhere'`);

    expect(await found(ada.session, "sparsekeyword")).toEqual([message.id]);
    expect(await searchIndexStub().search('"sparsekeyword"', [])).toEqual([]);
  });

  it("leaves out a match whose message its room no longer has", async () => {
    const room = await freshRoom("stale");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "quince jam");
    await indexed(room);
    await searchSql("INSERT INTO search_messages (id, message_id, room_id) VALUES ((SELECT max(id) + 1 FROM search_messages), 'gone', ?)", room);
    await searchSql("INSERT INTO search_index (rowid, body) SELECT id, 'quince tart' FROM search_messages WHERE message_id = 'gone'");
    expect(await resultsFor(ada.session, "quince")).toMatchObject({ messages: [{ id: message.id }], rooms: [{ id: room }] });
    expect(await resultsFor(ada.session, "tart")).toEqual({ query: "tart", messages: [], rooms: [], recent: [] });
  });

  it("shows each match as the index last took it, boosts and all, asking no room", async () => {
    const room = await freshRoom("kept");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "elderflower cordial");
    ada.send({ type: "boost.create", messageId: message.id, content: "🍋" });
    const { boost } = await ada.next("boost.created");
    await indexed(room);
    expect((await resultsFor(ada.session, "elderflower")).messages).toMatchObject([{ id: message.id, body: message.body, boosts: [{ id: boost.id, content: "🍋" }] }]);

    // Its room's copy changed behind its back, so the index hasn't heard of it.
    await roomSql(room, "UPDATE messages SET body = '<p>changed</p>' WHERE id = ?", message.id);
    expect((await resultsFor(ada.session, "elderflower")).messages).toMatchObject([{ body: message.body }]);

    // Taking the boost away sends the message again, as its room has it now.
    ada.send({ type: "boost.delete", boostId: boost.id });
    await ada.next("boost.deleted");
    await indexed(room);
    expect((await resultsFor(ada.session, "elderflower")).messages).toMatchObject([{ body: "<p>changed</p>", boosts: [] }]);
  });

  it("reads a match the index took before it kept messages from its room, as it is now", async () => {
    const room = await freshRoom("unkept");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "damson preserve");
    await indexed(room);
    await searchSql("UPDATE search_messages SET message = NULL");
    await roomSql(room, "UPDATE messages SET body = '<p>damson preserve, now</p>' WHERE id = ?", message.id);
    expect((await resultsFor(ada.session, "damson")).messages).toMatchObject([{ id: message.id, body: "<p>damson preserve, now</p>" }]);
  });

  it("keeps no message too big for the index's row, and reads that one from its room", async () => {
    const room = await freshRoom("big");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "quince paste");
    await indexed(room);
    // Bigger than a message's text may be, as a bot's cards can make one.
    const big = `<p>quince paste${" and more".repeat(70_000)}</p>`;
    await roomSql(room, "UPDATE messages SET body = ? WHERE id = ?", big, message.id);
    await roomStub(room).reindex(room);
    await runRoomAlarm(room);
    await indexed(room);
    expect(await searchSql("SELECT message IS NULL AS unkept FROM search_messages WHERE message_id = ?", message.id)).toEqual([{ unkept: 1 }]);
    expect((await resultsFor(ada.session, "quince")).messages).toMatchObject([{ id: message.id, body: big }]);
  });

  it("has every room index its messages again once the index keeps what results show", async () => {
    const room = await freshRoom("again");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "medlar jelly");
    await indexed(room);
    await searchSql("UPDATE search_messages SET message = NULL");

    await workspaceSql(MIGRATIONS.find(({ name }) => name === "0040_search_results.sql")!.sql);
    expect(await workspaceSql("SELECT room_id FROM pending_reindexes")).toContainEqual({ room_id: room });
    await runInDurableObject(workspaceStub(), (instance: Workspace) => instance.alarm());
    await runRoomAlarm(room);
    await indexed(room);
    expect(await searchSql("SELECT message IS NOT NULL AS kept FROM search_messages WHERE message_id = ?", message.id)).toEqual([{ kept: 1 }]);
  });

  it("takes each room's changes in order, so a call that arrives late changes nothing, and numbers messages by when they were written", async () => {
    const index = searchIndexStub();
    const at = (time: string, id: string, text: string): IndexedMessage => ({ id, createdAt: `2026-10-16T${time}Z`, text, message: JSON.stringify({ text }) });
    const hits = async (terms: string, roomIds: RoomId[]) => (await index.search(terms, roomIds)).map(({ messageId, roomId }) => ({ messageId, roomId }));
    await index.apply("room-a", 2, [at("10:00:01.000", "later", "pear newer")], []);
    await index.apply("room-a", 1, [at("10:00:01.000", "later", "pear older")], []);
    expect(await index.search('"newer"', ["room-a"])).toEqual([{ messageId: "later", roomId: "room-a", message: JSON.stringify({ text: "pear newer" }) }]);
    expect(await index.search('"older"', ["room-a"])).toEqual([]);

    // Heard of after the later one, and from another room, but written before it, as in the same millisecond.
    await index.apply("room-b", 1, [at("10:00:00.000", "earlier", "pear"), at("10:00:01.000", "same-b", "pear"), at("10:00:01.000", "same-a", "pear")], []);
    expect(await hits('"pear"', ["room-a", "room-b"])).toEqual([
      { messageId: "same-b", roomId: "room-b" },
      { messageId: "same-a", roomId: "room-b" },
      { messageId: "later", roomId: "room-a" },
      { messageId: "earlier", roomId: "room-b" },
    ]);

    // An edit keeps its number, and what results show of it, and a deletion takes it out.
    await index.apply("room-b", 2, [at("10:00:00.000", "earlier", "pear edited")], ["same-a"]);
    expect(await hits('"pear"', ["room-a", "room-b"])).toEqual([
      { messageId: "same-b", roomId: "room-b" },
      { messageId: "later", roomId: "room-a" },
      { messageId: "earlier", roomId: "room-b" },
    ]);
    expect((await index.search('"edited"', ["room-b"]))[0]?.message).toBe(JSON.stringify({ text: "pear edited" }));
  });

  it("forgets a deleted room's messages, and takes nothing more from it", async () => {
    const ada = await signIn("Ada");
    const room = (await createRoom("doomed", { as: ada })).id;
    const client = await connect(room, ada);
    const message = await post(client, "kumquat");
    await indexed(room);
    expect(await found(ada, "kumquat")).toEqual([message.id]);

    const response = await api(`/api/rooms/${room}`, { method: "DELETE", headers: { Cookie: ada.cookie } });
    expect(response.status).toBe(204);
    await vi.waitFor(async () => expect(await searchSql("SELECT seq FROM search_rooms WHERE room_id = ?", room)).toEqual([{ seq: Number.MAX_SAFE_INTEGER }]), {
      timeout: 5_000,
    });
    expect(await searchSql("SELECT count(*) AS n FROM search_messages WHERE room_id = ?", room)).toEqual([{ n: 0 }]);
    expect(await searchSql("SELECT count(*) AS n FROM search_index WHERE search_index MATCH 'kumquat'")).toEqual([{ n: 0 }]);

    // A call the room made before it was deleted, arriving after.
    await searchIndexStub().apply(room, 1_000, [{ id: message.id, createdAt: message.createdAt, text: "kumquat", message: "{}" }], []);
    expect(await searchSql("SELECT count(*) AS n FROM search_messages WHERE room_id = ?", room)).toEqual([{ n: 0 }]);
  });

  it("forgets a deleted room's messages a batch at a time, taking nothing more from the room from the first", async () => {
    const indexing = (seq: number, ids: string[]) =>
      searchIndexStub().apply(
        "doomed",
        seq,
        ids.map((id, i) => ({ id, createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(), text: "kumquat", message: "{}" })),
        [],
      );
    const left = async () => ((await searchSql("SELECT count(*) AS n FROM search_messages WHERE room_id = 'doomed'")) as [{ n: number }])[0].n;
    await indexing(1, ["a", "b", "c", "d", "e"]);

    expect(await searchIndexStub().forget("doomed", 2)).toBe(true);
    expect(await left()).toBe(3);
    // A call the room made before it was deleted, arriving between batches.
    await indexing(2, ["f"]);
    expect(await left()).toBe(3);
    expect(await searchIndexStub().forget("doomed", 2)).toBe(true);
    expect(await searchIndexStub().forget("doomed", 2)).toBe(false);
    expect(await left()).toBe(0);
    expect(await searchSql("SELECT count(*) AS n FROM search_index WHERE search_index MATCH 'kumquat'")).toEqual([{ n: 0 }]);
  });

  it("drops a banned person's messages as their room deletes them", async () => {
    const room = await freshRoom("purged");
    const ada = await connect(room, "Ada");
    const bender = await connect(room, "Bender");
    const kept = await post(ada, "bite my shiny metal");
    await post(bender, "bite my shiny metal");
    await indexed(room);
    expect(await found(ada.session, "shiny")).toHaveLength(2);

    expect(await roomStub(room).removeMessagesBy(room, bender.me.id, 100, null)).toBe(false);
    await indexed(room);
    expect(await found(ada.session, "shiny")).toEqual([kept.id]);
  });

  it("keeps a room's messages for the index while it can't be reached, without holding up its unread marks, and sends them once it can", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const room = await freshRoom("index-away");
    const ada = await connect(room, "Ada");
    const hopper = await signIn("Hopper");
    const reconnect = await cutOff(room);
    const message = await post(ada, "while the index is away");

    await vi.waitFor(async () => expect(await runInDurableObject(roomStub(room), (_room, state: DurableObjectState) => state.storage.getAlarm())).not.toBeNull(), {
      timeout: 5_000,
    });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("search index; trying again later"), expect.any(Error));
    // The Workspace heard of the message meanwhile, and marked the room unread.
    await vi.waitFor(async () => expect(await workspaceSql("SELECT unread_at FROM memberships WHERE room_id = ? AND user_id = ?", room, hopper.user.id)).not.toEqual([{ unread_at: null }]));
    expect(await found(ada.session, "away")).toEqual([]);

    await reconnect();
    await runRoomAlarm(room);
    await indexed(room);
    expect(await found(ada.session, "away")).toEqual([message.id]);
  });

  it("indexes the messages rooms had before the index once the Workspace asks, each by when it was written", async () => {
    const room = await freshRoom("before");
    const ada = await connect(room, "Ada");
    const newer = await post(ada, "persimmon today");
    await indexed(room);
    // A message from long ago, and an index that has never heard of either.
    await roomSql(
      room,
      `INSERT INTO messages (id, room_id, client_message_id, creator_id, creator_name, body, plain_text, created_at, updated_at)
       VALUES ('old', ?, 'c-old', ?, 'Ada', '<p>persimmon long ago</p>', 'persimmon long ago', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
      room,
      ada.me.id,
    );
    await emptyIndex();
    await workspaceSql("INSERT INTO pending_reindexes (room_id, due_at) VALUES (?, 0)", room);

    await runInDurableObject(workspaceStub(), (instance: Workspace) => instance.alarm());
    expect(await workspaceSql("SELECT count(*) AS n FROM pending_reindexes")).toEqual([{ n: 0 }]);
    await runRoomAlarm(room);
    await indexed(room);
    expect(await found(ada.session, "persimmon")).toEqual(["old", newer.id]);
  });

  it("asks a room that can't be reached to index its messages again later", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const room = await freshRoom("unreachable");
    await workspaceSql("INSERT INTO pending_reindexes (room_id, due_at) VALUES (?, 0)", room);
    await runInDurableObject(workspaceStub(), async (instance: Workspace) => {
      const object = instance as unknown as { env: Env };
      const original = object.env;
      const unreachable = { reindex: () => Promise.reject(new Error("The room is unreachable")) };
      object.env = { ...original, CHAT_ROOM: { getByName: () => unreachable } as unknown as Env["CHAT_ROOM"] };
      try {
        await instance.alarm();
      } finally {
        object.env = original;
      }
    });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("trying again later"), expect.any(Error));
    const [row] = (await workspaceSql("SELECT attempts, due_at FROM pending_reindexes WHERE room_id = ?", room)) as Array<{ attempts: number; due_at: number }>;
    expect(row!.attempts).toBe(1);
    expect(row!.due_at).toBeGreaterThan(Date.now());
  });

  it("is only for people signed in, and takes searches of up to 1,000 characters", async () => {
    expect((await searchAs(null, "eel")).status).toBe(401);
    const ada = await signIn("Ada");
    expect((await searchAs(ada, "e".repeat(MAX_SEARCH_LENGTH))).status).toBe(200);
    const tooLong = await searchAs(ada, "e".repeat(MAX_SEARCH_LENGTH + 1));
    expect(tooLong.status).toBe(422);
    expect(await tooLong.json()).toEqual({ error: SEARCH_TOO_LONG });
    expect((await searchAs(ada, "eel")).headers.get("Cache-Control")).toBe("no-store");
  });
});

describe(feature("search.recent"), () => {
  it("records a search, punctuation turned to spaces, and answers what it finds with your recent searches, newest first", async () => {
    const room = await freshRoom("greetings");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "hello world");
    await indexed(room);
    const response = await record(ada.session, { q: "hello, world" });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ query: "hello  world", messages: [{ id: message.id }], rooms: [{ id: room }], recent: ["hello  world"] });
    expect(await (await record(ada.session, { q: "dolphin" })).json()).toEqual({ query: "dolphin", messages: [], rooms: [], recent: ["dolphin", "hello  world"] });
    // Searching other than with the search page's form, as following a recent search does, records nothing.
    expect(await resultsFor(ada.session, "hello  world")).toMatchObject({ messages: [{ id: message.id }], recent: ["dolphin", "hello  world"] });
  });

  it("keeps your newest 10, moving a search made again to the front, and tells searches that differ in case apart", async () => {
    const ada = await signIn("Ada");
    for (let n = 1; n <= 12; n++) expect((await record(ada, { q: `search ${n}` })).status).toBe(200);
    const newest = Array.from({ length: 10 }, (_, i) => `search ${12 - i}`);
    expect(await recentOf(ada)).toEqual(newest);
    expect(await storedSearches(ada.user.id)).toEqual(newest);

    await record(ada, { q: "search 5" });
    expect(await recentOf(ada)).toEqual(["search 5", ...newest.filter((q) => q !== "search 5")]);
    await record(ada, { q: "Search 5" });
    expect(await recentOf(ada)).toEqual(["Search 5", "search 5", ...newest.filter((q) => q !== "search 5").slice(0, 8)]);
    expect(await storedSearches(ada.user.id)).toHaveLength(10);
  });

  it("doesn't record a search with no words, nor one it refuses", async () => {
    const ada = await signIn("Ada");
    for (const q of ["", "   ", "!!!"]) expect(await (await record(ada, { q })).json(), JSON.stringify(q)).toEqual({ query: null, messages: [], rooms: [], recent: [] });
    for (const body of [{ q: 5 }, { q: null }, { q: ["eel"] }, {}, [], "eel", "{"]) {
      const response = await record(ada, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect(await response.json()).toEqual({ error: "Searches have to be text" });
    }
    const tooLong = await record(ada, { q: "e".repeat(MAX_SEARCH_LENGTH + 1) });
    expect(tooLong.status).toBe(422);
    expect(await tooLong.json()).toEqual({ error: SEARCH_TOO_LONG });
    expect(await storedSearches(ada.user.id)).toEqual([]);
    expect((await record(ada, { q: "e".repeat(MAX_SEARCH_LENGTH) })).status).toBe(200);
    expect(await recentOf(ada)).toEqual(["e".repeat(MAX_SEARCH_LENGTH)]);
  });

  it("keeps each person's own, and clears them", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    await record(ada, { q: "eels" });
    await record(grace, { q: "sharks" });
    expect(await recentOf(ada)).toEqual(["eels"]);
    expect(await recentOf(grace)).toEqual(["sharks"]);

    const cleared = await clear(ada);
    expect(cleared.status).toBe(204);
    expect(await cleared.text()).toBe("");
    expect(await recentOf(ada)).toEqual([]);
    expect(await recentOf(grace)).toEqual(["sharks"]);
    expect((await clear(ada)).status).toBe(204);
  });

  it("is only for people signed in, which it checks first", async () => {
    expect((await record(null, { q: "eels" })).status).toBe(401);
    expect((await record(null, { q: 5 })).status).toBe(401);
    expect((await record(null, { q: "e".repeat(MAX_SEARCH_LENGTH + 1) })).status).toBe(401);
    expect((await clear(null)).status).toBe(401);
    expect(await workspaceSql("SELECT count(*) AS n FROM searches")).toEqual([{ n: 0 }]);
  });

  it("forgets a removed person's searches, and keeps a banned person's", async () => {
    const setUp = await api("/api/first_run", { method: "POST", body: JSON.stringify({ name: "Ada", emailAddress: "ada@example.com", password: "analytical engine" }) });
    expect(setUp.status).toBe(201);
    const administrator = { user: shown(((await setUp.json()) as NewWorkspace).user), cookie: cookieOf(setUp) };
    const [{ join_code: joinCode }] = (await workspaceSql("SELECT join_code FROM accounts")) as [{ join_code: string }];
    const join = async (name: string) => {
      const response = await api(`/api/join/${joinCode}`, { method: "POST", body: JSON.stringify({ name, emailAddress: `${name}@example.com`, password: "compiler design" }) });
      expect(response.status, await response.clone().text()).toBe(201);
      return { user: shown(((await response.json()) as { user: Me }).user), cookie: cookieOf(response) };
    };
    const grace = await join("grace");
    const linus = await join("linus");
    for (const session of [administrator, grace, linus]) await record(session, { q: "eels" });

    expect((await api(`/api/account/users/${grace.user.id}`, { method: "DELETE", headers: { Cookie: administrator.cookie } })).status).toBe(200);
    expect((await api(`/api/users/${linus.user.id}/ban`, { method: "POST", headers: { Cookie: administrator.cookie } })).status).toBe(200);
    expect(await storedSearches(grace.user.id)).toEqual([]);
    expect(await storedSearches(linus.user.id)).toEqual(["eels"]);
    expect(await recentOf(administrator)).toEqual(["eels"]);
  });
});
