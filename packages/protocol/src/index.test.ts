import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { isRoomSlug, MAX_BOOST_LENGTH, MAX_CHECKED_MESSAGES, MAX_MESSAGE_LENGTH, parseClientFrame } from "./index";

const parse = (frame: object) => parseClientFrame(JSON.stringify(frame));

describe(feature("messages.create"), () => {
  it("accepts a well-formed message and trims its body", () => {
    expect(parse({ type: "message.create", clientMessageId: "c1", body: "  hi  " })).toEqual({
      type: "message.create",
      clientMessageId: "c1",
      body: "hi",
    });
  });

  it("rejects blank bodies, unknown types and invalid JSON", () => {
    expect(parse({ type: "message.create", clientMessageId: "c1", body: "   " })).toBeNull();
    expect(parse({ type: "nope" })).toBeNull();
    expect(parseClientFrame("{")).toBeNull();
    expect(parseClientFrame("null")).toBeNull();
  });

  it(`limits messages to ${MAX_MESSAGE_LENGTH} characters and client ids to 64`, () => {
    expect(parse({ type: "message.create", clientMessageId: "c1", body: "x".repeat(MAX_MESSAGE_LENGTH) })).not.toBeNull();
    expect(parse({ type: "message.create", clientMessageId: "c1", body: "x".repeat(MAX_MESSAGE_LENGTH + 1) })).toBeNull();
    expect(parse({ type: "message.create", clientMessageId: "c".repeat(65), body: "hi" })).toBeNull();
  });
});

describe(feature("boosts.custom"), () => {
  it("limits reactions to the stored column width", () => {
    expect(parse({ type: "boost.create", messageId: "m1", content: "x".repeat(MAX_BOOST_LENGTH) })).not.toBeNull();
    expect(parse({ type: "boost.create", messageId: "m1", content: "x".repeat(MAX_BOOST_LENGTH + 1) })).toBeNull();
  });
});

describe(feature("messages.history"), () => {
  it("clamps history page sizes", () => {
    expect(parse({ type: "history.before", before: "m1", limit: 5000 })).toEqual({ type: "history.before", before: "m1", limit: 100 });
    expect(parse({ type: "history.before", before: "m1", limit: 0 })).toEqual({ type: "history.before", before: "m1", limit: 1 });
    expect(parse({ type: "history.before", before: "m1" })).toEqual({ type: "history.before", before: "m1", limit: undefined });
  });
});

describe(feature("realtime.reconnect"), () => {
  it("checks a bounded list of client message ids", () => {
    const check = (clientMessageIds: unknown) => parse({ type: "message.check", clientMessageIds });
    expect(check(["c1", "c2"])).toEqual({ type: "message.check", clientMessageIds: ["c1", "c2"] });
    expect(check(Array.from({ length: MAX_CHECKED_MESSAGES }, (_, i) => `c${i}`))).not.toBeNull();

    for (const clientMessageIds of [[], "c1", ["c1", 2], ["c1", ""], ["x".repeat(65)], Array.from({ length: MAX_CHECKED_MESSAGES + 1 }, (_, i) => `c${i}`)]) {
      expect(check(clientMessageIds), JSON.stringify(clientMessageIds)).toBeNull();
    }
  });
});

describe(feature("rooms.open"), () => {
  it("allows short lowercase room slugs only", () => {
    expect(isRoomSlug("general")).toBe(true);
    expect(isRoomSlug("dm-ab12")).toBe(true);
    expect(isRoomSlug("General")).toBe(false);
    expect(isRoomSlug("-x")).toBe(false);
    expect(isRoomSlug("a/b")).toBe(false);
    expect(isRoomSlug("x".repeat(64))).toBe(false);
  });
});
