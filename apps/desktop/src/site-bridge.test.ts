import { describe, expect, it } from "vitest";
import { countOf, notificationOf } from "./site-bridge.ts";

const MESSAGE = { id: "message:42", title: "Designers", body: "Ada: Lunch?", path: "/rooms/7" };

describe("notificationOf", () => {
  it("takes a notification of a page on the site", () => {
    expect(notificationOf(MESSAGE)).toEqual(MESSAGE);
    expect(notificationOf({ ...MESSAGE, path: "/rooms/7/threads/9#message_10", extra: true })).toEqual({ ...MESSAGE, path: "/rooms/7/threads/9#message_10" });
  });

  it("refuses one without an id, words or a page, or of a page elsewhere", () => {
    for (const value of [
      null,
      "Ada: Lunch?",
      { ...MESSAGE, id: "" },
      { ...MESSAGE, id: "x".repeat(201) },
      { ...MESSAGE, title: 1 },
      { ...MESSAGE, body: undefined },
      { ...MESSAGE, path: "rooms/7" },
      { ...MESSAGE, path: "//example.com/rooms/7" },
      { ...MESSAGE, path: "/\\example.com/rooms/7" },
      { ...MESSAGE, path: "https://example.com/rooms/7" },
    ]) {
      expect(notificationOf(value)).toBeNull();
    }
  });

  it("shortens a long title or body, without splitting a character", () => {
    const shown = notificationOf({ ...MESSAGE, title: "🔥".repeat(300), body: "a".repeat(1001) });
    expect([...shown!.title]).toHaveLength(200);
    expect(shown!.title.endsWith("🔥…")).toBe(true);
    expect(shown!.body).toBe(`${"a".repeat(999)}…`);
  });
});

describe("countOf", () => {
  it("takes a count of conversations", () => {
    expect(countOf(0)).toBe(0);
    expect(countOf(12)).toBe(12);
  });

  it("refuses anything else", () => {
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "3", null]) expect(countOf(value)).toBeNull();
  });
});
