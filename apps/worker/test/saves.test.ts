import type { Message, RoomId, SavedItem, SavedMessage } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { api, connect, createRoom, direct, freshDeploy, post, settle, signIn, workspaceSql, type Session } from "./support";

/** Saves the message `messageId` of room `roomId` for `session`'s person, as More actions does. */
const save = (session: Session, roomId: RoomId, messageId: string) =>
  api("/api/saves", { method: "POST", headers: { Cookie: session.cookie }, body: JSON.stringify({ roomId, messageId }) });

/** What a save answers it made. */
const saved = async (response: Promise<Response>) => {
  const settledResponse = await response;
  expect(settledResponse.status, await settledResponse.clone().text()).toBe(201);
  return ((await settledResponse.json()) as { save: SavedMessage }).save;
};

/** The saves `GET /api/saves` gives `session`'s person, newest save first. */
const savesOf = async (session: Session) => {
  const response = await api("/api/saves", { headers: { Cookie: session.cookie } });
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { saves: SavedItem[] }).saves;
};

/** Forgets `session`'s person's save `id`. */
const forget = (session: Session, id: string) => api(`/api/saves/${id}`, { method: "DELETE", headers: { Cookie: session.cookie } });

/** The saves `session`'s person has, whether or not they still answer, in the table. */
const storedSaves = async (session: Session) =>
  (await workspaceSql("SELECT id FROM saves WHERE user_id = ?", session.user.id)).map((row) => (row as { id: string }).id);

/** Posts `body` in `room` as `session`, over a socket of its own. */
async function messageIn(room: RoomId, session: Session, body: string): Promise<{ message: Message; done: () => Promise<void> }> {
  const client = await connect(room, session);
  const message = await post(client, body);
  await settle(client);
  return { message, done: async () => client.close() };
}

beforeEach(freshDeploy);

describe("Save a message for later", () => {
  it("saves a message of yours and of someone else's, answering the save, and lists it with the message as its room has it now", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const room = await createRoom("Design");
    const hers = await messageIn(room.id, ada, "Save me for later");
    const theirs = await messageIn(room.id, grace, "And me too");

    const mine = await saved(save(ada, room.id, hers.message.id));
    expect(mine).toMatchObject({ roomId: room.id, messageId: hers.message.id });
    expect(typeof mine.createdAt).toBe("number");
    await hers.done();
    const theirsSaved = await saved(save(ada, room.id, theirs.message.id));
    await theirs.done();

    const saves = await savesOf(ada);
    expect(saves.map(({ messageId }) => messageId)).toEqual([theirs.message.id, hers.message.id]);
    expect(saves[1]).toMatchObject({ id: mine.id, roomId: room.id });
    expect((saves[1] as SavedItem).message.plainText).toBe("Save me for later");
    expect((saves[0] as SavedItem).message.creator).toEqual(theirs.message.creator);
    expect(await savesOf(grace)).toEqual([]);

    // An edit shows as it is, since nothing was snapshotted.
    const editor = await connect(room.id, ada);
    editor.send({ type: "message.update", messageId: hers.message.id, body: "<p>Edited in the room</p>" });
    await editor.next("message.updated");
    await settle(editor);
    const after = await savesOf(ada);
    expect(after.map(({ messageId }) => messageId)).toEqual([theirs.message.id, hers.message.id]);
    expect((after[1] as SavedItem).message.plainText).toBe("Edited in the room");
    await editor.close();
  });

  it("answers 409, saving nothing again, for a message you've saved already", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Design");
    const { message, done } = await messageIn(room.id, ada, "Once is enough");
    await saved(save(ada, room.id, message.id));

    const again = await save(ada, room.id, message.id);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "You've saved that message already" });
    await done();
    expect(await savesOf(ada)).toHaveLength(1);
    expect(await storedSaves(ada)).toHaveLength(1);
  });

  it("answers 403, saving nothing, for a room you aren't in, however its message is named", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const secret = await createRoom("Secret", { closedTo: [grace.user.id] });
    const client = await connect(secret.id, grace);
    const message = await post(client, "A secret message");
    await settle(client);
    await client.close();

    for (const roomId of [secret.id, "no-such-room"]) {
      const refused = await save(ada, roomId, message.id);
      expect(refused.status, roomId).toBe(403);
      expect(await refused.json()).toEqual({ error: "You can save a message only from a room you're in" });
    }
    expect(await storedSaves(ada)).toEqual([]);
  });

  it("saves a reply of a DM you're in, whose room nobody joins", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const dm = await direct(ada, grace);
    const client = await connect(dm.id, grace);
    const message = await post(client, "Between us");
    await settle(client);
    await client.close();

    expect((await save(ada, dm.id, message.id)).status).toBe(201);
    expect((await savesOf(ada))[0]).toMatchObject({ roomId: dm.id });
  });

  it("answers 400 for a body it can't read, and 401 to someone signed out, whatever they send", async () => {
    const ada = await signIn("Ada");
    const room = await createRoom("Design");
    const post = (body: string) => api("/api/saves", { method: "POST", headers: { Cookie: ada.cookie }, body });
    for (const body of [JSON.stringify({ roomId: "Not a room", messageId: "m1" }), JSON.stringify({ roomId: room.id }), JSON.stringify({ messageId: "m1" }), "{}", "null", "not JSON"]) {
      const response = await post(body);
      expect(response.status, body).toBe(400);
    }
    expect(await storedSaves(ada)).toEqual([]);
    for (const body of [JSON.stringify({ roomId: room.id, messageId: "m1" }), "not JSON"]) {
      expect((await api("/api/saves", { method: "POST", body })).status).toBe(401);
    }
  });
});

