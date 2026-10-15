import { feature } from "@ember/parity";
import type { Message, User } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { timeline } from "./messages";
import { initialRoomState, isPending, roomReducer, WELCOME_CARD_MESSAGES, type RoomState } from "./room-state";

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

const frame = (state: RoomState, f: Parameters<typeof roomReducer>[1] & { type: "frame" }) => roomReducer(state, f);

describe(feature("messages.optimistic"), () => {
  it("replaces an optimistic message with the stored one", () => {
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message({ id: "c1" }), pending: true } });
    state = frame(state, { type: "frame", frame: { type: "message.created", message: message(), seq: 1 }, now: 0 });
    expect(state.messages).toHaveLength(1);
    expect(isPending(state.messages[0]!)).toBe(false);
    expect(state.messages[0]!.id).toBe("m1");
  });

  it("ends quick sends in the order they were sent, under one header", () => {
    let state = initialRoomState;
    for (const id of ["c1", "c2", "c3"]) state = roomReducer(state, { type: "pending", message: { ...message({ id, clientMessageId: id, body: id }), pending: true } });
    for (const id of ["c1", "c2", "c3"]) {
      state = frame(state, { type: "frame", frame: { type: "message.created", message: message({ id: `m-${id}`, clientMessageId: id, body: id }), seq: 1 }, now: 0 });
    }
    expect(state.messages.map((m) => [m.body, isPending(m)])).toEqual([
      ["c1", false],
      ["c2", false],
      ["c3", false],
    ]);
    expect(timeline(state.messages).map((item) => item.threaded)).toEqual([false, true, true]);
  });

  it("keeps quick sends under one header when the room confirms them out of order", () => {
    let state = initialRoomState;
    for (const id of ["c1", "c2", "c3"]) state = roomReducer(state, { type: "pending", message: { ...message({ id, clientMessageId: id, body: id }), pending: true } });
    for (const id of ["c3", "c1", "c2"]) {
      state = frame(state, { type: "frame", frame: { type: "message.created", message: message({ id: `m-${id}`, clientMessageId: id, body: id }), seq: 1 }, now: 0 });
      expect(timeline(state.messages).map((item) => item.threaded)).toEqual([false, true, true]);
    }
    // Each stored copy replaces its own pending one, in the order the room stored them, as everyone else sees them.
    expect(state.messages.map((m) => [m.body, isPending(m)])).toEqual([
      ["c3", false],
      ["c1", false],
      ["c2", false],
    ]);
  });

  it("puts a confirmed message after the ones the room stored before it", () => {
    const grace: User = { id: "u2", name: "Grace" };
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message({ id: "c1" }), pending: true } });
    // Grace's message reached the room first, so the room announces it before confirming Ada's.
    state = frame(state, { type: "frame", frame: { type: "message.created", message: message({ id: "g1", clientMessageId: "g1", creator: grace }), seq: 1 }, now: 0 });
    state = frame(state, { type: "frame", frame: { type: "message.created", message: message({ id: "m2" }), seq: 1 }, now: 0 });
    expect(state.messages.map((m) => [m.creator.name, m.id, isPending(m)])).toEqual([
      ["Grace", "g1", false],
      ["Ada", "m2", false],
    ]);
  });

  it("only reconciles a stored message with its own sender's optimistic copy", () => {
    const grace: User = { id: "u2", name: "Grace" };
    let state = frame(initialRoomState, { type: "frame", frame: { type: "message.created", message: message(), seq: 1 }, now: 0 });
    state = roomReducer(state, { type: "pending", message: { ...message({ id: "c2", clientMessageId: "c2", body: "mine" }), pending: true } });

    // Grace reuses the clientMessageIds she can see: neither Ada's stored nor her pending message is replaced.
    for (const clientMessageId of ["c1", "c2"]) {
      const copy = message({ id: `g-${clientMessageId}`, clientMessageId, creator: grace, body: "spoof" });
      state = frame(state, { type: "frame", frame: { type: "message.created", message: copy, seq: 1 }, now: 0 });
    }
    expect(state.messages.map((m) => [m.creator.name, m.body])).toEqual([
      ["Ada", "hi"],
      ["Ada", "mine"],
      ["Grace", "spoof"],
      ["Grace", "spoof"],
    ]);

    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: state.messages.filter((m) => !isPending(m)), present: [ada], hasMore: false, seq: 0 }, now: 0 });
    expect(state.messages.find((m) => m.clientMessageId === "c2" && m.creator.id === ada.id)).toMatchObject({ pending: true });
  });

  it("marks a refused message as failed", () => {
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message(), pending: true } });
    state = frame(state, { type: "frame", frame: { type: "error", message: "nope", clientMessageId: "c1" }, now: 0 });
    expect(state.messages[0]).toMatchObject({ failed: true });
    expect(state.notice).toBe("nope");
  });
});

