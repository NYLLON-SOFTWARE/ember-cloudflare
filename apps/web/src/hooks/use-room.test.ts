import { feature } from "@ember/parity";
import { CloseCode, MAX_CHECKED_MESSAGES, type Message, type ServerFrame, type User } from "@ember/protocol";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_AFTER_MS } from "@/lib/reconnecting-socket";
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
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number) {
    this.closedWith = code;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code: code ?? 1005 });
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

  /** Closes as the network or the room does: 1006 when the connection drops. */
  drop(code = 1006) {
    act(() => {
      this.readyState = FakeSocket.CLOSED;
      this.onclose?.({ code });
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
function joinGeneral({ connect = true, messages = [] as Message[], hasMore = false, onSessionChanged = () => {} } = {}) {
  const hook = renderHook(() => useRoom("general", ada, onSessionChanged));
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
  it("opens the room's socket, which the session cookie signs in", () => {
    joinGeneral({ connect: false });
    expect(socket().url).toBe("ws://localhost:3000/api/rooms/general/socket");
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

  it("starts the back-off over once the room lets a connection in", () => {
    joinGeneral();
    socket().drop();
    wait(500);
    socket().drop();
    wait(1000);
    socket().open();
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false });
    socket().drop();
    wait(500);
    expect(FakeSocket.all).toHaveLength(4);
  });

  it("keeps backing off from a room that closes the socket as soon as it opens", () => {
    joinGeneral();
    socket().drop();
    wait(500);
    socket().open();
    socket().drop(CloseCode.Reconnect);
    wait(999);
    expect(FakeSocket.all).toHaveLength(2);
    wait(1);
    expect(FakeSocket.all).toHaveLength(3);
  });

  it("refreshes the room on reconnect, then sends what was written while it was away", () => {
    const { result } = joinGeneral({ messages: [message("m1")] });
    socket().drop();
    act(() => result.current.postMessage("Written while away"));
    expect(result.current.state.messages[1]).toMatchObject({ body: "Written while away", pending: true, queued: true });
    wait(500);
    socket().open();
    socket().receive({ type: "welcome", you: ada, messages: [message("m1"), message("m2")], present: [ada, grace], hasMore: false });

    expect(result.current.state.status).toBe("open");
    expect(result.current.state.messages.map((m) => m.body)).toEqual(["m1", "m2", "Written while away"]);
    const written = result.current.state.messages[2]!;
    expect(written).toMatchObject({ pending: true });
    expect(written).not.toHaveProperty("failed");
    expect(written).not.toHaveProperty("queued");
    // It never went, so the room isn't asked about it.
    expect(socket().sent).toEqual([{ type: "message.create", clientMessageId: written.clientMessageId, body: "Written while away" }]);
    expect(result.current.state.present).toEqual([ada, grace]);
  });

  it("sends what was written while connecting, in order, once the room lets the socket in", () => {
    const { result } = joinGeneral({ connect: false });
    act(() => result.current.postMessage("first"));
    act(() => result.current.postMessage("second"));
    socket().open();
    expect(socket().sentOfType("message.create")).toEqual([]);
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false });
    expect(socket().sentOfType("message.create").map((frame) => frame.body)).toEqual(["first", "second"]);
  });

  it("keeps what's written once the socket opens, until the room lets it in, behind what was written before", () => {
    const { result } = joinGeneral();
    socket().drop();
    act(() => result.current.postMessage("Written while away"));
    wait(500);
    socket().open();
    act(() => result.current.postMessage("Written while connecting"));
    expect(socket().sentOfType("message.create")).toEqual([]);
    expect(result.current.state.messages).toMatchObject([{ body: "Written while away", queued: true }, { body: "Written while connecting", queued: true }]);
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false });
    expect(socket().sentOfType("message.create").map((frame) => frame.body)).toEqual(["Written while away", "Written while connecting"]);
  });

  it(`counts as offline once the connection has been down ${OFFLINE_AFTER_MS / 1000} seconds, until the room lets one in`, () => {
    const { result } = joinGeneral();
    socket().drop();
    wait(OFFLINE_AFTER_MS - 1);
    expect(result.current.state.offline).toBe(false);
    wait(1);
    expect(result.current.state).toMatchObject({ status: "reconnecting", offline: true });
    socket().open();
    expect(result.current.state.offline).toBe(true);
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false });
    expect(result.current.state).toMatchObject({ status: "open", offline: false });
  });

  it("shows what was waiting to be sent as not sent once offline, and doesn't send it later", () => {
    const { result } = joinGeneral();
    socket().drop();
    act(() => result.current.postMessage("Hello?"));
    expect(result.current.state.notice).toBeNull();
    wait(OFFLINE_AFTER_MS);
    expect(result.current.state.messages[0]).toMatchObject({ body: "Hello?", pending: true, failed: true });
    expect(result.current.state.notice).toBe("Not connected. Your message wasn't sent.");

    // One written while offline doesn't wait at all.
    act(() => result.current.dismissNotice());
    act(() => result.current.postMessage("Anyone?"));
    expect(result.current.state.messages[1]).toMatchObject({ body: "Anyone?", pending: true, failed: true });
    expect(result.current.state.notice).toBe("Not connected. Your message wasn't sent.");

    socket().open();
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false });
    expect(socket().sent).toEqual([]);
  });

  it("asks the room about the messages a closed socket never confirmed", () => {
    const { result } = joinGeneral();
    act(() => result.current.postMessage("are you there?"));
    const clientMessageId = socket().sentOfType("message.create")[0]!.clientMessageId as string;

    // The socket closes before the room's confirmation comes back, and the next message waits for the next one.
    socket().drop();
    act(() => result.current.postMessage("hello?"));
    wait(500);
    socket().open();
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false });
    const [unconfirmed, waited] = result.current.state.messages;
    expect(socket().sent).toEqual([
      { type: "message.check", clientMessageIds: [clientMessageId] },
      { type: "message.create", clientMessageId: waited!.clientMessageId, body: "hello?" },
    ]);
    expect(unconfirmed).toMatchObject({ body: "are you there?", pending: true });
    expect(unconfirmed).not.toHaveProperty("failed");
    expect(waited).toMatchObject({ body: "hello?", pending: true });
    expect(waited).not.toHaveProperty("failed");

    socket().receive({ type: "message.checked", stored: [clientMessageId], missing: [] });
    expect(result.current.state.messages.map((m) => m.body)).toEqual(["hello?"]);
  });

  it("asks in batches the room accepts", () => {
    const { result } = joinGeneral();
    act(() => {
      for (let i = 0; i <= MAX_CHECKED_MESSAGES; i++) result.current.postMessage(`message ${i}`);
    });
    socket().drop();
    wait(500);
    socket().open();
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false });
    const checks = socket().sentOfType("message.check").map((frame) => (frame.clientMessageIds as string[]).length);
    expect(checks).toEqual([MAX_CHECKED_MESSAGES, 1]);
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
    const onSessionChanged = vi.fn();
    joinGeneral({ connect: false, onSessionChanged });
    await act(async () => socket().onclose?.({ code: 1006 }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    wait(500);
    expect(onSessionChanged).not.toHaveBeenCalled();
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

describe(feature("realtime.keepalive"), () => {
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
});

describe(feature("realtime.connection"), () => {
  it("signs out when the room refuses the socket because the session expired", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "Not signed in" }, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const onSessionChanged = vi.fn();
    joinGeneral({ connect: false, onSessionChanged });
    await act(async () => socket().onclose?.({ code: 1006 }));
    await vi.waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(null));
    expect(fetch).toHaveBeenCalledWith("/api/me", expect.objectContaining({ headers: expect.any(Headers) }));
  });

  it("asks at once whether the session has ended when the room says to reconnect", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "Not signed in" }, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const onSessionChanged = vi.fn();
    joinGeneral({ onSessionChanged });
    // A connection that drops while open is the network's doing, so it just reconnects.
    socket().drop();
    expect(fetch).not.toHaveBeenCalled();

    wait(500);
    socket().open();
    socket().drop(CloseCode.Reconnect);
    await vi.waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(null));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("goes to sign in without connecting again when the person loses access for good", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Not signed in" }, { status: 401 })));
    const onSessionChanged = vi.fn();
    const { result } = joinGeneral({ onSessionChanged });
    socket().drop(CloseCode.Revoked);
    expect(result.current.state.status).toBe("reconnecting");
    await vi.waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(null));
    wait(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("hands over to whoever this browser is signed in as when the person loses access for good", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ user: grace })));
    const onSessionChanged = vi.fn();
    joinGeneral({ onSessionChanged });
    socket().drop(CloseCode.Revoked);
    await vi.waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(grace));
    wait(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it.each([
    ["it's still signed in as them", async () => Response.json({ user: ada })],
    ["it can't tell", async () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("connects again after losing access for good when %s", async (_case, answer) => {
    const fetch = vi.fn(answer);
    vi.stubGlobal("fetch", fetch);
    const onSessionChanged = vi.fn();
    joinGeneral({ onSessionChanged });
    socket().drop(CloseCode.Revoked);
    await act(async () => {});
    expect(fetch).toHaveBeenCalledOnce();
    wait(500);
    expect(FakeSocket.all).toHaveLength(2);
    expect(onSessionChanged).not.toHaveBeenCalled();
  });

  it("hands over to whoever another tab signed this browser in as, without showing them this room", () => {
    const onSessionChanged = vi.fn();
    const { result } = joinGeneral({ connect: false, onSessionChanged });
    socket().open();
    socket().receive({ type: "welcome", you: grace, messages: [message("m1", { creator: grace })], present: [grace], hasMore: false });

    expect(onSessionChanged).toHaveBeenCalledWith(grace);
    expect(result.current.state).toMatchObject({ status: "connecting", messages: [], present: [] });
    expect(socket().closedWith).toBe(1000);
    expect(socket().sentOfType("message.check")).toEqual([]);
    // Nor does it come back, as a dropped socket would.
    wait(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("ignores a session check that answers after its room has closed", async () => {
    const answers: Array<() => void> = [];
    const refused = { ok: false, status: 401, json: async () => ({ error: "Not signed in" }) };
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => answers.push(() => resolve(refused)))));
    const stale = vi.fn();
    const live = vi.fn();

    // The user signs out and back in while the first check is still waiting.
    const first = renderHook(() => useRoom("general", ada, stale));
    await act(async () => socket().onclose?.({ code: 1006 }));
    first.unmount();
    renderHook(() => useRoom("general", ada, live));
    await act(async () => socket().onclose?.({ code: 1006 }));

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

  it("holds a message written before the room connects, and marks it not sent if the room takes too long", () => {
    const { result } = joinGeneral({ connect: false });
    act(() => result.current.postMessage("Hello?"));
    expect(result.current.state.messages[0]).toMatchObject({ body: "Hello?", pending: true, queued: true });
    wait(OFFLINE_AFTER_MS);
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

  it("leaves an idle room's state alone between its checks on who's typing", () => {
    const { result } = joinGeneral();
    const idle = result.current.state;
    wait(5_000);
    expect(result.current.state).toBe(idle);
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
    socket().receive({ type: "presence.joined", user: grace });
    expect(result.current.state.present).toEqual([ada, grace]);
    socket().receive({ type: "presence.left", userId: grace.id });
    expect(result.current.state.present).toEqual([ada]);
  });
});

describe(feature("rooms.member-only-access"), () => {
  it("stops connecting to a room that's gone for the person, deleted or no longer theirs", async () => {
    const fetch = vi.fn(async () => Response.json({ user: ada }));
    vi.stubGlobal("fetch", fetch);
    const onSessionChanged = vi.fn();
    const { result } = joinGeneral({ onSessionChanged });
    socket().drop(CloseCode.NotFound);
    expect(result.current.state.status).toBe("reconnecting");
    await vi.waitFor(() => expect(result.current.state.status).toBe("gone"));
    expect(fetch).toHaveBeenCalledOnce();
    expect(result.current.state.present).toEqual([]);
    wait(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(onSessionChanged).not.toHaveBeenCalled();
  });

  it("shows what was waiting to be sent as not sent once the room turns out to be gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ user: ada })));
    const { result } = joinGeneral();
    socket().drop();
    act(() => result.current.postMessage("still here?"));
    wait(500);
    socket().open();
    socket().drop(CloseCode.NotFound);
    await vi.waitFor(() => expect(result.current.state.status).toBe("gone"));
    expect(result.current.state.messages).toMatchObject([{ body: "still here?", failed: true }]);
    expect(result.current.state.messages[0]).not.toHaveProperty("queued");
  });

  it("calls a room gone when it can't tell who the browser is signed in as", async () => {
    const { result } = joinGeneral();
    socket().drop(CloseCode.NotFound);
    await vi.waitFor(() => expect(result.current.state.status).toBe("gone"));
  });

  it.each([
    ["someone else", async () => Response.json({ user: grace }), grace],
    ["nobody", async () => Response.json({ error: "Not signed in" }, { status: 401 }), null],
  ])("hands over when a room is gone for whoever the browser is now signed in as: %s", async (_case, answer, signedIn) => {
    vi.stubGlobal("fetch", vi.fn(answer));
    const onSessionChanged = vi.fn();
    const { result } = joinGeneral({ onSessionChanged });
    socket().drop(CloseCode.NotFound);
    await vi.waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(signedIn));
    expect(result.current.state.status).toBe("reconnecting");
  });
});
