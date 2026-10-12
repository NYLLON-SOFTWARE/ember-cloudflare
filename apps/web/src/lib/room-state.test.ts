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

  it("keeps unsent messages across a reconnect", () => {
    const pending = { ...message({ id: "c2", clientMessageId: "c2" }), pending: true as const };
    let state = roomReducer(initialRoomState, { type: "pending", message: pending });
    state = frame(state, { type: "frame", frame: { type: "welcome", you: ada, messages: [message()], present: [ada], hasMore: false }, now: 0 });
    expect(state.messages.map((m) => m.clientMessageId)).toEqual(["c1", "c2"]);
    expect(state.status).toBe("open");
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

  it("prepends older history", () => {
    let state = frame(initialRoomState, { type: "frame", frame: { type: "message.created", message: message({ id: "m2", clientMessageId: "c2" }) }, now: 0 });
    state = frame(state, { type: "frame", frame: { type: "history", messages: [message()], hasMore: false }, now: 0 });
    expect(state.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
