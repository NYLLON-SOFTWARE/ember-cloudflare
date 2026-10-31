import type { Boost, Message, ServerFrame, User } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { isPending, type PendingMessage } from "./room-state";
import { initialThreadState, threadReducer, type ThreadState } from "./thread-state";

const ada: User = { id: "u1", name: "Ada" };
const grace: User = { id: "u2", name: "Grace" };
const message = (overrides: Partial<Message> = {}): Message => ({
  id: "m1",
  clientMessageId: "c1",
  roomId: "general",
  creator: ada,
  body: "hi",
  plainText: "hi",
  mentions: [],
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  editedAt: null,
  boosts: [],
  ...overrides,
});

const parent = message();
/** A reply in m1's thread. */
const reply = (id: string, overrides: Partial<Message> = {}) => message({ id, clientMessageId: `c-${id}`, creator: grace, parentId: "m1", alsoSent: false, ...overrides });
const boost = (id: string, messageId: string): Boost => ({ id, messageId, booster: ada, content: "👍", createdAt: "" });

const frame = (state: ThreadState, f: ServerFrame) => threadReducer(state, { type: "frame", frame: f, now: 0 });
/** The room answering thread.open for m1 with `replies`, its newest unless `hasMore`. */
const opened = (state: ThreadState, replies: Message[], { hasMore = false, of = parent as Message | null } = {}) =>
  frame(state, { type: "thread.opened", parentId: "m1", parent: of, messages: replies, hasMore });
const ids = (state: ThreadState) => state.replies.messages.map((m) => m.id);

describe("Open a thread", () => {
  it("shows the message and its newest replies, at their end", () => {
    const state = opened(initialThreadState({ parentId: "m1" }), [reply("r1"), reply("r2")]);
    expect(state.parent).toEqual(parent);
    expect(ids(state)).toEqual(["r1", "r2"]);
    expect(state.replies.status).toBe("open");
    expect(state.replies.focus).toEqual({ messageId: null });
  });

  it("goes to the reply its permalink names when it's among them, and to the end when it isn't", () => {
    const atReply = opened(initialThreadState({ parentId: "m1", replyId: "r1" }), [reply("r1"), reply("r2")]);
    expect(atReply.replies.focus).toEqual({ messageId: "r1" });
    const older = opened(initialThreadState({ parentId: "m1", replyId: "r0" }), [reply("r1"), reply("r2")], { hasMore: true });
    expect(older.replies.focus).toEqual({ messageId: null });
  });

  it("says the message is gone when the room has no such message", () => {
    const state = opened(initialThreadState({ parentId: "m1" }), [], { of: null });
    expect(state.parent).toBeNull();
    expect(state.replies.status).toBe("open");
  });

  it("leaves another thread's frames, and the room's own, to them", () => {
    const state = opened(initialThreadState({ parentId: "m1" }), [reply("r1")]);
    const other = message({ id: "x1", clientMessageId: "cx", parentId: "m9" });
    expect(frame(state, { type: "thread.opened", parentId: "m9", parent: message({ id: "m9" }), messages: [other], hasMore: false })).toBe(state);
    expect(frame(state, { type: "thread.history", parentId: "m9", before: "x2", messages: [other], hasMore: false })).toBe(state);
    expect(frame(state, { type: "message.created", message: other, seq: 1 })).toBe(state);
    expect(frame(state, { type: "message.created", message: message({ id: "m2", clientMessageId: "c2" }), seq: 2 })).toBe(state);
    expect(frame(state, { type: "presence.joined", user: ada })).toBe(state);
  });
});

