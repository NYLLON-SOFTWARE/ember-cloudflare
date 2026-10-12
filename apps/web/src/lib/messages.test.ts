import type { Message } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { avatarColor, crc32, initials } from "./avatar";
import { dayLabel, timeline } from "./messages";

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
