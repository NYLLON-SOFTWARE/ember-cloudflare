import { describe, expect, it } from "vitest";
import { MAX_ACTIVITY_MARKS, mentionsEveryone, parseActivityCursor, parseActivityMarks, previewOf } from "./activity.ts";

describe("mentionsEveryone", () => {
  it("finds @channel, @here and @everyone as words, in any case", () => {
    for (const text of ["@channel", "hey @here!", "@Everyone look", "(@channel)"]) expect(mentionsEveryone(text), text).toBe(true);
  });

  it("leaves out addresses and longer words", () => {
    for (const text of ["mail me@here.com", "@channels", "@@here", "channel", "@herein"]) expect(mentionsEveryone(text), text).toBe(false);
  });
});

describe("previewOf", () => {
  it("runs whitespace together and cuts long text with an ellipsis", () => {
    expect(previewOf("  a\n\n b  ")).toBe("a b");
    const long = previewOf("x".repeat(1000));
    expect(long).toHaveLength(280);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("parseActivityMarks", () => {
  it("takes ids to mark read or unread, once each", () => {
    expect(parseActivityMarks({ ids: [3, 1, 3], read: false })).toEqual({ ids: [3, 1], read: false });
  });

  it("takes every item, only to mark read", () => {
    expect(parseActivityMarks({ all: true, read: true })).toEqual({ all: true, read: true });
    expect(parseActivityMarks({ all: true, read: false })).toBeTypeOf("string");
  });

  it("refuses anything else", () => {
    for (const data of [null, "x", { ids: [], read: true }, { ids: [1.5], read: true }, { ids: [-1], read: true }, { ids: ["1"], read: true }, { ids: [1] }]) {
      expect(parseActivityMarks(data), JSON.stringify(data)).toBeTypeOf("string");
    }
    expect(parseActivityMarks({ ids: Array.from({ length: MAX_ACTIVITY_MARKS + 1 }, (_, i) => i + 1), read: true })).toBeTypeOf("string");
  });
});

describe("parseActivityCursor", () => {
  it("reads a positive item id, or null", () => {
    expect(parseActivityCursor("42")).toBe(42);
    for (const before of [null, "", "0", "-1", "1e3", "abc", "9".repeat(20)]) expect(parseActivityCursor(before), String(before)).toBeNull();
  });
});
