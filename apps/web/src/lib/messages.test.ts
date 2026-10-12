import type { Message } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { avatarColor, crc32, initials } from "./avatar";
import { dayLabel, mentions, timeline } from "./messages";

const at = (iso: string, creatorId = "u1"): Message => ({
  id: iso,
  clientMessageId: iso,
  roomId: "general",
  creator: { id: creatorId, name: creatorId },
  body: "",
  createdAt: iso,
  updatedAt: iso,
  boosts: [],
});

describe("timeline", () => {
  it("threads quick follow-ups from the same person and separates days", () => {
    const items = timeline(
      [
        at("2026-10-11T12:00:00"),
        at("2026-10-12T09:00:00"),
        at("2026-10-12T09:02:00"),
        at("2026-10-12T09:03:00", "u2"),
        at("2026-10-12T09:30:00", "u2"),
      ],
      new Date("2026-10-12T18:00:00"),
    );
    expect(items.map((i) => i.daySeparator)).toEqual(["Yesterday", "Today", null, null, null]);
    expect(items.map((i) => i.threaded)).toEqual([false, false, true, false, false]);
  });

  it("names older days", () => {
    expect(dayLabel(new Date("2026-10-01T12:00:00"), new Date("2026-10-12T12:00:00"))).toMatch(/October/);
  });
});

describe("mentions", () => {
  it("matches the whole name, ignoring case", () => {
    expect(mentions("thanks @ada!", "Ada")).toBe(true);
    expect(mentions("ask @Adam", "Ada")).toBe(false);
    expect(mentions("ada, are you there?", "Ada")).toBe(false);
  });

  it("handles names that start or end outside ASCII letters", () => {
    expect(mentions("@José, lunch?", "José")).toBe(true);
    expect(mentions("@Joséphine, lunch?", "José")).toBe(false);
    expect(mentions("@Jose\u0301", "Jose")).toBe(false);
    expect(mentions("hi @Alice!", "Alice!")).toBe(true);
    expect(mentions("hi @Ünal", "Ünal")).toBe(true);
  });

  it("treats the name as text, not a pattern", () => {
    expect(mentions("@a.b", "a.b")).toBe(true);
    expect(mentions("@axb", "a.b")).toBe(false);
  });
});

describe("avatars", () => {
  it("matches zlib's CRC32, which ember-rust uses to pick colors", () => {
    expect(crc32("1")).toBe(0x83dcefb7);
    expect(avatarColor("1")).toBe(avatarColor("1"));
  });

  it("takes the first letter of each word", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("grace")).toBe("g");
  });
});