describe("The Saved pane's answer", () => {
  it("drops a save whose message is deleted, from the answer and the table, in the same look", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const room = await createRoom("Design");
    const first = await messageIn(room.id, grace, "Keep me");
    const second = await messageIn(room.id, grace, "And me");
    await saved(save(ada, room.id, first.message.id));
    const kept = await saved(save(ada, room.id, second.message.id));
    await first.done();
    await second.done();

    const deleter = await connect(room.id, grace);
    deleter.send({ type: "message.delete", messageId: first.message.id });
    await deleter.next("message.deleted");
    await settle(deleter);
    await deleter.close();

    const saves = await savesOf(ada);
    expect(saves.map(({ messageId }) => messageId)).toEqual([second.message.id]);
    expect(await storedSaves(ada)).toEqual([kept.id]);
  });

  it("drops a save whose room you can no longer see, or that was deleted, the same way", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const secret = await createRoom("Secret", { closedTo: [ada.user.id, grace.user.id], as: grace });
    const gone = await createRoom("Gone", { as: grace });
    const kept = await createRoom("Kept");
    const secretMessage = await messageIn(secret.id, grace, "Not for you any more");
    const goneMessage = await messageIn(gone.id, grace, "Here today");
    const keptMessage = await messageIn(kept.id, ada, "Still yours");
    await saved(save(ada, secret.id, secretMessage.message.id));
    await saved(save(ada, gone.id, goneMessage.message.id));
    await saved(save(ada, kept.id, keptMessage.message.id));
    await secretMessage.done();
    await goneMessage.done();
    await keptMessage.done();

    const takeAdaOut = await api(`/api/rooms/${secret.id}`, {
      method: "PATCH",
      headers: { Cookie: grace.cookie },
      body: JSON.stringify({ kind: "closed", memberIds: [grace.user.id] }),
    });
    expect(takeAdaOut.status).toBe(200);
    expect((await api(`/api/rooms/${gone.id}`, { method: "DELETE", headers: { Cookie: grace.cookie } })).status).toBe(204);

    const saves = await savesOf(ada);
    expect(saves.map(({ messageId }) => messageId)).toEqual([keptMessage.message.id]);
    expect(await storedSaves(ada)).toHaveLength(1);
  });
});

describe("Forget a save", () => {
  it("forgets yours, answering 204, and then says there's none", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const room = await createRoom("Design");
    const { message, done } = await messageIn(room.id, grace, "For a while");
    const mine = await saved(save(ada, room.id, message.id));
    const theirs = await saved(save(grace, room.id, message.id));
    await done();

    expect((await forget(ada, mine.id)).status).toBe(204);
    expect((await forget(ada, mine.id)).status).toBe(404);
    // Another person's save isn't ada's to forget.
    expect((await forget(ada, theirs.id)).status).toBe(404);
    expect(await savesOf(ada)).toEqual([]);
    expect(await savesOf(grace)).toHaveLength(1);
    expect(await storedSaves(ada)).toEqual([]);
  });

  it("answers 401 to someone signed out", async () => {
    expect((await api("/api/saves/whatever", { method: "DELETE" })).status).toBe(401);
    expect((await api("/api/saves", { method: "GET" })).status).toBe(401);
  });
});