describe(feature("realtime.reconnect"), () => {
  /** A room of `ids`, all loaded, oldest first, with older history to page to. */
  const loaded = (...ids: string[]) =>
    frame(initialRoomState, { type: "frame", frame: { type: "welcome", you: ada, messages: ids.map((id) => message({ id, clientMessageId: id })), present: [ada], hasMore: true, seq: 1 }, now: 0 });
  const resumed = (state: RoomState, messages: Message[], deletedIds: string[] = []) =>
    frame(state, { type: "frame", frame: { type: "resumed", you: ada, messages, deletedIds, present: [ada, grace], seq: 2 }, now: 0 });

  it("catches up on what changed while it was away, keeping the messages loaded, older pages included", () => {
    let state = loaded("m2", "m3", "m4", "m5");
    state = frame(state, { type: "frame", frame: { type: "typing", user: grace, typing: true }, now: 0 });
    const untouched = state.messages[3];
    state = resumed(state, [message({ id: "m3", clientMessageId: "m3", body: "edited" }), message({ id: "m6", clientMessageId: "m6", creator: grace })], ["m4"]);

    expect(state.messages.map((m) => [m.id, m.body])).toEqual([
      ["m2", "hi"],
      ["m3", "edited"],
      ["m5", "hi"],
      ["m6", "hi"],
    ]);
    // A message that didn't change keeps its object, so its row doesn't render again.
    expect(state.messages[2]).toBe(untouched);
    expect(state).toMatchObject({ status: "open", hasMore: true, present: [ada, grace], typing: {}, loadingOlder: false });
  });

  it("counts the times the room lets the page in, so changes sent before the last can show as maybe lost", () => {
    expect(initialRoomState.connections).toBe(0);
    let state = loaded("m1");
    expect(state.connections).toBe(1);
    state = resumed(state, []);
    expect(state.connections).toBe(2);
    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, seq: 3 }, now: 0 });
    expect(state.connections).toBe(3);
  });

  it("leaves a changed message older than every one loaded for history to bring, and ignores ids it doesn't hold", () => {
    let state = loaded("m3", "m4");
    state = resumed(state, [message({ id: "m1", clientMessageId: "m1", body: "edited" }), message({ id: "m5", clientMessageId: "m5" })], ["m2", "gone-before-it-came"]);
    expect(state.messages.map((m) => m.id)).toEqual(["m3", "m4", "m5"]);
  });

  it("leaves a changed message older than every one the room sent for history to bring, even once they're all deleted", () => {
    let state = loaded("m3", "m4");
    for (const messageId of ["m3", "m4"]) state = frame(state, { type: "frame", frame: { type: "message.deleted", messageId, seq: 1 }, now: 0 });
    state = resumed(state, [message({ id: "m1", clientMessageId: "m1", body: "edited" }), message({ id: "m5", clientMessageId: "m5" })]);
    expect(state.messages.map((m) => m.id)).toEqual(["m5"]);
    expect(state.oldestId).toBe("m3");
  });

  it("swaps in the room's copies of messages sent before the drop, in their places, keeping the rest as sending until the room says", () => {
    let state = loaded("m1");
    for (const id of ["c2", "c3"]) state = roomReducer(state, { type: "pending", message: { ...message({ id, clientMessageId: id }), pending: true } });
    state = roomReducer(state, { type: "pending", message: { ...message({ id: "c4", clientMessageId: "c4" }), pending: true, queued: true } });
    // Grace's message arrived first.
    state = resumed(state, [message({ id: "m2", clientMessageId: "g1", creator: grace }), message({ id: "m3", clientMessageId: "c2" })]);

    expect(state.messages.map((m) => [m.id, isPending(m) ? (m.failed ? "not sent" : "sending") : "stored"])).toEqual([
      ["m1", "stored"],
      ["m2", "stored"],
      ["m3", "stored"],
      // The room is asked about it, since a welcome before may have left it out of its page.
      ["c3", "sending"],
      // Written while it was away, so it goes now.
      ["c4", "sending"],
    ]);
    expect(state.notice).toBeNull();
  });

  it("keeps unconfirmed messages across a reconnect, the sent ones as sending until the room answers", () => {
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message({ id: "c2", clientMessageId: "c2" }), pending: true } });
    state = roomReducer(state, { type: "pending", message: { ...message({ id: "c3", clientMessageId: "c3" }), pending: true, failed: true } });
    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: [message()], present: [ada], hasMore: false, seq: 0 }, now: 0 });
    expect(state.messages.map((m) => m.clientMessageId)).toEqual(["c1", "c2", "c3"]);
    expect(state.messages[1]).toMatchObject({ pending: true });
    expect(state.messages[1]).not.toHaveProperty("failed");
    expect(state.messages[2]).toMatchObject({ pending: true, failed: true });
    expect(state.status).toBe("open");
  });

  it("drops checked messages the room stored, and shows the ones it never received as not sent", () => {
    let state = initialRoomState;
    for (const id of ["c2", "c3", "c4"]) {
      state = roomReducer(state, { type: "pending", message: { ...message({ id, clientMessageId: id }), pending: true } });
    }
    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: [message()], present: [ada], hasMore: true, seq: 0 }, now: 0 });
    // Sent after the reconnect, so the check isn't about it.
    state = roomReducer(state, { type: "pending", message: { ...message({ id: "c5", clientMessageId: "c5" }), pending: true } });

    state = frame(state, { type: "frame", frame: { type: "message.checked", stored: ["c2", "c3"], missing: ["c4"] }, now: 0 });
    expect(state.messages.map((m) => [m.clientMessageId, isPending(m) && m.failed === true])).toEqual([
      ["c1", false],
      ["c4", true],
      ["c5", false],
    ]);
    expect(state.notice).toBe("Your messages were sent. Scroll up to see them.");
  });

  it("shows the messages a failed check was about as not sent, and no others", () => {
    let state = initialRoomState;
    for (const id of ["c2", "c3"]) {
      state = roomReducer(state, { type: "pending", message: { ...message({ id, clientMessageId: id }), pending: true } });
    }
    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: [message()], present: [ada], hasMore: true, seq: 0 }, now: 0 });
    state = roomReducer(state, { type: "pending", message: { ...message({ id: "c4", clientMessageId: "c4" }), pending: true } });

    // c2 and c3 went in separate checks, and only c2's failed.
    state = frame(state, { type: "frame", frame: { type: "error", message: "Something went wrong", failed: "message.check", clientMessageIds: ["c2"] }, now: 0 });
    expect(state.messages.map((m) => [m.clientMessageId, isPending(m) && m.failed === true])).toEqual([
      ["c1", false],
      ["c2", true],
      ["c3", false],
      ["c4", false],
    ]);
    state = frame(state, { type: "frame", frame: { type: "message.checked", stored: ["c3"], missing: [] }, now: 0 });
    expect(state.messages.map((m) => m.clientMessageId)).toEqual(["c1", "c2", "c4"]);
  });

  it("keeps messages written without a connection as sending, and as waiting until they're sent", () => {
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message({ id: "c1" }), pending: true, queued: true } });
    state = roomReducer(state, { type: "pending", message: { ...message({ id: "c2", clientMessageId: "c2" }), pending: true, queued: true } });
    expect(state.messages[0]).not.toHaveProperty("failed");
    state = roomReducer(state, { type: "sent", clientMessageIds: ["c1"] });
    expect(state.messages.map((m) => [m.clientMessageId, isPending(m) && m.queued === true])).toEqual([
      ["c1", false],
      ["c2", true],
    ]);
    expect(state.messages[0]).toMatchObject({ pending: true });
    expect(state.messages[0]).not.toHaveProperty("queued");
    expect(state.notice).toBeNull();
  });

  it("shows only the messages still waiting as not sent once the page is offline, and says so", () => {
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message({ id: "c1" }), pending: true } });
    state = roomReducer(state, { type: "pending", message: { ...message({ id: "c2", clientMessageId: "c2" }), pending: true, queued: true } });
    state = roomReducer(state, { type: "offline", offline: true });
    // The first went before the connection dropped, so it waits for the room's answer.
    expect(state.messages.map((m) => [m.clientMessageId, isPending(m) && m.failed === true])).toEqual([
      ["c1", false],
      ["c2", true],
    ]);
    expect(state.messages[1]).not.toHaveProperty("queued");
    expect(state.notice).toBe("Not connected. Your message wasn't sent.");

    state = roomReducer(state, { type: "dismiss-notice" });
    state = roomReducer(state, { type: "pending", message: { ...message({ id: "c3", clientMessageId: "c3" }), pending: true, queued: true } });
    expect(state.messages[2]).toMatchObject({ pending: true, failed: true });
    expect(state.notice).toBe("Not connected. Your message wasn't sent.");

    state = roomReducer(state, { type: "offline", offline: false });
    expect(state.offline).toBe(false);
    expect(state.messages.map((m) => isPending(m) && m.failed === true)).toEqual([false, true, true]);
  });

  it("says nothing on going offline with nothing waiting", () => {
    const state = roomReducer(initialRoomState, { type: "offline", offline: true });
    expect(state).toEqual({ ...initialRoomState, offline: true });
  });

  it("drops a copy marked unsent once older history turns up the stored message", () => {
    // The room stored it, but newer messages pushed it out of the snapshot sent on reconnect, and the
    // room couldn't check it.
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message({ id: "c1" }), pending: true } });
    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: [message({ id: "m2", clientMessageId: "c2" })], present: [ada], hasMore: true, seq: 0 }, now: 0 });
    state = frame(state, { type: "frame", frame: { type: "error", message: "Something went wrong", failed: "message.check", clientMessageIds: ["c1"] }, now: 0 });
    expect(state.messages[1]).toMatchObject({ pending: true, failed: true });

    state = frame(state, { type: "frame", frame: { type: "history", messages: [message()], hasMore: false }, now: 0 });
    expect(state.messages.map((m) => [m.id, isPending(m)])).toEqual([
      ["m1", false],
      ["m2", false],
    ]);
  });
});

