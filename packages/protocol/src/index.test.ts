import { describe, expect, it } from "vitest";
import { isRoomSlug, MAX_BOOST_LENGTH, parseClientFrame } from "./index";

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
