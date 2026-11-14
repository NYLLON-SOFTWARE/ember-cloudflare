import type { ScheduledMessage, ServerFrame, User } from "@ember/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeScheduled, REFUSED, restoreScheduled, restoringOf, SCHEDULED_CHANGE_TIMEOUT_MS } from "./scheduled-actions";

/** Stands in for the browser's WebSocket; tests play the room. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static all: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
    this.readyState = FakeSocket.CLOSED;
  }

  /** Lets the socket in, as the room does, saying what's scheduled there first. */
  letIn(scheduled: ScheduledMessage[]) {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.(new Event("open"));
    this.receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0 });
    if (scheduled.length > 0) this.receive({ type: "scheduled", messages: scheduled });
  }

  receive(frame: ServerFrame) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }
}

const ada: User = { id: "u1", name: "Ada" };
const socket = () => FakeSocket.all.at(-1)!;
const later = Date.now() + 3_600_000;
const lunch: ScheduledMessage = { id: "s1", body: "<p>lunch?</p>", sendAt: later };
const reply: ScheduledMessage = { id: "s2", body: "<p>on it</p>", sendAt: later + 1, parentId: "m7", alsoSend: true };

beforeEach(() => {
  localStorage.clear();
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Changing a scheduled message from outside its room", () => {
  it("deletes it over a hidden tab's socket of its own, answering it as the room had it, once the room says it's gone", async () => {
    const changed = changeScheduled("general", { type: "delete", id: "s1" });
    expect(socket().url).toContain("/api/rooms/general/socket");
    expect(socket().url).toContain("visible=0");
    socket().letIn([lunch, reply]);
    expect(socket().sent).toEqual([{ type: "scheduled.delete", id: "s1" }]);
    socket().receive({ type: "scheduled", messages: [reply] });
    await expect(changed).resolves.toEqual(lunch);
    expect(socket().closed).toBe(true);
  });

  it("sends one now, and moves one, once the room shows it done", async () => {
    const sentNow = changeScheduled("general", { type: "send", id: "s1" });
    socket().letIn([lunch]);
    expect(socket().sent).toEqual([{ type: "scheduled.send", id: "s1" }]);
    socket().receive({ type: "scheduled", messages: [] });
    await expect(sentNow).resolves.toEqual(lunch);

    const moved = changeScheduled("random", { type: "move", id: "s2", sendAt: later + 60_000 });
    socket().letIn([reply]);
    expect(socket().sent).toEqual([{ type: "scheduled.update", id: "s2", sendAt: later + 60_000 }]);
    socket().receive({ type: "scheduled", messages: [{ ...reply, sendAt: later + 60_000 }] });
    await expect(moved).resolves.toEqual(reply);
  });

  it("schedules a deleted one again, as Undo does, in its thread, with the id it's given", async () => {
    const restored = changeScheduled("random", { type: "restore", message: reply, clientMessageId: "c1" });
    socket().letIn([]);
    expect(socket().sent).toEqual([{ type: "scheduled.create", clientMessageId: "c1", body: reply.body, sendAt: reply.sendAt, parentId: "m7", alsoSend: true }]);
    socket().receive({ type: "scheduled", messages: [{ ...reply, id: "s3" }] });
    await expect(restored).resolves.toEqual(reply);
  });

  it("answers when the room refuses the change, and null when it doesn't answer in time", async () => {
    const refused = changeScheduled("general", { type: "send", id: "s1" });
    socket().letIn([lunch]);
    socket().receive({ type: "error", message: "That scheduled message is gone.", failed: "scheduled.send" });
    await expect(refused).resolves.toBe(REFUSED);
    expect(socket().closed).toBe(true);

    const unanswered = changeScheduled("general", { type: "delete", id: "s1" });
    vi.advanceTimersByTime(SCHEDULED_CHANGE_TIMEOUT_MS);
    await expect(unanswered).resolves.toBeNull();
    expect(socket().closed).toBe(true);
  });

  it("keeps an Undo in this browser until its room has it, so a reload or a room out of reach doesn't lose it", async () => {
    const what = { roomId: "general", message: lunch, clientMessageId: "c1" };
    const unanswered = restoreScheduled("u1", what);
    // Kept before anything is sent: a reload now finds it.
    expect(restoringOf("u1")).toEqual([what]);
    expect(restoringOf("u2")).toEqual([]);
    vi.advanceTimersByTime(SCHEDULED_CHANGE_TIMEOUT_MS);
    await expect(unanswered).resolves.toBeNull();
    expect(restoringOf("u1")).toEqual([what]);

    // Sent again, with the same id, which the room keeps once, it's forgotten once the room has it.
    const again = restoreScheduled("u1", what);
    socket().letIn([]);
    expect(socket().sent).toEqual([expect.objectContaining({ type: "scheduled.create", clientMessageId: "c1" })]);
    socket().receive({ type: "scheduled", messages: [{ ...lunch, id: "s9" }] });
    await expect(again).resolves.toBe("restored");
    expect(restoringOf("u1")).toEqual([]);
  });

  it("writes one the room won't schedule again back into its composer's draft, after what's written there", async () => {
    localStorage.setItem("composer-draft-u1-random/threads/m7", "<p>also</p>");
    const drafted = restoreScheduled("u1", { roomId: "random", message: reply, clientMessageId: "c2" });
    socket().letIn([]);
    socket().receive({ type: "error", message: "Pick a time that's still ahead.", failed: "scheduled.create", clientMessageId: "c2" });
    await expect(drafted).resolves.toBe("drafted");
    expect(localStorage.getItem("composer-draft-u1-random/threads/m7")).toBe("<p>also</p><p>on it</p>");
    expect(restoringOf("u1")).toEqual([]);
  });
});