describe(feature("boosts.add"), () => {
  it("adds and removes boosts", () => {
    let state = frame(initialRoomState, { type: "frame", frame: { type: "message.created", message: message(), seq: 1 }, now: 0 });
    const boost = { id: "b1", messageId: "m1", booster: ada, content: "👍", createdAt: "" };
    state = frame(state, { type: "frame", frame: { type: "boost.created", boost, seq: 1 }, now: 0 });
    expect(state.messages[0]!.boosts).toEqual([boost]);
    state = frame(state, { type: "frame", frame: { type: "boost.deleted", boostId: "b1", messageId: "m1", seq: 1 }, now: 0 });
    expect(state.messages[0]!.boosts).toEqual([]);
  });
});

describe(feature("realtime.presence"), () => {
  it("adds who arrives and drops who leaves, listing each person once", () => {
    let state = frame(initialRoomState, { type: "frame", frame: { type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, seq: 0 }, now: 0 });
    state = frame(state, { type: "frame", frame: { type: "presence.joined", user: grace }, now: 0 });
    expect(state.present).toEqual([ada, grace]);
    expect(frame(state, { type: "frame", frame: { type: "presence.joined", user: grace }, now: 0 })).toBe(state);
    state = frame(state, { type: "frame", frame: { type: "presence.left", userId: "u2" }, now: 0 });
    expect(state.present).toEqual([ada]);
  });
});

