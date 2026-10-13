import { feature } from "@ember/parity";
import type { Message, ServerFrame, User } from "@ember/protocol";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRoom } from "./use-room";

const ada: User = { id: "u1", name: "Ada" };
const grace: User = { id: "u2", name: "Grace" };

/** Stands in for the browser's WebSocket; tests play the server and the network. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static all: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  sent: Array<Record<string, unknown>> = [];
  closedWith: number | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number) {
    this.closedWith = code;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  open() {
    act(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    });
  }

  receive(frame: ServerFrame) {
    act(() => this.onmessage?.({ data: JSON.stringify(frame) }));
  }

  drop() {
    act(() => {
      this.readyState = FakeSocket.CLOSED;
      this.onclose?.();
    });
  }

  sentOfType(type: string) {
    return this.sent.filter((frame) => frame.type === type);
  }
}

const socket = () => FakeSocket.all.at(-1)!;
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

const message = (id: string, overrides: Partial<Message> = {}): Message => ({
  id,
  clientMessageId: id,
  roomId: "general",
  creator: ada,
  body: id,
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  boosts: [],
  ...overrides,
});

/** Ada in #general, connected unless asked not to be. */
function joinGeneral({ connect = true, messages = [] as Message[], hasMore = false, onSessionExpired = () => {} } = {}) {
  const hook = renderHook(() => useRoom("general", "secret-token", ada, onSessionExpired));
  if (connect) {
    socket().open();
    socket().receive({ type: "welcome", you: ada, messages, present: [ada], hasMore });
  }
  return hook;
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  // A socket that closes before opening makes the hook check the session; unless a test says
  // otherwise, that check finds the network down.
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5); // no jitter: back-off delays come out exact
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(feature("realtime.reconnect"), () => {
  it("opens the room's socket with the session token", () => {
    joinGeneral({ connect: false });
    const url = new URL(socket().url);
    expect([url.protocol, url.pathname, url.searchParams.get("token")]).toEqual(["ws:", "/api/rooms/general/socket", "secret-token"]);
  });

  it("is connecting until the room says welcome", () => {
    const { result } = joinGeneral({ connect: false });
    expect(result.current.state.status).toBe("connecting");
    socket().open();
    expect(result.current.state.status).toBe("connecting");
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false });
    expect(result.current.state.status).toBe("open");
  });

  it("reconnects after a drop, backing off from half a second to fifteen", () => {
    const { result } = joinGeneral();
    const delays = [500, 1000, 2000, 4000, 8000, 15000, 15000];
    for (const delay of delays) {
      const sockets = FakeSocket.all.length;
      socket().drop();
      expect(result.current.state.status).toBe("reconnecting");
      wait(delay - 1);
      expect(FakeSocket.all).toHaveLength(sockets);
      wait(1);
      expect(FakeSocket.all).toHaveLength(sockets + 1);
    }
  });

  it("starts the back-off over once a connection opens", () => {
    joinGeneral();
    socket().drop();
    wait(500);
    socket().drop();
    wait(1000);
    socket().open();
    socket().drop();
    wait(500);
    expect(FakeSocket.all).toHaveLength(4);
  });

  it("refreshes the room on reconnect, keeping messages that never got through", () => {
    const { result } = joinGeneral({ messages: [message("m1")] });
    socket().drop();
    act(() => result.current.postMessage("Sent while offline"));
    wait(500);
    socket().open();
    socket().receive({ type: "welcome", you: ada, messages: [message("m1"), message("m2")], present: [ada, grace], hasMore: false });

    expect(result.current.state.status).toBe("open");
    expect(result.current.state.messages.map((m) => m.body)).toEqual(["m1", "m2", "Sent while offline"]);
    expect(result.current.state.messages[2]).toMatchObject({ pending: true, failed: true });
    expect(result.current.state.present).toEqual([ada, grace]);
  });

  it("sends a heartbeat every 25 seconds while connected", () => {
    joinGeneral();
    wait(24_999);
    expect(socket().sentOfType("ping")).toHaveLength(0);
    wait(1);
    expect(socket().sentOfType("ping")).toHaveLength(1);
    const dropped = socket();
    dropped.drop();
    wait(50_000);
    expect(dropped.sentOfType("ping")).toHaveLength(1);
  });

  it("keeps a socket that answers its heartbeats", () => {
    joinGeneral();
    for (let i = 0; i < 4; i++) {
      wait(25_000);
      socket().receive({ type: "pong" });
    }
    expect(socket().sentOfType("ping")).toHaveLength(4);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("reconnects when a heartbeat goes unanswered", () => {
    const { result } = joinGeneral();
    const silent = socket();
    // The network drops without closing the socket, so nothing comes back.
    wait(50_000);
    expect(silent.sentOfType("ping")).toHaveLength(1);
    expect(silent.readyState).toBe(FakeSocket.CLOSED);
    expect(result.current.state.status).toBe("reconnecting");
    wait(500);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("says so when an edit or reaction can't be sent, and the edit reports it", () => {
    const { result } = joinGeneral({ connect: false });
    let sent: boolean | undefined;
    act(() => {
      sent = result.current.messageActions.edit("m1", "hello");
    });
    expect(sent).toBe(false);
    expect(result.current.state.notice).toMatch(/not connected/i);

    act(() => result.current.dismissNotice());
    act(() => result.current.messageActions.boost("m1", "👍"));
    expect(result.current.state.notice).toMatch(/not connected/i);

    socket().open();
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false });
    act(() => {
      sent = result.current.messageActions.edit("m1", "hello");
    });
    expect(sent).toBe(true);
    expect(socket().sentOfType("message.update")).toEqual([{ type: "message.update", messageId: "m1", body: "hello" }]);
  });

  it("keeps retrying when the network, not the session, is the problem", async () => {
    const onSessionExpired = vi.fn();
    joinGeneral({ connect: false, onSessionExpired });
    await act(async () => socket().onclose?.());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    wait(500);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("closes the socket on leaving the room, and stays closed", () => {
    const { unmount } = joinGeneral();
    unmount();
    expect(socket().closedWith).toBe(1000);
    wait(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});

describe(feature("realtime.connection"), () => {
  it("signs out when the room refuses the socket because the session expired", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "Not signed in" }, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const onSessionExpired = vi.fn();
    joinGeneral({ connect: false, onSessionExpired });
    await act(async () => socket().onclose?.());
    await vi.waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
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
    await act(async () => socket().onclose?.());
    first.unmount();
    renderHook(() => useRoom("general", "new", ada, live));
    await act(async () => socket().onclose?.());

    // Both checks answer, the old one first; only the live room acts on its answer.
    await act(async () => answers.forEach((answer) => answer()));
    await vi.waitFor(() => expect(live).toHaveBeenCalled());
    expect(stale).not.toHaveBeenCalled();
  });
});

describe(feature("messages.optimistic"), () => {
  it("shows a message at once, then swaps in the room's copy", () => {
    const { result } = joinGeneral();
    act(() => result.current.postMessage("Hello"));
    const [pending] = result.current.state.messages;
    expect(pending).toMatchObject({ body: "Hello", creator: ada, pending: true });
    expect(socket().sentOfType("message.create")).toEqual([{ type: "message.create", clientMessageId: pending!.clientMessageId, body: "Hello" }]);

    socket().receive({ type: "message.created", message: message("m1", { clientMessageId: pending!.clientMessageId, body: "Hello" }) });
    expect(result.current.state.messages).toEqual([message("m1", { clientMessageId: pending!.clientMessageId, body: "Hello" })]);
  });

  it("marks a message as not sent when there's no connection", () => {
    const { result } = joinGeneral({ connect: false });
    act(() => result.current.postMessage("Hello?"));
    expect(result.current.state.messages[0]).toMatchObject({ body: "Hello?", pending: true, failed: true });
    expect(result.current.state.notice).toBe("Not connected. Your message wasn't sent.");
    act(() => result.current.dismissNotice());
    expect(result.current.state.notice).toBeNull();
  });
});

describe(feature("realtime.typing"), () => {
  it("tells the room you're typing at most every three seconds, and when you stop", () => {
    const { result } = joinGeneral();
    act(() => result.current.typing(true));
    act(() => result.current.typing(true));
    wait(2_999);
    act(() => result.current.typing(true));
    expect(socket().sentOfType("typing.start")).toHaveLength(1);
    wait(1);
    act(() => result.current.typing(true));
    expect(socket().sentOfType("typing.start")).toHaveLength(2);
    act(() => result.current.typing(false));
    expect(socket().sentOfType("typing.stop")).toHaveLength(1);
  });

  it("forgets people it hasn't heard typing from for six seconds", () => {
    const { result } = joinGeneral();
    socket().receive({ type: "typing", user: grace, typing: true });
    expect(Object.keys(result.current.state.typing)).toEqual(["u2"]);
    wait(5_000);
    expect(Object.keys(result.current.state.typing)).toEqual(["u2"]);
    wait(2_000);
    expect(result.current.state.typing).toEqual({});
  });
});

describe(feature("messages.history"), () => {
  it("asks for the page before the oldest message, once at a time", () => {
    const { result } = joinGeneral({ messages: [message("m1"), message("m2")], hasMore: true });
    act(() => result.current.loadOlder());
    act(() => result.current.loadOlder());
    expect(socket().sentOfType("history.before")).toEqual([{ type: "history.before", before: "m1", limit: 50 }]);
    expect(result.current.state.loadingOlder).toBe(true);

    socket().receive({ type: "history", messages: [message("m0")], hasMore: false });
    expect(result.current.state.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
    expect(result.current.state.loadingOlder).toBe(false);
    expect(result.current.state.hasMore).toBe(false);
  });
});

describe(feature("messages.edit"), () => {
  it("sends edits to the room and shows them when the room confirms", () => {
    const { result } = joinGeneral({ messages: [message("m1")] });
    act(() => result.current.messageActions.edit("m1", "Better"));
    expect(socket().sentOfType("message.update")).toEqual([{ type: "message.update", messageId: "m1", body: "Better" }]);
    socket().receive({ type: "message.updated", message: message("m1", { body: "Better", updatedAt: "2026-10-12T10:01:00.000Z" }) });
    expect(result.current.state.messages[0]!.body).toBe("Better");
  });

  it("shows the room's refusal", () => {
    const { result } = joinGeneral({ messages: [message("m1", { creator: grace })] });
    socket().receive({ type: "error", message: "You can only edit your own messages" });
    expect(result.current.state.notice).toBe("You can only edit your own messages");
  });
});

describe(feature("messages.delete"), () => {
  it("sends deletions to the room and removes the message when the room confirms", () => {
    const { result } = joinGeneral({ messages: [message("m1"), message("m2")] });
    act(() => result.current.messageActions.remove("m1"));
    expect(socket().sentOfType("message.delete")).toEqual([{ type: "message.delete", messageId: "m1" }]);
    socket().receive({ type: "message.deleted", messageId: "m1" });
    expect(result.current.state.messages.map((m) => m.id)).toEqual(["m2"]);
  });
});

describe(feature("boosts.add"), () => {
  it("sends reactions to the room and shows them when the room confirms", () => {
    const { result } = joinGeneral({ messages: [message("m1")] });
    act(() => result.current.messageActions.boost("m1", "🎉"));
    expect(socket().sentOfType("boost.create")).toEqual([{ type: "boost.create", messageId: "m1", content: "🎉" }]);
    const boost = { id: "b1", messageId: "m1", booster: ada, content: "🎉", createdAt: "" };
    socket().receive({ type: "boost.created", boost });
    expect(result.current.state.messages[0]!.boosts).toEqual([boost]);
  });
});

describe(feature("boosts.remove"), () => {
  it("sends the removal to the room and drops the reaction when the room confirms", () => {
    const boost = { id: "b1", messageId: "m1", booster: ada, content: "🎉", createdAt: "" };
    const { result } = joinGeneral({ messages: [message("m1", { boosts: [boost] })] });
    act(() => result.current.messageActions.unboost("b1"));
    expect(socket().sentOfType("boost.delete")).toEqual([{ type: "boost.delete", boostId: "b1" }]);
    socket().receive({ type: "boost.deleted", boostId: "b1", messageId: "m1" });
    expect(result.current.state.messages[0]!.boosts).toEqual([]);
  });
});

describe(feature("realtime.presence"), () => {
  it("keeps the list of who's here current", () => {
    const { result } = joinGeneral();
    socket().receive({ type: "presence", present: [ada, grace] });
    expect(result.current.state.present).toEqual([ada, grace]);
    socket().receive({ type: "presence", present: [ada] });
    expect(result.current.state.present).toEqual([ada]);
  });
});
