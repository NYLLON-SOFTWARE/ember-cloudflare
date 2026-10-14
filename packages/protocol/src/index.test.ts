import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import {
  isPasswordTooLong,
  isPasswordTooShort,
  isRoomIcon,
  isRoomId,
  MAX_ACCOUNT_NAME_LENGTH,
  MAX_BOOST_LENGTH,
  MAX_CHECKED_MESSAGES,
  MAX_LISTED_USERS,
  MAX_MESSAGE_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  parseAccountChanges,
  parseClientFrame,
  parseNewRoom,
  parseRoomChanges,
  parseRoomSocketParams,
  parseServerFrame,
  parseSignUp,
  parseWorkspaceClientFrame,
  ROOM_ICON_NAMES,
  roomSocketQuery,
  type WorkspaceServerFrame,
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

describe(feature("realtime.presence"), () => {
  it("takes whether a tab is shown, as a boolean", () => {
    expect(parse({ type: "presence.visible", visible: false })).toEqual({ type: "presence.visible", visible: false });
    expect(parse({ type: "presence.visible", visible: true, extra: 1 })).toEqual({ type: "presence.visible", visible: true });
    for (const visible of [undefined, null, 1, "true", "visible"]) {
      expect(parse({ type: "presence.visible", visible }), String(visible)).toBeNull();
    }
  });

  it("carries whether a tab is shown on its room socket's address, which counts it as shown when it doesn't say", () => {
    expect(roomSocketQuery({ visible: true })).toBe("?visible=1");
    expect(roomSocketQuery({ visible: false })).toBe("?visible=0");
    // As the worker's URLSearchParams reads them.
    const read = (params: Record<string, string>) => parseRoomSocketParams({ get: (name) => params[name] ?? null });
    expect(read({ visible: "1" })).toEqual({ visible: true });
    expect(read({ visible: "0" })).toEqual({ visible: false });
    expect(read({})).toEqual({ visible: true });
    expect(read({ visible: "yes" })).toEqual({ visible: true });
  });
});

describe(feature("platform.live-socket"), () => {
  it("takes only pings on the workspace socket", () => {
    expect(parseWorkspaceClientFrame('{"type":"ping"}')).toEqual({ type: "ping" });
    expect(parseWorkspaceClientFrame('{"type":"ping","nonce":"n1"}')).toEqual({ type: "ping" });
    for (const raw of ['{"type":"typing.start"}', '{"type":"message.create","clientMessageId":"c1","body":"hi"}', "[]", "null", "{"]) {
      expect(parseWorkspaceClientFrame(raw), raw).toBeNull();
    }
  });

  it("reads the workspace socket's frames as the server sends them", () => {
    const welcome: WorkspaceServerFrame = { type: "welcome", you: { id: "u1", name: "Ada", administrator: true } };
    expect(parseServerFrame<WorkspaceServerFrame>(JSON.stringify(welcome))).toEqual(welcome);
    expect(parseServerFrame<WorkspaceServerFrame>('{"type":7}')).toBeNull();
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

describe(feature("rooms.icons"), () => {
  it("takes the name of every icon in the catalog", () => {
    expect(ROOM_ICON_NAMES).toHaveLength(1869);
    expect(ROOM_ICON_NAMES).toEqual(expect.arrayContaining(["coffee", "rocket", "star", "hash"]));
    expect(ROOM_ICON_NAMES.filter((name) => !isRoomIcon(name))).toEqual([]);
  });

  it("refuses anything that isn't exactly one, as ember-rust does", () => {
    const values = ["not-a-lucide-icon", "../coffee", "<svg></svg>", " coffee ", "Coffee", "home", "constructor", "", null, true, [], ["coffee"], 7, {}];
    expect(values.filter(isRoomIcon)).toEqual([]);
  });

  it('takes a new or changed room\'s icon, "" for the default, or none, which keeps the one it has', () => {
    expect(parseNewRoom({ kind: "open", name: "Design", icon: "coffee" })).toEqual({ kind: "open", name: "Design", icon: "coffee" });
    expect(parseNewRoom({ kind: "closed", name: "Leads", icon: "" })).toEqual({ kind: "closed", name: "Leads", icon: "", memberIds: [] });
    expect(parseRoomChanges({ icon: "rocket" })).toEqual({ icon: "rocket" });
    expect(parseRoomChanges({ icon: "", kind: "open" })).toEqual({ icon: "", kind: "open" });
    expect(parseRoomChanges({ name: "Design" })).toHaveProperty("icon", undefined);
  });

  it.each(["not-a-lucide-icon", "../coffee", "<svg></svg>", " coffee ", "Coffee", null, true, []])("refuses the icon %j, as ember-rust answers 422", (icon) => {
    const refused = 'Icon must be one of the room icons, or "" for the default';
    expect(parseNewRoom({ kind: "open", name: "Design", icon })).toBe(refused);
    expect(parseRoomChanges({ name: "Design", icon })).toBe(refused);
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

describe(feature("rooms.settings-page"), () => {
  it("takes a trimmed name, or nothing to change", () => {
    expect(parseRoomChanges({ name: "  Design  " })).toEqual({ name: "Design" });
    expect(parseRoomChanges({})).toEqual({});
  });

  it.each([
    ["no body", null, "Expected a JSON object"],
    ["a blank name", { name: "   " }, `Name must be 1 to ${MAX_ROOM_NAME_LENGTH} characters`],
    ["a name that isn't text", { name: null }, `Name must be 1 to ${MAX_ROOM_NAME_LENGTH} characters`],
    ["a name that's too long", { name: "x".repeat(MAX_ROOM_NAME_LENGTH + 1) }, `Name must be 1 to ${MAX_ROOM_NAME_LENGTH} characters`],
    ["a direct message", { kind: "direct" }, 'Kind must be "open" or "closed"'],
    ["a kind that isn't one", { name: "Design", kind: "secret" }, 'Kind must be "open" or "closed"'],
  ])("refuses %s and says why", (_, body, error) => {
    expect(parseRoomChanges(body)).toBe(error);
  });
});

describe(feature("rooms.convert-access"), () => {
  it("takes making a room open, with or without a new name, and ignores members it doesn't need", () => {
    expect(parseRoomChanges({ kind: "open" })).toEqual({ kind: "open" });
    expect(parseRoomChanges({ name: " Design ", kind: "open", memberIds: ["u1"] })).toEqual({ name: "Design", kind: "open" });
  });
});

describe(feature("rooms.members"), () => {
  it("takes a private room's members, even nobody", () => {
    expect(parseRoomChanges({ name: "Leads", kind: "closed", memberIds: ["u1", "u2"] })).toEqual({ name: "Leads", kind: "closed", memberIds: ["u1", "u2"] });
    expect(parseRoomChanges({ kind: "closed", memberIds: [] })).toEqual({ kind: "closed", memberIds: [] });
  });

  it("refuses making a room private without its members listed, since everyone left out is taken out", () => {
    const tooMany = Array.from({ length: MAX_LISTED_USERS + 1 }, (_, i) => `u${i}`);
    for (const memberIds of [undefined, "u1", [1], [""], tooMany]) {
      expect(parseRoomChanges({ kind: "closed", memberIds }), JSON.stringify(memberIds)?.slice(0, 40)).toBe(`Members must be a list of at most ${MAX_LISTED_USERS} user ids`);
    }
  });
});

describe(feature("accounts.name"), () => {
  it("takes the workspace's name as typed, even blank, or nothing to change", () => {
    expect(parseAccountChanges({ name: "  Ember Studio " })).toEqual({ name: "  Ember Studio " });
    expect(parseAccountChanges({ name: "" })).toEqual({ name: "" });
    expect(parseAccountChanges({ name: "x".repeat(MAX_ACCOUNT_NAME_LENGTH) })).toEqual({ name: "x".repeat(MAX_ACCOUNT_NAME_LENGTH) });
    expect(parseAccountChanges({})).toEqual({});
    expect(parseAccountChanges({ logo: "earth.png" })).toEqual({});
  });

  it.each([
    ["no body", null, "Expected a JSON object"],
    ["a list", [{ name: "Ember Studio" }], "Expected a JSON object"],
    ["a name that isn't text", { name: 7 }, `Name must be at most ${MAX_ACCOUNT_NAME_LENGTH} characters`],
    ["a name that's too long", { name: "x".repeat(MAX_ACCOUNT_NAME_LENGTH + 1) }, `Name must be at most ${MAX_ACCOUNT_NAME_LENGTH} characters`],
  ])("refuses %s and says why", (_, body, error) => {
    expect(parseAccountChanges(body)).toBe(error);
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