describe(feature("realtime.typing"), () => {
  it("expires stale typing indicators", () => {
    let state = frame(initialRoomState, { type: "frame", frame: { type: "typing", user: ada, typing: true }, now: 1_000 });
    expect(Object.keys(state.typing)).toEqual(["u1"]);
    state = roomReducer(state, { type: "expire-typing", before: 2_000 });
    expect(state.typing).toEqual({});
  });

  it("keeps the same state when no indicator expired, so an idle room doesn't re-render", () => {
    expect(roomReducer(initialRoomState, { type: "expire-typing", before: 2_000 })).toBe(initialRoomState);
    const typing = frame(initialRoomState, { type: "frame", frame: { type: "typing", user: ada, typing: true }, now: 1_000 });
    expect(roomReducer(typing, { type: "expire-typing", before: 1_000 })).toBe(typing);
  });

  it("stops showing someone as typing when their message arrives or they leave", () => {
    let state = frame(initialRoomState, { type: "frame", frame: { type: "typing", user: ada, typing: true }, now: 0 });
    state = frame(state, { type: "frame", frame: { type: "typing", user: grace, typing: true }, now: 0 });
    state = frame(state, { type: "frame", frame: { type: "message.created", message: message(), seq: 1 }, now: 0 });
    expect(Object.keys(state.typing)).toEqual(["u2"]);
    state = frame(state, { type: "frame", frame: { type: "presence.left", userId: "u2" }, now: 0 });
    expect(state.typing).toEqual({});
  });
});

