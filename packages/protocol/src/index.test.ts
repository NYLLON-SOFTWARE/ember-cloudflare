import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import {
  isPasswordTooLong,
  isPasswordTooShort,
  isRoomId,
  MAX_BOOST_LENGTH,
  MAX_CHECKED_MESSAGES,
  MAX_LISTED_USERS,
  MAX_MESSAGE_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  parseClientFrame,
  parseNewRoom,
  parseSignUp,
} from "./index";

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

describe(feature("rooms.show"), () => {
  it("takes sortable ids and legacy rooms' addresses as room ids, and nothing else", () => {
    expect(isRoomId("mgp3x2c4a1b2c3d4")).toBe(true);
    expect(isRoomId("general")).toBe(true);
    expect(isRoomId("dm-ab12")).toBe(true);
    expect(isRoomId("General")).toBe(false);
    expect(isRoomId("-x")).toBe(false);
    expect(isRoomId("a/b")).toBe(false);
    expect(isRoomId("_health")).toBe(false);
    expect(isRoomId("x".repeat(64))).toBe(false);
  });
});

describe(feature("rooms.create-open"), () => {
  it("takes a kind and a trimmed name", () => {
    expect(parseNewRoom({ kind: "open", name: "  Design  " })).toEqual({ kind: "open", name: "Design" });
    expect(parseNewRoom({ kind: "open", name: "x".repeat(MAX_ROOM_NAME_LENGTH) })).toEqual({ kind: "open", name: "x".repeat(MAX_ROOM_NAME_LENGTH) });
  });

  it.each([
    ["no body", null, "Expected a JSON object"],
    ["a list", [], 'Kind must be "open" or "closed"'],
    ["no kind", { name: "Design" }, 'Kind must be "open" or "closed"'],
    ["a direct message", { kind: "direct", name: "Design" }, 'Kind must be "open" or "closed"'],
    ["no name", { kind: "open" }, `Name must be 1 to ${MAX_ROOM_NAME_LENGTH} characters`],
    ["a blank name", { kind: "open", name: "   " }, `Name must be 1 to ${MAX_ROOM_NAME_LENGTH} characters`],
    ["a name that isn't text", { kind: "open", name: 42 }, `Name must be 1 to ${MAX_ROOM_NAME_LENGTH} characters`],
    ["a name that's too long", { kind: "open", name: "x".repeat(MAX_ROOM_NAME_LENGTH + 1) }, `Name must be 1 to ${MAX_ROOM_NAME_LENGTH} characters`],
  ])("refuses %s and says why", (_, body, error) => {
    expect(parseNewRoom(body)).toBe(error);
  });
});

describe(feature("rooms.create-closed"), () => {
  it("takes a closed room's members, or nobody", () => {
    expect(parseNewRoom({ kind: "closed", name: "Leads", memberIds: ["u1", "u2"] })).toEqual({ kind: "closed", name: "Leads", memberIds: ["u1", "u2"] });
    expect(parseNewRoom({ kind: "closed", name: "Leads" })).toEqual({ kind: "closed", name: "Leads", memberIds: [] });
  });

  it("refuses members that aren't a bounded list of ids", () => {
    const tooMany = Array.from({ length: MAX_LISTED_USERS + 1 }, (_, i) => `u${i}`);
    for (const memberIds of ["u1", [1], [""], ["x".repeat(65)], tooMany]) {
      expect(parseNewRoom({ kind: "closed", name: "Leads", memberIds }), JSON.stringify(memberIds).slice(0, 40)).toBe(`Members must be a list of at most ${MAX_LISTED_USERS} user ids`);
    }
    expect(parseNewRoom({ kind: "closed", name: "Leads", memberIds: tooMany.slice(1) })).not.toBeTypeOf("string");
  });
});

describe(feature("auth.first-run"), () => {
  it("takes a name, an email address and a password, trimming only the name", () => {
    expect(parseSignUp({ name: "  Ada Lovelace ", emailAddress: "ada@example.com", password: " secret  words " })).toEqual({
      name: "Ada Lovelace",
      emailAddress: "ada@example.com",
      password: " secret  words ",
    });
  });

  it.each([
    ["no body", null, "Expected a JSON object"],
    ["no name", { emailAddress: "ada@example.com", password: "12345678" }, "Name, email address and password are required"],
    ["a blank name", { name: "  ", emailAddress: "ada@example.com", password: "12345678" }, "Name, email address and password are required"],
    ["no email address", { name: "Ada", emailAddress: "", password: "12345678" }, "Name, email address and password are required"],
    ["no password", { name: "Ada", emailAddress: "ada@example.com" }, "Name, email address and password are required"],
    ["a password that isn't text", { name: "Ada", emailAddress: "ada@example.com", password: 12345678 }, "Name, email address and password are required"],
  ])("refuses %s and says why", (_, body, error) => {
    expect(parseSignUp(body)).toBe(error);
  });

  it("counts a password's characters, not its bytes or UTF-16 units", () => {
    expect(["", "short", "1234567", "éééé", "🔐🔐🔐🔐", "🔐🔐🔐🔐🔐🔐🔐"].filter(isPasswordTooShort)).toHaveLength(6);
    expect(isPasswordTooShort("12345678")).toBe(false);
    expect(isPasswordTooShort("🔐".repeat(8))).toBe(false);
  });

  it("measures a password's length as the form's maxlength does, in UTF-16 units", () => {
    expect(isPasswordTooLong("x".repeat(72))).toBe(false);
    expect(isPasswordTooLong("🔐".repeat(36))).toBe(false);
    expect(isPasswordTooLong("x".repeat(73))).toBe(true);
    expect(isPasswordTooLong("🔐".repeat(37))).toBe(true);
  });
});
