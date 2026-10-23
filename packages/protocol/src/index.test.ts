import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import {
  canBeCustomDomain,
  CUSTOM_DOMAIN_NOT_A_HOST,
  INVOLVEMENTS,
  isInvolvement,
  isMessageTooLong,
  isPasswordTooLong,
  isPasswordTooShort,
  isRoomIcon,
  isRoomId,
  MAX_ACCOUNT_NAME_LENGTH,
  MAX_BIO_LENGTH,
  MAX_BOOST_LENGTH,
  MAX_CHECKED_MESSAGES,
  MAX_CUSTOM_STYLES_LENGTH,
  MAX_EMAIL_ADDRESS_LENGTH,
  MAX_LISTED_USERS,
  MAX_MESSAGE_HTML_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_PUSH_ENDPOINT_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MAX_SHARED_ORDER,
  MAX_TAGLINE_LENGTH,
  MAX_USER_NAME_LENGTH,
  memberfulProblemOf,
  memberfulSignInPath,
  NOT_A_CUSTOM_DOMAIN,
  parseAccountChanges,
  parseClientFrame,
  parseCustomDomainCheck,
  parseCustomStyles,
  parseInvolvementChange,
  parseNewDirect,
  parseNewRoom,
  parsePasswordReset,
  parseProfileChanges,
  parseRoleChange,
  parseRoomChanges,
  parseRoomSocketParams,
  parseServerFrame,
  parseSharedOrder,
  parseSignUp,
  parseWorkspaceClientFrame,
  ROOM_ICON_NAMES,
  ROOM_PROTOCOL,
  roomSocketQuery,
  startingInvolvement,
  suggestedCount,
  TAGLINE_TOO_LONG,
  type WorkspaceServerFrame,
} from "./index";

const parse = (frame: object) => parseClientFrame(JSON.stringify(frame));
/** What a room socket's address with `params` says, as the worker's URLSearchParams reads it. */
const read = (params: Record<string, string>) => parseRoomSocketParams({ get: (name) => params[name] ?? null });

describe(feature("messages.create"), () => {
  it("accepts a well-formed message, leaving its markup for the room to read", () => {
    for (const body of ["<p>hi</p>", "  <p>hi</p>\n", "", " "]) {
      expect(parse({ type: "message.create", clientMessageId: "c1", body }), body).toEqual({ type: "message.create", clientMessageId: "c1", body });
    }
    expect(parse({ type: "message.update", messageId: "m1", body: "" })).toEqual({ type: "message.update", messageId: "m1", body: "" });
  });

  it("rejects bodies that aren't strings, unknown types and invalid JSON", () => {
    expect(parse({ type: "message.create", clientMessageId: "c1", body: 7 })).toBeNull();
    expect(parse({ type: "message.update", messageId: "m1" })).toBeNull();
    expect(parse({ type: "nope" })).toBeNull();
    expect(parseClientFrame("{")).toBeNull();
    expect(parseClientFrame("null")).toBeNull();
  });

  it(`limits a message's markup to ${MAX_MESSAGE_HTML_LENGTH} characters and client ids to 64`, () => {
    expect(parse({ type: "message.create", clientMessageId: "c1", body: "x".repeat(MAX_MESSAGE_HTML_LENGTH) })).not.toBeNull();
    expect(parse({ type: "message.create", clientMessageId: "c1", body: "x".repeat(MAX_MESSAGE_HTML_LENGTH + 1) })).toBeNull();
    expect(parse({ type: "message.update", messageId: "m1", body: "x".repeat(MAX_MESSAGE_HTML_LENGTH + 1) })).toBeNull();
    expect(parse({ type: "message.create", clientMessageId: "c".repeat(65), body: "hi" })).toBeNull();
  });

  it(`counts a message's plain text in UTF-16 units, as the room does, up to ${MAX_MESSAGE_LENGTH}`, () => {
    expect(isMessageTooLong("x".repeat(MAX_MESSAGE_LENGTH))).toBe(false);
    expect(isMessageTooLong("x".repeat(MAX_MESSAGE_LENGTH + 1))).toBe(true);
    expect(isMessageTooLong("🔥".repeat(MAX_MESSAGE_LENGTH / 2))).toBe(false);
    expect(isMessageTooLong("🔥".repeat(MAX_MESSAGE_LENGTH / 2 + 1))).toBe(true);
  });

  it("names the room protocol's revision on a room socket's address, which is the first when it doesn't", () => {
    expect(ROOM_PROTOCOL).toBe(3);
    expect(read({ visible: "1", protocol: String(ROOM_PROTOCOL) })).toEqual({ visible: true, protocol: ROOM_PROTOCOL });
    expect(read({ visible: "1" })).toEqual({ visible: true, protocol: 1 });
    expect(read({ protocol: "two" })).toEqual({ visible: true, protocol: 1 });
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
    expect(parse({ type: "history.after", after: "m1", limit: 5000 })).toEqual({ type: "history.after", after: "m1", limit: 100 });
    expect(parse({ type: "history.after", after: "m1", limit: 2.5 })).toEqual({ type: "history.after", after: "m1", limit: 2 });
  });

  it("pages from a message's id, which history can't do without", () => {
    for (const cursor of [undefined, "", 42, "x".repeat(65)]) {
      expect(parse({ type: "history.before", before: cursor }), String(cursor)).toBeNull();
      expect(parse({ type: "history.after", after: cursor }), String(cursor)).toBeNull();
    }
  });
});

