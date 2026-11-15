import type { User } from "@ember/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingMessage } from "./room-state";
import { forgetInRoom, forgetUnsent, keepUnsent, keptInRoom, keptUnsent, onTakenElsewhere } from "./unsent-store";

const ada: User = { id: "u1", name: "Ada" };

/** A message Ada wrote at `minute` past ten while the room was away. */
const waiting = (body: string, minute: number, overrides: Partial<PendingMessage> = {}): PendingMessage => ({
  id: body,
  clientMessageId: body,
  roomId: "general",
  creator: ada,
  body,
  plainText: body,
  mentions: [],
  createdAt: `2026-11-12T10:${String(minute).padStart(2, "0")}:00.000Z`,
  updatedAt: `2026-11-12T10:${String(minute).padStart(2, "0")}:00.000Z`,
  editedAt: null,
  boosts: [],
  pending: true,
  queued: true,
  ...overrides,
});

const bodies = (messages: PendingMessage[]) => messages.map((m) => m.body);

/** What another tab's writes tell this one, as the browser tells every tab but the one writing, a key at a time. */
function writtenElsewhere(write: () => void) {
  const before: Record<string, string> = { ...localStorage };
  write();
  const after: Record<string, string> = { ...localStorage };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const oldValue = before[key] ?? null;
    const newValue = after[key] ?? null;
    if (oldValue !== newValue) window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue }));
  }
}

/** Runs `write` as another tab whose copy of this browser's storage is still `stale`, as one in another process can be. */
function readingFrom(stale: Record<string, string>, write: () => void) {
  const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => stale[key] ?? null);
  write();
  getItem.mockRestore();
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("Two tabs of the same room", () => {
  it("keep what each has waiting side by side, in the order it was written", () => {
    keepUnsent("general", ada.id, undefined, [waiting("G1", 1)]);
    keepUnsent("general", ada.id, undefined, [waiting("T3", 0)]);
    expect(bodies(keptUnsent("general", ada.id))).toEqual(["T3", "G1"]);
  });

  it("take out only what each has sent or deleted", () => {
    const tab1 = keepUnsent("general", ada.id, undefined, [waiting("G1", 1), waiting("G2", 2)]);
    keepUnsent("general", ada.id, undefined, [waiting("E2", 3)]);
    keepUnsent("general", ada.id, undefined, [waiting("G2", 2)], tab1);
    expect(bodies(keptUnsent("general", ada.id))).toEqual(["G2", "E2"]);
  });

  it("replace a message they both have with the copy kept last", () => {
    keepUnsent("general", ada.id, undefined, [waiting("G1", 1)]);
    keepUnsent("general", ada.id, undefined, [waiting("G1", 1, { queued: undefined, failed: true })]);
    expect(keptUnsent("general", ada.id)).toEqual([waiting("G1", 1, { queued: undefined, failed: true })]);
  });

  it("hear what the other takes out, and nothing it adds", () => {
    const taken = vi.fn();
    const stop = onTakenElsewhere("general", ada.id, undefined, taken);
    writtenElsewhere(() => keepUnsent("general", ada.id, undefined, [waiting("G1", 1), waiting("G2", 2)]));
    expect(taken).not.toHaveBeenCalled();
    writtenElsewhere(() => keepUnsent("general", ada.id, undefined, [], ["G1", "G2"]));
    expect(taken.mock.calls.flat(2)).toEqual(["G1", "G2"]);

    // A thread's are its own.
    taken.mockClear();
    writtenElsewhere(() => keepUnsent("general", ada.id, "m1", [waiting("R1", 1, { parentId: "m1" })]));
    writtenElsewhere(() => keepUnsent("general", ada.id, "m1", [], ["R1"]));
    expect(taken).not.toHaveBeenCalled();

    stop();
    writtenElsewhere(() => keepUnsent("general", ada.id, undefined, [waiting("G3", 3)]));
    writtenElsewhere(() => keepUnsent("general", ada.id, undefined, [], ["G3"]));
    expect(taken).not.toHaveBeenCalled();
  });

  it("never write over what the other keeps, though what one has read of it is from before the other wrote", () => {
    const stale: Record<string, string> = { ...localStorage };
    const tab1 = keepUnsent("general", ada.id, undefined, [waiting("G1", 1)]);
    const taken = vi.fn();
    const stop = onTakenElsewhere("general", ada.id, undefined, taken);
    writtenElsewhere(() => readingFrom(stale, () => keepUnsent("general", ada.id, undefined, [waiting("E2", 2)])));
    stop();
    expect(taken).not.toHaveBeenCalled();
    expect(bodies(keptUnsent("general", ada.id))).toEqual(["G1", "E2"]);
    keepUnsent("general", ada.id, undefined, [], tab1);
    expect(bodies(keptUnsent("general", ada.id))).toEqual(["E2"]);
  });
});

