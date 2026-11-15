import { describe, expect, it } from "vitest";
import { isRemindableAt, MAX_NOTE_FILES, MAX_REMIND_AHEAD_MS, parseNewSavedItem, parseSavedChange, REMINDER_NOT_IN_SAVED, savedPath } from "./index";

describe("parseNewSavedItem", () => {
  it("takes a message to keep in either list, by its room and id", () => {
    expect(parseNewSavedItem({ list: "saved", roomId: "general", messageId: "m1" })).toEqual({ list: "saved", roomId: "general", messageId: "m1" });
    expect(parseNewSavedItem({ list: "todo", roomId: "general", messageId: "m1" })).toEqual({ list: "todo", roomId: "general", messageId: "m1" });
  });

  it("takes a reminder for a message kept in To-dos, and none for one in Saved", () => {
    const remindAt = "2030-01-01T09:00:00.000Z";
    expect(parseNewSavedItem({ list: "todo", roomId: "general", messageId: "m1", remindAt })).toEqual({ list: "todo", roomId: "general", messageId: "m1", remindAt });
    expect(parseNewSavedItem({ list: "saved", roomId: "general", messageId: "m1", remindAt })).toBe(REMINDER_NOT_IN_SAVED);
    expect(parseNewSavedItem({ list: "todo", roomId: "general", messageId: "m1", remindAt: "soon" })).toBe("A reminder needs a time");
    expect(parseNewSavedItem({ list: "todo", roomId: "general", messageId: "m1", remindAt: null })).toBe("A reminder needs a time");
  });

  it("takes a note of your own only for To-dos", () => {
    expect(parseNewSavedItem({ list: "todo", body: "<p>Call Ada</p>" })).toEqual({ list: "todo", body: "<p>Call Ada</p>" });
    expect(parseNewSavedItem({ list: "todo", body: "", fileIds: ["a", "b"], remindAt: "2030-01-01T09:00:00.000Z" })).toEqual({
      list: "todo",
      body: "",
      fileIds: ["a", "b"],
      remindAt: "2030-01-01T09:00:00.000Z",
    });
    expect(parseNewSavedItem({ list: "saved", body: "<p>x</p>" })).toBe("Add notes of your own to To-dos");
  });

  it("refuses anything else", () => {
    expect(parseNewSavedItem(null)).toBe("Say what to keep");
    expect(parseNewSavedItem({ list: "later", roomId: "r", messageId: "m" })).toBe("Items go in To-dos or Saved");
    expect(parseNewSavedItem({ list: "saved", roomId: "r" })).toBe("Keep a message by its room and id");
    expect(parseNewSavedItem({ list: "todo", body: "x".repeat(100_001) })).toBe("A to-do's text is too long");
    expect(parseNewSavedItem({ list: "todo", body: "", fileIds: ["a", "a"] })).toMatch(/files/);
    expect(parseNewSavedItem({ list: "todo", body: "", fileIds: Array.from({ length: MAX_NOTE_FILES + 1 }, (_, i) => `f${i}`) })).toMatch(/files/);
    expect(parseNewSavedItem({ list: "todo", body: "", remindAt: "soon" })).toBe("A reminder needs a time");
  });
});

describe("parseSavedChange", () => {
  it("takes a list, completion, a reminder or its clearing, and a note's text and files", () => {
    expect(parseSavedChange({ list: "saved" })).toEqual({ list: "saved" });
    expect(parseSavedChange({ completed: true, remindAt: null })).toEqual({ completed: true, remindAt: null });
    expect(parseSavedChange({ body: "<p>x</p>", fileIds: [] })).toEqual({ body: "<p>x</p>", fileIds: [] });
    expect(parseSavedChange({ list: "todo", remindAt: "2030-01-01T09:00:00.000Z" })).toEqual({ list: "todo", remindAt: "2030-01-01T09:00:00.000Z" });
    expect(parseSavedChange({ list: "saved", remindAt: null })).toEqual({ list: "saved", remindAt: null });
  });

  it("refuses a reminder for an item moving to Saved, which keeps none", () => {
    expect(parseSavedChange({ list: "saved", remindAt: "2030-01-01T09:00:00.000Z" })).toBe(REMINDER_NOT_IN_SAVED);
  });

  it("refuses an empty or malformed change", () => {
    expect(parseSavedChange({})).toBe("Say what to change");
    expect(parseSavedChange({ completed: "yes" })).toBe("An item is completed or not");
    expect(parseSavedChange({ list: "inbox" })).toBe("Items go in To-dos or Saved");
    expect(parseSavedChange({ remindAt: 5 })).toBe("A reminder needs a time");
  });
});

describe("isRemindableAt", () => {
  it("takes a time in the next year", () => {
    const now = Date.parse("2026-11-12T00:00:00.000Z");
    expect(isRemindableAt("2026-11-12T01:00:00.000Z", now)).toBe(true);
    expect(isRemindableAt("2026-11-11T23:00:00.000Z", now)).toBe(false);
    expect(isRemindableAt(new Date(now + MAX_REMIND_AHEAD_MS + 1).toISOString(), now)).toBe(false);
  });
});

describe("savedPath", () => {
  it("names each list's page and an item's", () => {
    expect(savedPath("todo")).toBe("/todos");
    expect(savedPath("saved", "a b")).toBe("/saved/a%20b");
  });
});