describe(feature("messages.history"), () => {
  it("stops waiting for older history after a reconnect", () => {
    let state = roomReducer(initialRoomState, { type: "loading-older" });
    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: [message()], present: [ada], hasMore: true, seq: 0 }, now: 0 });
    expect(state.loadingOlder).toBe(false);
  });

  it("lets paging retry after a failed history request", () => {
    let state = roomReducer(initialRoomState, { type: "loading-older" });
    state = frame(state, { type: "frame", frame: { type: "error", message: "Something went wrong", failed: "message.update" }, now: 0 });
    expect(state.loadingOlder).toBe(true);
    state = frame(state, { type: "frame", frame: { type: "error", message: "Something went wrong", failed: "history.before" }, now: 0 });
    expect(state.loadingOlder).toBe(false);
  });

  it("keeps the same messages after an error about none, so the timeline doesn't ask again for a failed page", () => {
    const state = frame(initialRoomState, { type: "frame", frame: { type: "message.created", message: message(), seq: 1 }, now: 0 });
    const failed = frame(state, { type: "frame", frame: { type: "error", message: "Something went wrong", failed: "history.before" }, now: 0 });
    expect(failed.messages).toBe(state.messages);
  });

  it("pages back from the oldest message the room sent, even once it's deleted", () => {
    const page = [message({ id: "m2", clientMessageId: "c2" }), message({ id: "m3", clientMessageId: "c3" })];
    let state = frame(initialRoomState, { type: "frame", frame: { type: "welcome", you: ada, messages: page, present: [ada], hasMore: true, seq: 0 }, now: 0 });
    expect(state.oldestId).toBe("m2");
    for (const messageId of ["m2", "m3"]) state = frame(state, { type: "frame", frame: { type: "message.deleted", messageId, seq: 1 }, now: 0 });
    expect(state).toMatchObject({ messages: [], hasMore: true, oldestId: "m2" });

    state = frame(state, { type: "frame", frame: { type: "history", messages: [message()], hasMore: false }, now: 0 });
    expect(state.oldestId).toBe("m1");
  });

  it("prepends older history", () => {
    let state = frame(initialRoomState, { type: "frame", frame: { type: "message.created", message: message({ id: "m2", clientMessageId: "c2" }), seq: 1 }, now: 0 });
    state = frame(state, { type: "frame", frame: { type: "history", messages: [message()], hasMore: false }, now: 0 });
    expect(state.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});

describe(feature("rooms.invitation-card"), () => {
  const page = (count: number) => Array.from({ length: count }, (_, i) => message({ id: `m${i}`, clientMessageId: `c${i}` }));
  const welcome = (state: RoomState, messages: Message[], hasMore = false) =>
    frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages, present: [ada], hasMore, seq: 0 }, now: 0 });

  it("counts a room as paged once it holds more than a page of ember-rust's", () => {
    expect(initialRoomState.paged).toBeNull();
    expect(welcome(initialRoomState, page(WELCOME_CARD_MESSAGES)).paged).toBe(false);
    expect(welcome(initialRoomState, page(WELCOME_CARD_MESSAGES + 1)).paged).toBe(true);
    expect(welcome(initialRoomState, page(50), true).paged).toBe(true);
  });

  it("keeps what the room first said across reconnects, as ember-rust's page does until it's loaded again", () => {
    const opened = welcome(initialRoomState, page(3));
    expect(welcome(opened, page(50), true).paged).toBe(false);
    expect(roomReducer(opened, { type: "reset" }).paged).toBeNull();
  });
});

describe(feature("rooms.member-only-access"), () => {
  it("shows nobody here, or typing, in a room that's gone, nor that it's offline, and keeps its messages", () => {
    let state = frame(initialRoomState, { type: "frame", frame: { type: "welcome", you: ada, messages: [message()], present: [ada, grace], hasMore: false, seq: 0 }, now: 0 });
    state = frame(state, { type: "frame", frame: { type: "typing", user: grace, typing: true }, now: 0 });
    state = roomReducer(state, { type: "offline", offline: true });
    state = roomReducer(state, { type: "status", status: "gone" });
    expect(state).toMatchObject({ status: "gone", offline: false, present: [], typing: {}, messages: [message()] });
  });

  it("shows what was waiting for a connection as not sent in a room that's gone, which it'll never reach", () => {
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message({ id: "c1" }), pending: true, queued: true } });
    state = roomReducer(state, { type: "status", status: "gone" });
    expect(state.messages).toMatchObject([{ clientMessageId: "c1", pending: true, failed: true }]);
    expect(state.messages[0]).not.toHaveProperty("queued");
  });
});
