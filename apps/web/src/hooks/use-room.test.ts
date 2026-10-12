import type { User } from "@ember/protocol";
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

  it("signs out when a socket is refused because the session expired", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "Not signed in" }, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const signedOut = vi.fn();
    renderHook(() => useRoom("general", "expired", ada, signedOut));

    await act(async () => FakeSocket.sockets[0]!.onclose?.());
    await vi.waitFor(() => expect(signedOut).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("/api/me", expect.objectContaining({ headers: expect.any(Headers) }));
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
