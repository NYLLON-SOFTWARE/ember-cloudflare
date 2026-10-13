import type { Message, User } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { initialRoomState, isPending, roomReducer, type RoomState } from "./room-state";

const ada: User = { id: "u1", name: "Ada" };
const message = (overrides: Partial<Message> = {}): Message => ({
  id: "m1",
  clientMessageId: "c1",
  roomId: "general",
  creator: ada,
  body: "hi",
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  boosts: [],
  ...overrides,
});

const frame = (state: RoomState, f: Parameters<typeof roomReducer>[1] & { type: "frame" }) => roomReducer(state, f);

describe("roomReducer", () => {
  it("replaces an optimistic message with the stored one", () => {
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message({ id: "c1" }), pending: true } });
    state = frame(state, { type: "frame", frame: { type: "message.created", message: message() }, now: 0 });
    expect(state.messages).toHaveLength(1);
    expect(isPending(state.messages[0]!)).toBe(false);
    expect(state.messages[0]!.id).toBe("m1");
  });

  it("puts a confirmed message after the ones the room stored before it", () => {
    const grace: User = { id: "u2", name: "Grace" };
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message({ id: "c1" }), pending: true } });
    // Grace's message reached the room first, so the room announces it before confirming Ada's.
    state = frame(state, { type: "frame", frame: { type: "message.created", message: message({ id: "g1", clientMessageId: "g1", creator: grace }) }, now: 0 });
    state = frame(state, { type: "frame", frame: { type: "message.created", message: message({ id: "m2" }) }, now: 0 });
    expect(state.messages.map((m) => [m.creator.name, m.id, isPending(m)])).toEqual([
      ["Grace", "g1", false],
      ["Ada", "m2", false],
    ]);
  });

  it("keeps unconfirmed messages across a reconnect, the sent ones as sending while the room checks them", () => {
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message({ id: "c2", clientMessageId: "c2" }), pending: true } });
    state = roomReducer(state, { type: "pending", message: { ...message({ id: "c3", clientMessageId: "c3" }), pending: true, failed: true } });
    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: [message()], present: [ada], hasMore: false }, now: 0 });
    expect(state.messages.map((m) => m.clientMessageId)).toEqual(["c1", "c2", "c3"]);
    expect(state.messages[1]).toMatchObject({ pending: true, checking: true });
    expect(state.messages[1]).not.toHaveProperty("failed");
    expect(state.messages[2]).toMatchObject({ pending: true, failed: true });
    expect(state.messages[2]).not.toHaveProperty("checking");
    expect(state.status).toBe("open");
  });

  it("drops checked messages the room stored, and shows the ones it never received as not sent", () => {
    let state = initialRoomState;
    for (const id of ["c2", "c3", "c4"]) {
      state = roomReducer(state, { type: "pending", message: { ...message({ id, clientMessageId: id }), pending: true } });
    }
    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: [message()], present: [ada], hasMore: true }, now: 0 });
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

  it("shows the messages it was checking as not sent when the check fails", () => {
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message({ id: "c2", clientMessageId: "c2" }), pending: true } });
    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: [message()], present: [ada], hasMore: true }, now: 0 });
    state = roomReducer(state, { type: "pending", message: { ...message({ id: "c3", clientMessageId: "c3" }), pending: true } });

    state = frame(state, { type: "frame", frame: { type: "error", message: "Something went wrong", failed: "message.check" }, now: 0 });
    expect(state.messages.map((m) => [m.clientMessageId, isPending(m) && m.failed === true])).toEqual([
      ["c1", false],
      ["c2", true],
      ["c3", false],
    ]);
  });

  it("only reconciles a stored message with its own sender's optimistic copy", () => {
    const grace: User = { id: "u2", name: "Grace" };
    let state = frame(initialRoomState, { type: "frame", frame: { type: "message.created", message: message() }, now: 0 });
    state = roomReducer(state, { type: "pending", message: { ...message({ id: "c2", clientMessageId: "c2", body: "mine" }), pending: true } });

    // Grace reuses the clientMessageIds she can see: neither Ada's stored nor her pending message is replaced.
    for (const clientMessageId of ["c1", "c2"]) {
      const copy = message({ id: `g-${clientMessageId}`, clientMessageId, creator: grace, body: "spoof" });
      state = frame(state, { type: "frame", frame: { type: "message.created", message: copy }, now: 0 });
    }
    expect(state.messages.map((m) => [m.creator.name, m.body])).toEqual([
      ["Ada", "hi"],
      ["Ada", "mine"],
      ["Grace", "spoof"],
      ["Grace", "spoof"],
    ]);

    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: state.messages.filter((m) => !isPending(m)), present: [ada], hasMore: false }, now: 0 });
    expect(state.messages.find((m) => m.clientMessageId === "c2" && m.creator.id === ada.id)).toMatchObject({ pending: true, checking: true });
  });

  it("lets paging retry after a failed history request", () => {
    let state = roomReducer(initialRoomState, { type: "loading-older" });
    state = frame(state, { type: "frame", frame: { type: "error", message: "Something went wrong", failed: "message.update" }, now: 0 });
    expect(state.loadingOlder).toBe(true);
    state = frame(state, { type: "frame", frame: { type: "error", message: "Something went wrong", failed: "history.before" }, now: 0 });
    expect(state.loadingOlder).toBe(false);
  });

  it("marks a refused message as failed", () => {
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message(), pending: true } });
    state = frame(state, { type: "frame", frame: { type: "error", message: "nope", clientMessageId: "c1" }, now: 0 });
    expect(state.messages[0]).toMatchObject({ failed: true });
    expect(state.notice).toBe("nope");
  });

  it("adds and removes boosts", () => {
    let state = frame(initialRoomState, { type: "frame", frame: { type: "message.created", message: message() }, now: 0 });
    const boost = { id: "b1", messageId: "m1", booster: ada, content: "👍", createdAt: "" };
    state = frame(state, { type: "frame", frame: { type: "boost.created", boost }, now: 0 });
    expect(state.messages[0]!.boosts).toEqual([boost]);
    state = frame(state, { type: "frame", frame: { type: "boost.deleted", boostId: "b1", messageId: "m1" }, now: 0 });
    expect(state.messages[0]!.boosts).toEqual([]);
  });

  it("expires stale typing indicators", () => {
    let state = frame(initialRoomState, { type: "frame", frame: { type: "typing", user: ada, typing: true }, now: 1_000 });
    expect(Object.keys(state.typing)).toEqual(["u1"]);
    state = roomReducer(state, { type: "expire-typing", before: 2_000 });
    expect(state.typing).toEqual({});
  });

  it("stops waiting for older history after a reconnect", () => {
    let state = roomReducer(initialRoomState, { type: "loading-older" });
    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: [message()], present: [ada], hasMore: true }, now: 0 });
    expect(state.loadingOlder).toBe(false);
  });

  it("drops a copy marked unsent once older history turns up the stored message", () => {
    // The room stored it, but newer messages pushed it out of the snapshot sent on reconnect, and the
    // room couldn't check it.
    let state = roomReducer(initialRoomState, { type: "pending", message: { ...message({ id: "c1" }), pending: true } });
    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: [message({ id: "m2", clientMessageId: "c2" })], present: [ada], hasMore: true }, now: 0 });
    state = frame(state, { type: "frame", frame: { type: "error", message: "Something went wrong", failed: "message.check" }, now: 0 });
    expect(state.messages[1]).toMatchObject({ pending: true, failed: true });

    state = frame(state, { type: "frame", frame: { type: "history", messages: [message()], hasMore: false }, now: 0 });
    expect(state.messages.map((m) => [m.id, isPending(m)])).toEqual([
      ["m1", false],
      ["m2", false],
    ]);
  });

  it("prepends older history", () => {
    let state = frame(initialRoomState, { type: "frame", frame: { type: "message.created", message: message({ id: "m2", clientMessageId: "c2" }) }, now: 0 });
    state = frame(state, { type: "frame", frame: { type: "history", messages: [message()], hasMore: false }, now: 0 });
    expect(state.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
