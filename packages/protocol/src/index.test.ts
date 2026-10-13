import { describe, expect, it } from "vitest";
import { isRoomSlug, MAX_BOOST_LENGTH, MAX_CHECKED_MESSAGES, parseClientFrame } from "./index";

describe("parseClientFrame", () => {
  it("accepts a well-formed message and trims its body", () => {
    expect(parseClientFrame(JSON.stringify({ type: "message.create", clientMessageId: "c1", body: "  hi  " }))).toEqual({
      type: "message.create",
      clientMessageId: "c1",
      body: "hi",
    });
  });

  it("rejects blank bodies, unknown types and invalid JSON", () => {
    expect(parseClientFrame(JSON.stringify({ type: "message.create", clientMessageId: "c1", body: "   " }))).toBeNull();
    expect(parseClientFrame(JSON.stringify({ type: "nope" }))).toBeNull();
    expect(parseClientFrame("{")).toBeNull();
    expect(parseClientFrame("null")).toBeNull();
  });

  it("limits boosts to the stored column width", () => {
    const content = "x".repeat(MAX_BOOST_LENGTH + 1);
    expect(parseClientFrame(JSON.stringify({ type: "boost.create", messageId: "m1", content }))).toBeNull();
  });

  it("clamps history page sizes", () => {
    expect(parseClientFrame(JSON.stringify({ type: "history.before", before: "m1", limit: 5000 }))).toEqual({
      type: "history.before",
      before: "m1",
      limit: 100,
    });
  });

  it("checks a bounded list of client message ids", () => {
    const check = (clientMessageIds: unknown) => parseClientFrame(JSON.stringify({ type: "message.check", clientMessageIds }));
    expect(check(["c1", "c2"])).toEqual({ type: "message.check", clientMessageIds: ["c1", "c2"] });
    expect(check(Array.from({ length: MAX_CHECKED_MESSAGES }, (_, i) => `c${i}`))).not.toBeNull();

    for (const clientMessageIds of [[], "c1", ["c1", 2], ["c1", ""], ["x".repeat(65)], Array.from({ length: MAX_CHECKED_MESSAGES + 1 }, (_, i) => `c${i}`)]) {
      expect(check(clientMessageIds), JSON.stringify(clientMessageIds)).toBeNull();
    }
  });
});

describe("isRoomSlug", () => {
  it("allows lowercase slugs only", () => {
    expect(isRoomSlug("general")).toBe(true);
    expect(isRoomSlug("dm-ab12")).toBe(true);
    expect(isRoomSlug("General")).toBe(false);
    expect(isRoomSlug("-x")).toBe(false);
    expect(isRoomSlug("a/b")).toBe(false);
  });
});
