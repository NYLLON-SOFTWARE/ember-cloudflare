import { describe, expect, it } from "vitest";
import type { DirectRoom, Message, Room, SavedItem, SharedRoom } from "@ember/protocol";
import { fileTypeLabel, originOf, reminderChoices, shows, sorted, summaryOf } from "./kept";

const item = (changes: Partial<SavedItem>): SavedItem => ({
  id: "i",
  list: "todo",
  kind: "message",
  completedAt: null,
  remindAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...changes,
});

const message = (changes: Partial<Message> = {}): Message => ({
  id: "m",
  clientMessageId: "c",
  roomId: "general",
  creator: { id: "ada", name: "Ada" },
  body: "<p>Ship it</p>",
  plainText: "Ship it\nToday",
  mentions: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  editedAt: null,
  boosts: [],
  ...changes,
});

const general = { id: "general", kind: "open", name: "general" } as SharedRoom;
const dm: DirectRoom = { id: "dm", kind: "direct", activeAt: "", members: [{ id: "me", name: "Me" }, { id: "ada", name: "Ada" }, { id: "grace", name: "Grace" }] };
const rooms = new Map<string, Room>([[general.id, general], [dm.id, dm]]);
const nameOf = ({ name }: { name: string }) => name;

describe("originOf", () => {
  it("names a room, a DM's others, and a thread", () => {
    expect(originOf(item({ roomId: "general", message: message() }), rooms, "me", nameOf)).toBe("#general");
    expect(originOf(item({ roomId: "dm", message: message({ roomId: "dm" }) }), rooms, "me", nameOf)).toBe("DM with Ada and Grace");
    expect(originOf(item({ roomId: "general", message: message({ parentId: "p" }) }), rooms, "me", nameOf)).toBe("Thread in #general");
  });

  it("says nothing of a note, nor of an unavailable item's room, which its summary says it is", () => {
    expect(originOf(item({ kind: "note" }), rooms, "me", nameOf)).toBe("");
    expect(originOf(item({ roomId: "gone", unavailable: true }), rooms, "me", nameOf)).toBe("");
  });
});

describe("summaryOf", () => {
  it("shows a message's first line, a file's name, or that it's gone", () => {
    expect(summaryOf(item({ message: message() }))).toBe("Ship it");
    expect(summaryOf(item({ kind: "file", message: message({ attachment: { name: "deck.pdf" } as Message["attachment"] }) }))).toBe("deck.pdf");
    expect(summaryOf(item({ message: null }))).toBe("This message was deleted");
    expect(summaryOf(item({ unavailable: true }))).toBe("This message is unavailable");
    expect(summaryOf(item({ kind: "note", plainText: "\nCall Ada" }))).toBe("Call Ada");
  });
});

describe("shows and sorted", () => {
  const a = item({ id: "a", createdAt: "2026-11-01T00:00:00.000Z", remindAt: "2026-11-20T00:00:00.000Z" });
  const b = item({ id: "b", kind: "note", createdAt: "2026-11-02T00:00:00.000Z" });
  const c = item({ id: "c", createdAt: "2026-11-03T00:00:00.000Z", remindAt: "2026-11-10T00:00:00.000Z" });

  it("filters by kind and reminder", () => {
    expect([a, b, c].filter((i) => shows("notes", i)).map(({ id }) => id)).toEqual(["b"]);
    expect([a, b, c].filter((i) => shows("reminders", i)).map(({ id }) => id)).toEqual(["a", "c"]);
  });

  it("sorts newest or oldest first, or by reminder with none last", () => {
    expect(sorted([a, b, c], "newest").map(({ id }) => id)).toEqual(["c", "b", "a"]);
    expect(sorted([a, b, c], "oldest").map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(sorted([a, b, c], "reminder").map(({ id }) => id)).toEqual(["c", "a", "b"]);
  });
});

describe("reminderChoices", () => {
  it("offers times ahead, tomorrow and next Monday at 9", () => {
    const now = new Date(2026, 10, 12, 15, 30); // a Thursday
    const [twenty, , , tomorrow, monday] = reminderChoices(now);
    expect(twenty!.at.getTime() - now.getTime()).toBe(20 * 60_000);
    expect([tomorrow!.at.getDate(), tomorrow!.at.getHours()]).toEqual([13, 9]);
    expect([monday!.at.getDay(), monday!.at.getDate(), monday!.at.getHours()]).toEqual([1, 16, 9]);
  });
});

describe("fileTypeLabel", () => {
  it("names a file's type as people do, or by its extension", () => {
    expect(fileTypeLabel({ contentType: "text/plain", name: "notes.txt" })).toBe("Text");
    expect(fileTypeLabel({ contentType: "application/pdf", name: "deck.pdf" })).toBe("PDF");
    expect(fileTypeLabel({ contentType: "image/png", name: "a.png" })).toBe("Image");
    expect(fileTypeLabel({ contentType: "image/svg+xml", name: "logo.svg" })).toBe("SVG");
    expect(fileTypeLabel({ contentType: "application/octet-stream", name: "build.dmg" })).toBe("DMG");
    expect(fileTypeLabel({ contentType: "application/octet-stream", name: "README" })).toBe("File");
  });
});
