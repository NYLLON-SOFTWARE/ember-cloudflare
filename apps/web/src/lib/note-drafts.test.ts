import type { NoteFile, SavedItem } from "@ember/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { baseOf, draftKeyOf, keepDraft, readDraft, rescueDraft, startingDraft } from "./note-drafts";

const file = (id: string): NoteFile => ({ id, name: `${id}.txt`, contentType: "text/plain", byteSize: 1, url: `/f/${id}`, downloadUrl: `/f/${id}?download` });

const note = (changes: Partial<SavedItem> = {}): SavedItem => ({
  id: "n1",
  list: "todo",
  kind: "note",
  body: "<p>Call Grace</p>",
  plainText: "Call Grace",
  files: [file("a")],
  completedAt: null,
  remindAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...changes,
});

const key = draftKeyOf("u1", "n1");
const fresh = draftKeyOf("u1");

afterEach(() => localStorage.clear());

describe("A to-do's draft", () => {
  it("survives a reminder or completing the note, which don't change what it holds", () => {
    keepDraft(key, { html: "<p>Call Grace and Lin</p>", files: [file("a"), file("b")], base: baseOf(note()) });
    const reminded = note({ remindAt: "2026-11-20T09:00:00.000Z", completedAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z" });
    expect(startingDraft(key, reminded)).toEqual({ html: "<p>Call Grace and Lin</p>", files: [file("a"), file("b")] });
  });

  it("gives way to the note's text or files changed since, and forgets itself", () => {
    keepDraft(key, { html: "<p>Old</p>", files: [], base: baseOf(note()) });
    expect(startingDraft(key, note({ body: "<p>Changed elsewhere</p>" }))).toEqual({ html: "<p>Changed elsewhere</p>", files: [file("a")] });
    expect(readDraft(key)).toBeNull();
    keepDraft(key, { html: "<p>Old</p>", files: [], base: baseOf(note()) });
    expect(startingDraft(key, note({ files: [] })).html).toBe("<p>Call Grace</p>");
  });

  it("keeps files attached and not saved, with the text as it was", () => {
    keepDraft(key, { html: "<p>Call Grace</p>", files: [file("a"), file("b")], base: baseOf(note()) });
    expect(startingDraft(key, note())).toEqual({ html: "<p>Call Grace</p>", files: [file("a"), file("b")] });
  });

  it("keeps text cleared from a note that has files cleared", () => {
    keepDraft(key, { html: "", files: [file("a")], base: baseOf(note()) });
    expect(startingDraft(key, note())).toEqual({ html: "", files: [file("a")] });
  });

  it("goes to a new to-do when its note is cleared elsewhere, with the files added since but not the note's", () => {
    keepDraft(fresh, { html: "<p>Buy milk</p>", files: [file("c")], base: "" });
    keepDraft(key, { html: "<p>Call Lin</p>", files: [file("a"), file("b")], base: baseOf(note()) });
    expect(rescueDraft(key, fresh)).toBe(true);
    expect(readDraft(key)).toBeNull();
    expect(startingDraft(fresh, undefined)).toEqual({ html: "<p>Buy milk</p><p>Call Lin</p>", files: [file("c"), file("b")] });
  });
});