describe("Follow a thread as it changes", () => {
  it("adds new replies, and changes or takes away those that change or go", () => {
    let state = opened(initialThreadState({ parentId: "m1" }), [reply("r1")]);
    state = frame(state, { type: "message.created", message: reply("r2"), seq: 1 });
    expect(ids(state)).toEqual(["r1", "r2"]);
    state = frame(state, { type: "message.updated", message: reply("r1", { body: "edited" }), seq: 2 });
    expect(state.replies.messages[0]!.body).toBe("edited");
    state = frame(state, { type: "message.deleted", messageId: "r2", seq: 3 });
    expect(ids(state)).toEqual(["r1"]);
  });

  it("keeps the message's changes, its reactions, and its going, after which its replies stay", () => {
    let state = opened(initialThreadState({ parentId: "m1" }), [reply("r1")]);
    state = frame(state, { type: "message.updated", message: message({ body: "edited", thread: { count: 1, latestAt: "", people: [grace] } }), seq: 1 });
    expect(state.parent!.body).toBe("edited");
    state = frame(state, { type: "boost.created", boost: boost("b1", "m1"), seq: 2 });
    expect(state.parent!.boosts.map((b) => b.id)).toEqual(["b1"]);
    state = frame(state, { type: "boost.created", boost: boost("b2", "r1"), seq: 3 });
    expect(state.replies.messages[0]!.boosts.map((b) => b.id)).toEqual(["b2"]);
    state = frame(state, { type: "boost.deleted", boostId: "b1", messageId: "m1", seq: 4 });
    expect(state.parent!.boosts).toEqual([]);

    state = frame(state, { type: "message.deleted", messageId: "m1", seq: 5 });
    expect(state.parent).toBeNull();
    expect(ids(state)).toEqual(["r1"]);
  });

  it("pages back through older replies", () => {
    let state = opened(initialThreadState({ parentId: "m1" }), [reply("r3"), reply("r4")], { hasMore: true });
    expect(state.replies.oldestId).toBe("r3");
    state = frame(state, { type: "thread.history", parentId: "m1", before: "r3", messages: [reply("r1"), reply("r2")], hasMore: false });
    expect(ids(state)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(state.replies.hasMore).toBe(false);
  });

  it("keeps the reader's place as the room lets the page in again, catching up with what changed while it was away", () => {
    let state = opened(initialThreadState({ parentId: "m1" }), [reply("r1"), reply("r2"), reply("r3")]);
    state = threadReducer(state, { type: "focus", messageId: "r2" });
    state = threadReducer(state, { type: "status", status: "reconnecting" });
    state = opened(state, [reply("r1"), reply("r3", { body: "edited" }), reply("r4")]);
    expect(ids(state)).toEqual(["r1", "r3", "r4"]);
    expect(state.replies.messages[1]!.body).toBe("edited");
    expect(state.replies.focus).toEqual({ messageId: "r2" });
    expect(state.replies.status).toBe("open");

    // Replies older than the newest page aren't in it, so they stay.
    state = opened(state, [reply("r4"), reply("r5")], { hasMore: true });
    expect(ids(state)).toEqual(["r1", "r3", "r4", "r5"]);
  });
});

describe("Reply in a thread", () => {
  const sending = (id: string): PendingMessage => ({ ...reply(id, { id, clientMessageId: id }), pending: true });

  it("shows a reply as sending until the room has it, and as not sent if the room refuses it", () => {
    let state = opened(initialThreadState({ parentId: "m1" }), [reply("r1")]);
    state = threadReducer(state, { type: "pending", message: sending("c2") });
    expect(state.replies.messages.map((m) => [m.id, isPending(m)])).toEqual([
      ["r1", false],
      ["c2", true],
    ]);
    state = frame(state, { type: "message.created", message: reply("r2", { clientMessageId: "c2" }), seq: 1 });
    expect(state.replies.messages.map((m) => [m.id, isPending(m)])).toEqual([
      ["r1", false],
      ["r2", false],
    ]);

    state = threadReducer(state, { type: "pending", message: sending("c3") });
    state = frame(state, { type: "error", message: "That message no longer exists", clientMessageId: "c3", failed: "message.create" });
    const refused = state.replies.messages[2] as PendingMessage;
    expect(refused.failed).toBe(true);
    expect(state.replies.notice).toBe("That message no longer exists");
  });

  it("leaves the room's own refusals to the room, and says why its replies' page didn't come, so it can be asked again", () => {
    let state = opened(initialThreadState({ parentId: "m1" }), [reply("r3")], { hasMore: true });
    expect(frame(state, { type: "error", message: "Not sent", clientMessageId: "c-room", failed: "message.create" })).toBe(state);
    expect(frame(state, { type: "error", message: "Couldn't load older messages", failed: "history.before" })).toBe(state);

    state = threadReducer(state, { type: "loading-older" });
    state = frame(state, { type: "error", message: "Couldn't load the thread", failed: "thread.before" });
    expect(state.replies.loadingOlder).toBe(false);
    expect(state.replies.notice).toBe("Couldn't load the thread");
  });

  it("brings back a reaction the room wouldn't take away, as the room does", () => {
    const state = frame(opened(initialThreadState({ parentId: "m1" }), [reply("r1")]), { type: "error", message: "Not removed", failed: "boost.delete" });
    expect(state.replies.refusedUnboosts).toBe(1);
  });
});
