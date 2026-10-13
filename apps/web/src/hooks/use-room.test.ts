import { MAX_CHECKED_MESSAGES, type User } from "@ember/protocol";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRoom } from "./use-room";

/** Stands in for the browser's WebSocket so tests decide what the network does. */
class FakeSocket {
  static readonly OPEN = 1;
  static sockets: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.sockets.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  receive(frame: object) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** The connection drops: the socket is closed by the time its handler hears about it. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const ada: User = { id: "u1", name: "Ada" };
const welcome = { type: "welcome", you: ada, messages: [], present: [ada], hasMore: false };
const pings = (socket: FakeSocket) => socket.sent.filter((frame) => frame.includes('"ping"')).length;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.sockets = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useRoom", () => {
  it("keeps a socket that answers its heartbeats", () => {
    renderHook(() => useRoom("general", "token", ada, () => {}));
    const socket = FakeSocket.sockets[0]!;
    act(() => {
      socket.open();
      socket.receive(welcome);
    });

    for (let i = 0; i < 4; i++) {
      act(() => vi.advanceTimersByTime(25_000));
      act(() => socket.receive({ type: "pong" }));
    }
    expect(pings(socket)).toBe(4);
    expect(FakeSocket.sockets).toHaveLength(1);
  });

  it("reconnects when a heartbeat goes unanswered", () => {
    const { result } = renderHook(() => useRoom("general", "token", ada, () => {}));
    const socket = FakeSocket.sockets[0]!;
    act(() => {
      socket.open();
      socket.receive(welcome);
    });

    // The network drops without closing the socket, so nothing comes back.
    act(() => vi.advanceTimersByTime(50_000));
    expect(pings(socket)).toBe(1);
    expect(socket.closed).toBe(true);
    expect(result.current.state.status).toBe("reconnecting");

    act(() => vi.advanceTimersByTime(1_000));
    expect(FakeSocket.sockets).toHaveLength(2);
  });

  it("says so when an edit or reaction can't be sent, and the edit reports it", () => {
    const { result } = renderHook(() => useRoom("general", "token", ada, () => {}));
    const socket = FakeSocket.sockets[0]!;

    let sent: boolean | undefined;
    act(() => {
      sent = result.current.messageActions.edit("m1", "hello");
    });
    expect(sent).toBe(false);
    expect(result.current.state.notice).toMatch(/not connected/i);

    act(() => result.current.dismissNotice());
    act(() => result.current.messageActions.boost("m1", "👍"));
    expect(result.current.state.notice).toMatch(/not connected/i);

    act(() => {
      socket.open();
      socket.receive(welcome);
      sent = result.current.messageActions.edit("m1", "hello");
    });
    expect(sent).toBe(true);
    expect(socket.sent).toContain(JSON.stringify({ type: "message.update", messageId: "m1", body: "hello" }));
  });

  it("asks the room about the messages a closed socket never confirmed", () => {
    const { result } = renderHook(() => useRoom("general", "token", ada, () => {}));
    const first = FakeSocket.sockets[0]!;
    act(() => {
      first.open();
      first.receive(welcome);
    });
    act(() => result.current.postMessage("are you there?"));
    const { clientMessageId } = JSON.parse(first.sent.at(-1)!) as { clientMessageId: string };

    // The socket closes before the room's confirmation comes back, and the next message can't go at all.
    act(() => first.drop());
    act(() => result.current.postMessage("hello?"));
    act(() => vi.advanceTimersByTime(1_000));
    const second = FakeSocket.sockets[1]!;
    act(() => {
      second.open();
      second.receive(welcome);
    });
    expect(second.sent).toEqual([JSON.stringify({ type: "message.check", clientMessageIds: [clientMessageId] })]);
    const [unconfirmed, unsent] = result.current.state.messages;
    expect(unconfirmed).toMatchObject({ body: "are you there?", pending: true });
    expect(unconfirmed).not.toHaveProperty("failed");
    expect(unsent).toMatchObject({ body: "hello?", failed: true });

    act(() => second.receive({ type: "message.checked", stored: [clientMessageId], missing: [] }));
    expect(result.current.state.messages.map((m) => m.body)).toEqual(["hello?"]);
  });

  it("asks in batches the room accepts", () => {
    const { result } = renderHook(() => useRoom("general", "token", ada, () => {}));
    const first = FakeSocket.sockets[0]!;
    act(() => {
      first.open();
      first.receive(welcome);
    });
    act(() => {
      for (let i = 0; i <= MAX_CHECKED_MESSAGES; i++) result.current.postMessage(`message ${i}`);
    });

    act(() => first.drop());
    act(() => vi.advanceTimersByTime(1_000));
    const second = FakeSocket.sockets[1]!;
    act(() => {
      second.open();
      second.receive(welcome);
    });
    const checks = second.sent.map((frame) => (JSON.parse(frame) as { clientMessageIds: string[] }).clientMessageIds.length);
    expect(checks).toEqual([MAX_CHECKED_MESSAGES, 1]);
  });

  it("signs out when a socket is refused because the session expired", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "Not signed in" }, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const signedOut = vi.fn();
    renderHook(() => useRoom("general", "expired", ada, signedOut));

    await act(async () => FakeSocket.sockets[0]!.onclose?.());
    await vi.waitFor(() => expect(signedOut).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("/api/me", expect.objectContaining({ headers: expect.any(Headers) }));
  });

  it("ignores a session check that answers after its room has closed", async () => {
    const answers: Array<() => void> = [];
    const refused = { ok: false, status: 401, json: async () => ({ error: "Not signed in" }) };
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => answers.push(() => resolve(refused)))));
    const stale = vi.fn();
    const live = vi.fn();

    // The user signs out and back in while the first check is still waiting.
    const first = renderHook(() => useRoom("general", "old", ada, stale));
    await act(async () => FakeSocket.sockets[0]!.onclose?.());
    first.unmount();
    renderHook(() => useRoom("general", "new", ada, live));
    await act(async () => FakeSocket.sockets[1]!.onclose?.());

    // Both checks answer, the old one first; only the live room acts on its answer.
    await act(async () => answers.forEach((answer) => answer()));
    await vi.waitFor(() => expect(live).toHaveBeenCalled());
    expect(stale).not.toHaveBeenCalled();
  });

  it("keeps retrying when the network, not the session, is the problem", async () => {
    const fetch = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));
    vi.stubGlobal("fetch", fetch);
    const signedOut = vi.fn();
    renderHook(() => useRoom("general", "token", ada, signedOut));

    await act(async () => FakeSocket.sockets[0]!.onclose?.());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => vi.advanceTimersByTime(1_000));
    expect(signedOut).not.toHaveBeenCalled();
    expect(FakeSocket.sockets).toHaveLength(2);
  });
});