describe(feature("messages.permalink"), () => {
  it("asks for the page around a message, or the newest page when it names none", () => {
    expect(parse({ type: "history.around", messageId: "m1" })).toEqual({ type: "history.around", messageId: "m1" });
    expect(parse({ type: "history.around" })).toEqual({ type: "history.around", messageId: undefined });
    for (const messageId of ["", 42, null, "x".repeat(65)]) expect(parse({ type: "history.around", messageId }), String(messageId)).toBeNull();
  });

  it("carries the message a permalink names on the room socket's address", () => {
    expect(roomSocketQuery({ visible: true, around: "01J9 Z/3" })).toBe(`?visible=1&protocol=${ROOM_PROTOCOL}&around=01J9%20Z%2F3`);
    const read = (params: Record<string, string>) => parseRoomSocketParams({ get: (name) => params[name] ?? null }).around;
    expect(read({ around: "01J9Z3" })).toBe("01J9Z3");
    for (const around of ["", "x".repeat(65)]) expect(read({ around }), around).toBeUndefined();
    expect(read({})).toBeUndefined();
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

  it("carries the latest change a tab has seen on its room socket's address, as a whole number", () => {
    expect(roomSocketQuery({ visible: true, since: 0 })).toBe(`?visible=1&protocol=${ROOM_PROTOCOL}&since=0`);
    expect(roomSocketQuery({ visible: false, since: 42 })).toBe(`?visible=0&protocol=${ROOM_PROTOCOL}&since=42`);
    const read = (params: Record<string, string>) => parseRoomSocketParams({ get: (name) => params[name] ?? null }).since;
    expect(read({ visible: "1", since: "42" })).toBe(42);
    expect(read({ since: "0" })).toBe(0);
    for (const since of ["", "-1", "1.5", "1e3", "0x10", " 42", "9".repeat(16)]) expect(read({ since }), since).toBeUndefined();
    expect(read({})).toBeUndefined();
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
    expect(roomSocketQuery({ visible: true })).toBe(`?visible=1&protocol=${ROOM_PROTOCOL}`);
    expect(roomSocketQuery({ visible: false })).toBe(`?visible=0&protocol=${ROOM_PROTOCOL}`);
    expect(read({ visible: "1" })).toMatchObject({ visible: true });
    expect(read({ visible: "0" })).toMatchObject({ visible: false });
    expect(read({})).toMatchObject({ visible: true });
    expect(read({ visible: "yes" })).toMatchObject({ visible: true });
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
    const welcome: WorkspaceServerFrame = {
      type: "welcome",
      you: { id: "u1", name: "Ada", administrator: true },
      account: { name: "Ember", tagline: "", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null, memberfulSignIn: false },
    };
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

describe(feature("dms.create"), () => {
  it("takes the people to start a DM with, or nobody, for a DM with yourself", () => {
    expect(parseNewDirect({ userIds: ["u1", "u2"] })).toEqual({ userIds: ["u1", "u2"] });
    expect(parseNewDirect({ userIds: [] })).toEqual({ userIds: [] });
    expect(parseNewDirect({})).toEqual({ userIds: [] });
  });

  it("refuses anything but a bounded list of ids", () => {
    const tooMany = Array.from({ length: MAX_LISTED_USERS + 1 }, (_, i) => `u${i}`);
    for (const body of [null, [], "u1", { userIds: "u1" }, { userIds: [1] }, { userIds: [""] }, { userIds: null }, { userIds: tooMany }]) {
      const refused = Array.isArray(body) || typeof body !== "object" || body === null ? "Expected a JSON object" : `People must be a list of at most ${MAX_LISTED_USERS} user ids`;
      expect(parseNewDirect(body), JSON.stringify(body).slice(0, 40)).toBe(refused);
    }
    expect(parseNewDirect({ userIds: tooMany.slice(1) })).not.toBeTypeOf("string");
  });
});

describe(feature("dms.suggestions"), () => {
  it("suggests 20 people less those in your DMs, you included, and one more, as ember-rust counts them", () => {
    expect(suggestedCount(0)).toBe(19);
    expect(suggestedCount(1)).toBe(18);
    expect(suggestedCount(2)).toBe(17);
    expect(suggestedCount(19)).toBe(0);
    expect(suggestedCount(25)).toBe(0);
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

describe(feature("accounts.tagline"), () => {
  it("takes a tagline on one line, with no space at either end, or blank for none, with the name or alone", () => {
    expect(parseAccountChanges({ tagline: "Engines for every occasion" })).toEqual({ tagline: "Engines for every occasion" });
    expect(parseAccountChanges({ name: "Ember", tagline: " Engines\tfor\r\nevery\u00a0 occasion  " })).toEqual({ name: "Ember", tagline: "Engines for every occasion" });
    expect(parseAccountChanges({ tagline: "" })).toEqual({ tagline: "" });
    expect(parseAccountChanges({ tagline: " \n " })).toEqual({ tagline: "" });
  });

  it("counts its characters as it's kept", () => {
    const longest = "x".repeat(MAX_TAGLINE_LENGTH);
    expect(parseAccountChanges({ tagline: longest })).toEqual({ tagline: longest });
    expect(parseAccountChanges({ tagline: `  ${longest}\n` })).toEqual({ tagline: longest });
    expect(parseAccountChanges({ tagline: `x${" ".repeat(10_000)}y` })).toEqual({ tagline: "x y" });
    expect(parseAccountChanges({ tagline: `${longest}x` })).toBe(TAGLINE_TOO_LONG);
    expect(parseAccountChanges({ tagline: `${longest} x` })).toBe(TAGLINE_TOO_LONG);
  });

  it.each([
    ["null", { tagline: null }],
    ["a number", { tagline: 30 }],
    ["a list", { tagline: ["Engines"] }],
    ["a good name beside a bad tagline", { name: "Ember Studio", tagline: false }],
  ])("refuses %s and says why", (_, body) => {
    expect(parseAccountChanges(body)).toBe(TAGLINE_TOO_LONG);
  });
});

describe(feature("accounts.translation-buttons"), () => {
  it("takes Hide translation buttons as true or false, with the name or alone", () => {
    expect(parseAccountChanges({ settings: { hideTranslationButtons: false } })).toEqual({ settings: { hideTranslationButtons: false } });
    expect(parseAccountChanges({ name: "Ember Studio", settings: { hideTranslationButtons: true } })).toEqual({
      name: "Ember Studio",
      settings: { hideTranslationButtons: true },
    });
    expect(parseAccountChanges({ settings: {} })).toEqual({ settings: {} });
  });

  it.each([
    ["settings that aren't an object", { settings: [true] }, "Settings must be a JSON object"],
    ["a setting that isn't true or false", { settings: { hideTranslationButtons: "false" } }, "Hide translation buttons must be true or false"],
    ["a setting it doesn't know", { settings: { hideTranslationButtons: true, allowGuests: true } }, "Unknown setting: allowGuests"],
    ["a setting named for an object's own methods", { settings: { toString: true } }, "Unknown setting: toString"],
    ["a good setting beside a bad name", { name: 7, settings: { hideTranslationButtons: true } }, `Name must be at most ${MAX_ACCOUNT_NAME_LENGTH} characters`],
  ])("refuses %s and says why", (_, body, error) => {
    expect(parseAccountChanges(body)).toBe(error);
  });
});

describe(feature("accounts.custom-domain"), () => {
  it("takes a custom domain as a host, with its port where it has one, or null for none", () => {
    expect(parseAccountChanges({ customDomain: "chat.example.com" })).toEqual({ customDomain: "chat.example.com" });
    expect(parseAccountChanges({ customDomain: "chat.example.com:8443" })).toEqual({ customDomain: "chat.example.com:8443" });
    expect(parseAccountChanges({ customDomain: "xn--bcher-kva.example" })).toEqual({ customDomain: "xn--bcher-kva.example" });
    const longest = `${"a".repeat(63)}.`.repeat(3) + "a".repeat(61);
    expect(parseAccountChanges({ customDomain: `${longest}:65535` })).toEqual({ customDomain: `${longest}:65535` });
    expect(parseAccountChanges({ customDomain: null })).toEqual({ customDomain: null });
    expect(parseAccountChanges({ name: "Ember Studio", customDomain: null })).toEqual({ name: "Ember Studio", customDomain: null });
  });

  it.each([
    ["an address with its scheme", "https://chat.example.com"],
    ["one with a path", "chat.example.com/"],
    ["capitals, which location.host never has", "Chat.Example.com"],
    ["nothing", ""],
    ["an empty label", "chat..example.com"],
    ["a port without a host", ":8443"],
    ["a port past 65535, which no URL has", "chat.example.com:65536"],
    ["port 0, where nothing answers", "chat.example.com:0"],
    ["a port with a leading zero, which location.host never has", "chat.example.com:08443"],
    ["a name longer than DNS allows", `${"a".repeat(63)}.`.repeat(3) + "a".repeat(62)],
    ["a number", 42],
    ["a list", ["chat.example.com"]],
  ])("refuses %s", (_, customDomain) => {
    expect(parseAccountChanges({ customDomain })).toBe(CUSTOM_DOMAIN_NOT_A_HOST);
  });

  it("can't be where a deploy or wrangler dev puts Ember, but can be a name under localhost", () => {
    for (const hostname of ["ember.kro.workers.dev", "workers.dev", "Ember.Kro.Workers.Dev", "localhost", "127.0.0.1", "127.8.0.1", "[::1]"]) expect([hostname, canBeCustomDomain(hostname)]).toEqual([hostname, false]);
    for (const hostname of ["chat.example.com", "workers.dev.example.com", "chat.localhost", "example.com"]) expect([hostname, canBeCustomDomain(hostname)]).toEqual([hostname, true]);
  });

  it("checks a domain that could be Ember's, as a host, with its port where it has one", () => {
    expect(parseCustomDomainCheck({ domain: "chat.example.com" })).toEqual({ domain: "chat.example.com" });
    expect(parseCustomDomainCheck({ domain: "chat.localhost:8443" })).toEqual({ domain: "chat.localhost:8443" });
    for (const domain of ["ember.kro.workers.dev", "localhost:8787", "127.0.0.1"]) expect(parseCustomDomainCheck({ domain })).toBe(NOT_A_CUSTOM_DOMAIN);
    for (const body of [{ domain: "https://chat.example.com" }, { domain: "Chat.Example.com" }, { domain: "chat.example.com:99999" }, { domain: "[::1]" }, { domain: 42 }, {}, null, ["chat.example.com"]])
      expect(parseCustomDomainCheck(body)).toBe(CUSTOM_DOMAIN_NOT_A_HOST);
  });
});

describe(feature("rooms.creation-permission"), () => {
  it("takes Must be admin to create new rooms as true or false, beside the other settings", () => {
    expect(parseAccountChanges({ settings: { restrictRoomCreation: true } })).toEqual({ settings: { restrictRoomCreation: true } });
    expect(parseAccountChanges({ settings: { restrictRoomCreation: false, hideTranslationButtons: true } })).toEqual({
      settings: { restrictRoomCreation: false, hideTranslationButtons: true },
    });
    expect(parseAccountChanges({ settings: { restrictRoomCreation: "true" } })).toBe("Must be admin to create new rooms must be true or false");
  });
});

describe(feature("auth.memberful-sign-in"), () => {
  it("takes Members sign in with Memberful as true or false, beside the other settings", () => {
    expect(parseAccountChanges({ settings: { memberfulSignIn: true } })).toEqual({ settings: { memberfulSignIn: true } });
    expect(parseAccountChanges({ settings: { memberfulSignIn: false, restrictRoomCreation: true } })).toEqual({
      settings: { memberfulSignIn: false, restrictRoomCreation: true },
    });
    expect(parseAccountChanges({ settings: { memberfulSignIn: 1 } })).toBe("Members sign in with Memberful must be true or false");
  });

  it("names the page to come back to, if any, in Sign in with Memberful's address", () => {
    expect(memberfulSignInPath(null)).toBe("/auth/memberful");
    expect(memberfulSignInPath("/rooms/general?x=1#y")).toBe("/auth/memberful?return_to=%2Frooms%2Fgeneral%3Fx%3D1%23y");
  });

  it("reads only the problems it knows from the sign-in page's address", () => {
    expect(memberfulProblemOf("membership")).toBe("membership");
    expect(memberfulProblemOf("refused")).toBe("refused");
    for (const value of [null, "", "toString", "Membership", "constructor"]) expect(memberfulProblemOf(value)).toBeNull();
  });
});

describe(feature("sidebar.shared-order"), () => {
  it("takes a list of distinct rooms, or none, which clears the order", () => {
    expect(parseSharedOrder({ roomIds: ["0000000000000002", "general"] })).toEqual(["0000000000000002", "general"]);
    expect(parseSharedOrder({ roomIds: [] })).toEqual([]);
    expect(parseSharedOrder({ roomIds: Array.from({ length: MAX_SHARED_ORDER }, (_, i) => `room-${i}`) })).toHaveLength(MAX_SHARED_ORDER);
  });

  it.each([
    ["no list", {}, "roomIds must be an array"],
    ["a body that isn't an object", null, "roomIds must be an array"],
    ["a list that isn't one", { roomIds: "general" }, "roomIds must be an array"],
    ["more rooms than an order can rank", { roomIds: Array.from({ length: MAX_SHARED_ORDER + 1 }, (_, i) => `room-${i}`) }, "too many rooms"],
    ["a room twice", { roomIds: ["general", "general"] }, "room IDs must be unique and valid"],
    ["an id that isn't a room's", { roomIds: ["general", 7] }, "room IDs must be unique and valid"],
  ])("refuses %s as ember-rust's `parse_order` does, and says why", (_, body, error) => {
    expect(parseSharedOrder(body)).toBe(error);
  });
});

describe(feature("accounts.custom-css"), () => {
  it("takes custom CSS as typed, even blank, or nothing to change", () => {
    expect(parseCustomStyles({ customStyles: "  body { color: red }\n" })).toEqual({ customStyles: "  body { color: red }\n" });
    expect(parseCustomStyles({ customStyles: "" })).toEqual({ customStyles: "" });
    expect(parseCustomStyles({ customStyles: "x".repeat(MAX_CUSTOM_STYLES_LENGTH) })).toEqual({ customStyles: "x".repeat(MAX_CUSTOM_STYLES_LENGTH) });
    expect(parseCustomStyles({})).toEqual({});
    expect(parseCustomStyles({ name: "Ember Studio" })).toEqual({});
  });

  it.each([
    ["no body", null, "Expected a JSON object"],
    ["a list", [{ customStyles: "" }], "Expected a JSON object"],
    ["CSS that isn't text", { customStyles: null }, "Custom CSS must be at most 100,000 characters"],
    ["CSS that's too long", { customStyles: "x".repeat(MAX_CUSTOM_STYLES_LENGTH + 1) }, "Custom CSS must be at most 100,000 characters"],
  ])("refuses %s and says why", (_, body, error) => {
    expect(parseCustomStyles(body)).toBe(error);
  });
});

describe(feature("accounts.roles"), () => {
  it("makes someone an administrator only for exactly \"administrator\", and a member for anything else", () => {
    expect(parseRoleChange({ role: "administrator" })).toEqual({ role: "administrator" });
    for (const role of ["member", "", "Administrator", " administrator", "bot", null, 1, ["administrator"]]) {
      expect(parseRoleChange({ role }), JSON.stringify(role)).toEqual({ role: "member" });
    }
  });

  it.each([
    ["no body", null],
    ["a list", [{ role: "administrator" }]],
    ["text", "administrator"],
    ["an object without a role", { name: "Grace" }],
  ])("finds no role change in %s", (_, body) => {
    expect(parseRoleChange(body)).toBeNull();
  });
});

describe(feature("notifications.levels"), () => {
  it("takes exactly one of the four levels", () => {
    expect(INVOLVEMENTS).toEqual(["mentions", "everything", "nothing", "invisible"]);
    for (const involvement of INVOLVEMENTS) {
      expect(isInvolvement(involvement)).toBe(true);
      expect(parseInvolvementChange({ involvement })).toBe(involvement);
    }
  });

  it.each([
    ["no body", null],
    ["text", "everything"],
    ["an object without a level", { level: "everything" }],
    ["a blank level", { involvement: "" }],
    ["a level in capitals", { involvement: "Everything" }],
    ["a level with spaces", { involvement: " nothing" }],
    ["another word", { involvement: "all" }],
    ["a list", { involvement: ["mentions"] }],
    ["a number", { involvement: 1 }],
  ])("finds no level in %s", (_, body) => {
    expect(parseInvolvementChange(body)).toBeNull();
  });

  it("starts DMs at all messages and other rooms at @mentions", () => {
    expect(startingInvolvement({ id: "general", kind: "open", name: "general", icon: null })).toBe("mentions");
    expect(startingInvolvement({ id: "secret", kind: "closed", name: "secret", icon: null })).toBe("mentions");
    expect(startingInvolvement({ id: "dm", kind: "direct", members: [], activeAt: "2026-10-16T00:00:00.000Z" })).toBe("everything");
  });
});

describe(feature("users.profile"), () => {
  it("takes each field as typed, even blank, leaving out what isn't sent", () => {
    const typed = { name: " ", emailAddress: "", password: "  ", bio: "Countess of Lovelace\n", currentPassword: " ", pushSubscriptionEndpoint: "" };
    expect(parseProfileChanges(typed)).toEqual(typed);
    expect(parseProfileChanges({ name: "Ada", avatar: "" })).toEqual({ name: "Ada" });
    expect(parseProfileChanges({})).toEqual({});
  });

  it("takes as long a name and email address as Ember keeps, a password as long as sign-in does, and a bio as long as the form lets anyone type", () => {
    const longest = {
      name: "x".repeat(MAX_USER_NAME_LENGTH),
      emailAddress: `${"x".repeat(MAX_EMAIL_ADDRESS_LENGTH - "@example.com".length)}@example.com`,
      password: "🔐".repeat(MAX_PASSWORD_LENGTH / 2),
      bio: "x".repeat(MAX_BIO_LENGTH),
      pushSubscriptionEndpoint: `https://fcm.googleapis.com/${"x".repeat(MAX_PUSH_ENDPOINT_LENGTH - "https://fcm.googleapis.com/".length)}`,
    };
    expect(parseProfileChanges(longest)).toEqual(longest);
  });

  it.each([
    ["no body", null, "Expected a JSON object"],
    ["a list", [{ name: "Ada" }], "Expected a JSON object"],
    ["a name that isn't text", { name: null }, "Name must be text"],
    ["an email address that isn't text", { emailAddress: ["ada@example.com"] }, "Email address must be text"],
    ["a password that isn't text", { password: 12345678 }, "Password must be text"],
    ["a bio that isn't text", { bio: false }, "Bio must be text"],
    ["a name longer than Ember keeps", { name: "x".repeat(MAX_USER_NAME_LENGTH + 1) }, "Name must be at most 100 characters"],
    ["an email address longer than any deliverable one", { emailAddress: `${"x".repeat(MAX_EMAIL_ADDRESS_LENGTH)}@example.com` }, "Email address must be at most 254 characters"],
    ["a password longer than sign-in takes", { password: "x".repeat(MAX_PASSWORD_LENGTH + 1) }, "Password must be at most 72 characters."],
    ["a bio longer than the form takes", { bio: "x".repeat(MAX_BIO_LENGTH + 1) }, "Bio must be at most 200 characters"],
    ["a current password that isn't text", { currentPassword: 12345678 }, "Current password must be text"],
    ["an endpoint that isn't text", { pushSubscriptionEndpoint: {} }, "Push subscription endpoint must be text"],
    ["an endpoint longer than a subscription's", { pushSubscriptionEndpoint: "x".repeat(MAX_PUSH_ENDPOINT_LENGTH + 1) }, "Endpoint can't be longer than 2048 characters"],
  ])("refuses %s and says why", (_, body, error) => {
    expect(parseProfileChanges(body)).toBe(error);
  });
});

describe(feature("accounts.reset-password"), () => {
  it("takes an email address and a password as they're given", () => {
    expect(parsePasswordReset({ emailAddress: " Ada@example.com", password: "  correct horse  " })).toEqual({
      emailAddress: " Ada@example.com",
      password: "  correct horse  ",
    });
  });

  it.each([
    ["no body", null, "Expected a JSON object"],
    ["text", "ada@example.com", "Expected a JSON object"],
    ["no email address", { password: "correct horse" }, "Email address and password are required"],
    ["a blank email address", { emailAddress: "", password: "correct horse" }, "Email address and password are required"],
    ["an email address that isn't text", { emailAddress: ["ada@example.com"], password: "correct horse" }, "Email address and password are required"],
    ["no password", { emailAddress: "ada@example.com" }, "Email address and password are required"],
    ["a password that isn't text", { emailAddress: "ada@example.com", password: 12345678 }, "Email address and password are required"],
  ])("refuses %s and says why", (_, body, error) => {
    expect(parsePasswordReset(body)).toBe(error);
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
    ["a name longer than Ember keeps", { name: "x".repeat(MAX_USER_NAME_LENGTH + 1), emailAddress: "ada@example.com", password: "secret words" }, "Name must be at most 100 characters"],
    [
      "an email address longer than any deliverable one",
      { name: "Ada", emailAddress: `${"x".repeat(MAX_EMAIL_ADDRESS_LENGTH)}@example.com`, password: "secret words" },
      "Email address must be at most 254 characters",
    ],
  ])("refuses %s and says why", (_, body, error) => {
    expect(parseSignUp(body)).toBe(error);
  });

  it("takes a name and an email address as long as Ember keeps, counting the name once trimmed", () => {
    const name = "x".repeat(MAX_USER_NAME_LENGTH);
    const emailAddress = `${"x".repeat(MAX_EMAIL_ADDRESS_LENGTH - "@example.com".length)}@example.com`;
    expect(parseSignUp({ name: ` ${name} `, emailAddress, password: "secret words" })).toEqual({ name, emailAddress, password: "secret words" });
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