describe("What an earlier release kept, a list under a key for each view", () => {
  beforeEach(() => {
    localStorage.setItem("unsent-u1-general", JSON.stringify([waiting("G1", 1), waiting("G2", 2, { queued: undefined, failed: true })]));
    localStorage.setItem("unsent-u1-general-m1", JSON.stringify([waiting("R1", 0, { parentId: "m1" })]));
  });

  it("is taken back, and kept from then on a message to a key", () => {
    expect(keptUnsent("general", ada.id)).toEqual([waiting("G1", 1), waiting("G2", 2, { queued: undefined, failed: true })]);
    expect(bodies(keptUnsent("general", ada.id, "m1"))).toEqual(["R1"]);
    expect(Object.keys(localStorage).sort()).toEqual(["unsent-u1-general-m1:R1", "unsent-u1-general:G1", "unsent-u1-general:G2"]);
    forgetInRoom("general", ada.id, ["G2"]);
    expect(bodies(keptInRoom("general", ada.id))).toEqual(["R1", "G1"]);
  });

  it("isn't taken from the other tabs as one tab moves it", () => {
    const taken = vi.fn();
    const stop = onTakenElsewhere("general", ada.id, undefined, taken);
    writtenElsewhere(() => keptInRoom("general", ada.id));
    stop();
    expect(taken).not.toHaveBeenCalled();
  });
});

describe("What the room has", () => {
  it("is forgotten wherever its view kept it", () => {
    keepUnsent("general", ada.id, undefined, [waiting("G1", 1), waiting("G2", 2)]);
    keepUnsent("general", ada.id, "m1", [waiting("R1", 1, { parentId: "m1" })]);
    forgetUnsent("general", [waiting("G1", 1), waiting("R1", 1, { parentId: "m1" })]);
    expect(bodies(keptUnsent("general", ada.id))).toEqual(["G2"]);
    expect(keptUnsent("general", ada.id, "m1")).toEqual([]);
  });
});

describe("A room that's gone", () => {
  it("has what was kept in its timeline and its threads, but not another room's whose id starts the same", () => {
    keepUnsent("general", ada.id, undefined, [waiting("G1", 2)]);
    keepUnsent("general", ada.id, "m1", [waiting("R1", 1, { parentId: "m1" })]);
    keepUnsent("general-2", ada.id, undefined, [waiting("Elsewhere", 0, { roomId: "general-2" })]);
    expect(bodies(keptInRoom("general", ada.id))).toEqual(["R1", "G1"]);
  });

  it("forgets each as it's deleted, and what's kept for it with the last", () => {
    keepUnsent("general", ada.id, undefined, [waiting("G1", 2)]);
    keepUnsent("general", ada.id, "m1", [waiting("R1", 1, { parentId: "m1" })]);
    keepUnsent("general-2", ada.id, undefined, [waiting("Elsewhere", 0, { roomId: "general-2" })]);
    forgetInRoom("general", ada.id, ["R1"]);
    expect(bodies(keptInRoom("general", ada.id))).toEqual(["G1"]);
    forgetInRoom("general", ada.id, ["G1"]);
    expect(Object.keys(localStorage)).toEqual(["unsent-u1-general-2:Elsewhere"]);
  });
});
