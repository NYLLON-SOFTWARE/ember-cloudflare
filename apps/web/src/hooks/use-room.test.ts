import { feature } from "@ember/parity";
import { CloseCode, MAX_CHECKED_MESSAGES, MAX_MESSAGE_HTML_LENGTH, MAX_MESSAGE_LENGTH, type Message, type ServerFrame, type User } from "@ember/protocol";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_AFTER_MS } from "@/lib/reconnecting-socket";
import { isPending } from "@/lib/room-state";
import { CONNECTION_LOST, UPLOAD_FAILED, UploadError, uploadFile } from "@/lib/uploads";
import { VISIBILITY_CHANGE_DELAY_MS } from "@/lib/visibility";
import { useRoom } from "./use-room";

vi.mock("@/lib/uploads", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/uploads")>()), uploadFile: vi.fn() }));

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
const visibility = (state: DocumentVisibilityState) =>
  act(() => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
    document.dispatchEvent(new Event("visibilitychange"));
  });
const welcome = (): ServerFrame => ({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0 });

const message = (id: string, overrides: Partial<Message> = {}): Message => ({
  id,
  clientMessageId: id,
  roomId: "general",
  creator: ada,
  body: id,
  plainText: id,
  mentions: [],
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  editedAt: null,
  boosts: [],
  ...overrides,
});

/** Ada in #general, connected unless asked not to be. */
function joinGeneral({ connect = true, messages = [] as Message[], hasMore = false, hasNewer = false, onSessionChanged = () => {} } = {}) {
  const hook = renderHook(() => useRoom("general", ada, onSessionChanged));
  if (connect) {
    socket().open();
    socket().receive({ type: "welcome", you: ada, messages, present: [ada], hasMore, hasNewer, around: null, seq: 0 });
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
    expect(socket().url).toBe("ws://localhost:3000/api/rooms/general/socket?visible=1&protocol=3");
  });

  it("is connecting until the room says welcome", () => {
    const { result } = joinGeneral({ connect: false });
    expect(result.current.state.status).toBe("connecting");
    socket().open();
    expect(result.current.state.status).toBe("connecting");
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0 });
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
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0 });
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
    socket().receive({ type: "welcome", you: ada, messages: [message("m1"), message("m2")], present: [ada, grace], hasMore: false, hasNewer: false, around: null, seq: 0 });

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
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0 });
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
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0 });
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
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0 });
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
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0 });
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
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0 });
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
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0 });
    const checks = socket().sentOfType("message.check").map((frame) => (frame.clientMessageIds as string[]).length);
    expect(checks).toEqual([MAX_CHECKED_MESSAGES, 1]);
  });

  it("names the latest change to the room it has heard of when it connects again", () => {
    joinGeneral();
    socket().drop();
    wait(500);
    expect(socket().url).toBe("ws://localhost:3000/api/rooms/general/socket?visible=1&protocol=3&since=0");
    socket().open();
    socket().receive({ type: "resumed", you: ada, messages: [message("m1")], deletedIds: [], present: [ada], seq: 3 });
    socket().receive({ type: "message.deleted", messageId: "m1", seq: 4 });
    socket().drop();
    wait(500);
    expect(socket().url).toBe("ws://localhost:3000/api/rooms/general/socket?visible=1&protocol=3&since=4");
  });

  it("names the change before one the room never announced, so connecting again brings it", () => {
    joinGeneral();
    socket().receive({ type: "message.created", message: message("m1"), seq: 1 });
    // The room saved change 2, though its batch failed, so it told no one.
    socket().receive({ type: "message.created", message: message("m3"), seq: 3 });
    socket().receive({ type: "message.deleted", messageId: "m1", seq: 4 });
    socket().drop();
    wait(500);
    expect(socket().url).toBe("ws://localhost:3000/api/rooms/general/socket?visible=1&protocol=3&since=1");
  });

  it("names no change until the room has let it in, nor in the next room it opens", () => {
    const { rerender } = renderHook(({ roomId }) => useRoom(roomId, ada, () => {}), { initialProps: { roomId: "general" } });
    socket().open();
    socket().drop();
    wait(500);
    expect(socket().url).toBe("ws://localhost:3000/api/rooms/general/socket?visible=1&protocol=3");
    socket().open();
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 7 });

    rerender({ roomId: "random" });
    expect(socket().url).toBe("ws://localhost:3000/api/rooms/random/socket?visible=1&protocol=3");
  });

  it("catches up on what changed while it was away, keeping what's loaded, and asks about a message it doesn't confirm", () => {
    const { result } = joinGeneral({ messages: [message("m1"), message("m2")], hasMore: true });
    act(() => result.current.postMessage("Lost on the way"));
    socket().drop();
    act(() => result.current.postMessage("Written while away"));
    wait(500);
    socket().open();
    socket().receive({ type: "resumed", you: ada, messages: [message("m3")], deletedIds: ["m1"], present: [ada, grace], seq: 2 });

    expect(result.current.state).toMatchObject({ status: "open", hasMore: true, present: [ada, grace] });
    const [kept, added, lost, written] = result.current.state.messages;
    expect([kept!.id, added!.id]).toEqual(["m2", "m3"]);
    expect(lost).toMatchObject({ body: "Lost on the way", pending: true });
    expect(lost).not.toHaveProperty("failed");
    expect(written).toMatchObject({ body: "Written while away", pending: true });
    expect(written).not.toHaveProperty("failed");
    expect(socket().sent).toEqual([
      { type: "message.check", clientMessageIds: [lost!.clientMessageId] },
      { type: "message.create", clientMessageId: written!.clientMessageId, body: "Written while away" },
    ]);

    socket().receive({ type: "message.checked", stored: [], missing: [lost!.clientMessageId] });
    expect(result.current.state.messages[2]).toMatchObject({ body: "Lost on the way", failed: true });
  });

  it("asks again about a message a welcome didn't confirm when the next connection resumes before the room answers", () => {
    const { result } = joinGeneral();
    act(() => result.current.postMessage("Stored, but the answer was lost"));
    const clientMessageId = socket().sentOfType("message.create")[0]!.clientMessageId as string;
    // The room stored it, and so many more since that a welcome's page leaves it out.
    socket().drop();
    wait(500);
    socket().open();
    socket().receive({ type: "welcome", you: ada, messages: [message("m60")], present: [ada], hasMore: true, hasNewer: false, around: null, seq: 120 });
    expect(socket().sent).toEqual([{ type: "message.check", clientMessageIds: [clientMessageId] }]);

    // Nothing has changed since the welcome when the room's answer is lost with the connection.
    socket().drop();
    wait(500);
    socket().open();
    socket().receive({ type: "resumed", you: ada, messages: [], deletedIds: [], present: [ada], seq: 120 });
    expect(result.current.state.messages[1]).toMatchObject({ clientMessageId, pending: true });
    expect(result.current.state.messages[1]).not.toHaveProperty("failed");
    expect(socket().sent).toEqual([{ type: "message.check", clientMessageIds: [clientMessageId] }]);

    socket().receive({ type: "message.checked", stored: [clientMessageId], missing: [] });
    expect(result.current.state.messages.map((m) => m.id)).toEqual(["m60"]);
    expect(result.current.state.notice).toBe("Your message was sent. Scroll up to see it.");
  });

  it("says so when an edit or reaction can't be sent, and reports it", () => {
    const { result } = joinGeneral({ connect: false });
    let sent: boolean | undefined;
    act(() => {
      sent = result.current.messageActions.edit("m1", "hello");
    });
    expect(sent).toBe(false);
    expect(result.current.state.notice).toMatch(/not connected/i);

    act(() => result.current.dismissNotice());
    act(() => {
      sent = result.current.messageActions.boost("m1", "👍");
    });
    expect(sent).toBe(false);
    expect(result.current.state.notice).toMatch(/not connected/i);

    socket().open();
    socket().receive({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0 });
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

  it("hands over to whoever another tab signed this browser in as, as the server knows them, without showing them this room", async () => {
    const graceAsSignedIn = { ...grace, administrator: true };
    const fetch = vi.fn(async () => Response.json({ user: graceAsSignedIn }));
    vi.stubGlobal("fetch", fetch);
    const onSessionChanged = vi.fn();
    const { result } = joinGeneral({ connect: false, onSessionChanged });
    socket().open();
    socket().receive({ type: "welcome", you: grace, messages: [message("m1", { creator: grace })], present: [grace], hasMore: false, hasNewer: false, around: null, seq: 0 });

    expect(result.current.state).toMatchObject({ status: "reconnecting", messages: [], present: [] });
    expect(socket().closedWith).toBe(1000);
    expect(socket().sentOfType("message.check")).toEqual([]);
    await vi.waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(graceAsSignedIn));
    expect(fetch).toHaveBeenCalledWith("/api/me", expect.anything());
    // Nor does it come back, as a dropped socket would.
    wait(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("hands over just the same when a room it connects to again catches it up as someone else", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Not signed in" }, { status: 401 })));
    const onSessionChanged = vi.fn();
    joinGeneral({ onSessionChanged });
    socket().drop();
    wait(500);
    socket().open();
    socket().receive({ type: "resumed", you: grace, messages: [], deletedIds: [], present: [grace], seq: 1 });
    expect(socket().closedWith).toBe(1000);
    await vi.waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(null));
  });

  it("goes to sign in from a room whose welcome is for someone else when the browser has signed out since", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Not signed in" }, { status: 401 })));
    const onSessionChanged = vi.fn();
    joinGeneral({ connect: false, onSessionChanged });
    socket().open();
    socket().receive({ type: "welcome", you: grace, messages: [], present: [grace], hasMore: false, hasNewer: false, around: null, seq: 0 });
    await vi.waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(null));
    wait(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it.each([
    ["it's signed in as them again", async () => Response.json({ user: { ...ada, administrator: false } })],
    ["it can't tell", async () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("connects again after a welcome for someone else when %s", async (_case, answer) => {
    const fetch = vi.fn(answer);
    vi.stubGlobal("fetch", fetch);
    const onSessionChanged = vi.fn();
    joinGeneral({ connect: false, onSessionChanged });
    socket().open();
    socket().receive({ type: "welcome", you: grace, messages: [], present: [grace], hasMore: false, hasNewer: false, around: null, seq: 0 });
    expect(socket().closedWith).toBe(1000);
    await act(async () => {});
    expect(fetch).toHaveBeenCalledOnce();
    wait(500);
    expect(FakeSocket.all).toHaveLength(2);
    socket().open();
    socket().receive(welcome());
    expect(onSessionChanged).not.toHaveBeenCalled();
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

/** A paragraph of `length` characters of plain text. */
const paragraphOf = (length: number) => `<p>${"x".repeat(length)}</p>`;
/** A short message in more markup than a frame carries. */
const overformatted = `<p>${"<b></b>".repeat(Math.ceil(MAX_MESSAGE_HTML_LENGTH / 7))}x</p>`;

describe(feature("messages.create"), () => {
  it(`says a message over ${MAX_MESSAGE_LENGTH} characters, or in more markup than a frame carries, is too long instead of sending it`, () => {
    const { result } = joinGeneral();
    let sent: boolean | undefined;
    act(() => {
      sent = result.current.postMessage(paragraphOf(MAX_MESSAGE_LENGTH + 1));
    });
    expect(sent).toBe(false);
    expect(socket().sentOfType("message.create")).toEqual([]);
    expect(result.current.state.messages).toEqual([]);
    expect(result.current.state.notice).toBe("Messages can be up to 10,000 characters.");
    act(() => {
      sent = result.current.postMessage(overformatted);
    });
    expect(sent).toBe(false);

    act(() => {
      sent = result.current.postMessage(paragraphOf(MAX_MESSAGE_LENGTH));
    });
    expect(sent).toBe(true);
    expect(socket().sentOfType("message.create")).toHaveLength(1);
  });
});

describe(feature("messages.optimistic"), () => {
  it("shows a message at once, then swaps in the room's copy", () => {
    const { result } = joinGeneral();
    act(() => result.current.postMessage("Hello"));
    const [pending] = result.current.state.messages;
    expect(pending).toMatchObject({ body: "Hello", creator: ada, pending: true });
    expect(socket().sentOfType("message.create")).toEqual([{ type: "message.create", clientMessageId: pending!.clientMessageId, body: "Hello" }]);

    socket().receive({ type: "message.created", message: message("m1", { clientMessageId: pending!.clientMessageId, body: "Hello" }), seq: 1 });
    expect(result.current.state.messages).toEqual([message("m1", { clientMessageId: pending!.clientMessageId, body: "Hello" })]);
  });

  it("shows a message being sent with the plain text of its body, mentioning no one until the room says", () => {
    const { result } = joinGeneral();
    act(() => result.current.postMessage("<p>Hello <strong>all</strong></p><ul><li>One</li></ul>"));
    expect(result.current.state.messages[0]).toMatchObject({ plainText: "Hello all\n\n• One", mentions: [], editedAt: null, pending: true });
  });

  it("marks a message the room refuses as not sent, saying why", () => {
    const { result } = joinGeneral();
    act(() => result.current.postMessage("<p><br></p>"));
    const [pending] = result.current.state.messages;
    socket().receive({ type: "error", message: "Your message is empty.", clientMessageId: pending!.clientMessageId, failed: "message.create" });
    expect(result.current.state.messages[0]).toMatchObject({ pending: true, failed: true });
    expect(result.current.state.notice).toBe("Your message is empty.");
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

describe(feature("attachments.upload"), () => {
  /** An upload useRoom started, which the test answers. */
  interface Started {
    file: File;
    clientMessageId: string;
    progress: (percent: number) => void;
    finish: (message: Message) => Promise<void>;
    fail: (error: unknown) => Promise<void>;
  }

  /** The uploads useRoom starts, in order. */
  function uploads(): Started[] {
    const started: Started[] = [];
    vi.mocked(uploadFile).mockImplementation(
      (_roomId, file, clientMessageId, onProgress) =>
        new Promise((resolve, reject) => {
          started.push({
            file,
            clientMessageId,
            progress: (percent) => act(() => onProgress(percent)),
            finish: (message) => act(async () => resolve(message)),
            fail: (error) => act(async () => reject(error)),
          });
        }),
    );
    return started;
  }

  const files = () => [new File(["a"], "a.txt"), new File(["bb"], "b.txt")];
  const posted = (id: string, upload: Started) => message(id, { clientMessageId: upload.clientMessageId, body: "", plainText: upload.file.name });

  it("uploads each file as a message of its own, one after another, its card showing how it goes", async () => {
    const started = uploads();
    const { result } = joinGeneral();
    const [a, b] = files();
    act(() => void result.current.postFiles([a!, b!]));
    expect(started.map((upload) => upload.file)).toEqual([a]);
    expect(uploadFile).toHaveBeenCalledWith("general", a, started[0]!.clientMessageId, expect.any(Function));
    expect(result.current.state.messages).toEqual([
      expect.objectContaining({ id: started[0]!.clientMessageId, creator: ada, body: "", plainText: "a.txt", pending: true, upload: { name: "a.txt", size: 1, percent: 0 } }),
    ]);

    started[0]!.progress(50);
    expect(result.current.state.messages[0]).toMatchObject({ upload: { percent: 50 } });

    await started[0]!.finish(posted("m1", started[0]!));
    expect(started.map((upload) => upload.file)).toEqual([a, b]);
    expect(result.current.state.messages.map((m) => m.id)).toEqual(["m1", started[1]!.clientMessageId]);
    await started[1]!.finish(posted("m2", started[1]!));
    expect(result.current.state.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("goes on to the next file when one fails, its card saying why", async () => {
    const started = uploads();
    const { result } = joinGeneral();
    act(() => void result.current.postFiles([...files(), new File(["ccc"], "c.txt")]));
    await started[0]!.fail(new UploadError(CONNECTION_LOST));
    await started[1]!.fail(new TypeError("Something unexpected"));
    expect(result.current.state.messages.map((m) => isPending(m) && m.upload)).toEqual([
      { name: "a.txt", size: 1, percent: 0, error: CONNECTION_LOST },
      { name: "b.txt", size: 2, percent: 0, error: UPLOAD_FAILED },
      { name: "c.txt", size: 3, percent: 0 },
    ]);
    expect(started).toHaveLength(3);
  });

  it("drops the files whose upload hasn't started once the room is left", async () => {
    const started = uploads();
    const { result, unmount } = joinGeneral();
    act(() => void result.current.postFiles(files()));
    unmount();
    await started[0]!.finish(posted("m1", started[0]!));
    expect(started).toHaveLength(1);
  });

  it("doesn't ask the room about a file after a reconnect, as its upload answers for it", () => {
    const started = uploads();
    const { result } = joinGeneral();
    act(() => void result.current.postFiles(files().slice(0, 1)));
    act(() => result.current.postMessage("Here it is"));
    const sentId = socket().sentOfType("message.create")[0]!.clientMessageId;

    socket().drop();
    wait(500);
    socket().open();
    socket().receive(welcome());
    expect(socket().sentOfType("message.check")).toEqual([{ type: "message.check", clientMessageIds: [sentId] }]);
    expect(result.current.state.messages[0]).toMatchObject({ id: started[0]!.clientMessageId, pending: true });
  });
});

describe(feature("realtime.typing"), () => {
  it("tells the room you're typing at most once a second, and at once when you stop", () => {
    const { result } = joinGeneral();
    act(() => result.current.typing(true));
    act(() => result.current.typing(true));
    wait(999);
    act(() => result.current.typing(true));
    expect(socket().sentOfType("typing.start")).toHaveLength(1);
    wait(1);
    act(() => result.current.typing(true));
    expect(socket().sentOfType("typing.start")).toHaveLength(2);
    act(() => result.current.typing(false));
    expect(socket().sentOfType("typing.stop")).toHaveLength(1);
    // As in ember-rust, stopping doesn't let the next start through any sooner.
    act(() => result.current.typing(true));
    expect(socket().sentOfType("typing.start")).toHaveLength(2);
    wait(1_000);
    act(() => result.current.typing(true));
    expect(socket().sentOfType("typing.start")).toHaveLength(3);
  });

  it("doesn't tell the room you've stopped when you send, since your message says so", () => {
    const { result } = joinGeneral();
    act(() => result.current.typing(true));
    act(() => result.current.postMessage("Hello"));
    expect(socket().sentOfType("typing.stop")).toEqual([]);
  });

  it("forgets people it hasn't heard typing from for five seconds", () => {
    const { result } = joinGeneral();
    socket().receive({ type: "typing", user: grace, typing: true });
    expect(Object.keys(result.current.state.typing)).toEqual(["u2"]);
    wait(4_000);
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
    expect(socket().sentOfType("history.before")).toEqual([{ type: "history.before", before: "m1", limit: 40 }]);
    expect(result.current.state.loadingOlder).toBe(true);

    socket().receive({ type: "history", before: "m1", messages: [message("m0")], hasMore: false });
    expect(result.current.state.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
    expect(result.current.state.loadingOlder).toBe(false);
    expect(result.current.state.hasMore).toBe(false);
  });

  it("pages back from where its messages began when every one it had was deleted while it was away", () => {
    const { result } = joinGeneral({ messages: [message("m1"), message("m2")], hasMore: true });
    socket().drop();
    wait(500);
    socket().open();
    socket().receive({ type: "resumed", you: ada, messages: [], deletedIds: ["m1", "m2"], present: [ada], seq: 2 });
    expect(result.current.state.messages).toEqual([]);

    act(() => result.current.loadOlder());
    expect(socket().sentOfType("history.before")).toEqual([{ type: "history.before", before: "m1", limit: 40 }]);
  });

  it("asks for the page after the newest message while the room has newer ones, once at a time", () => {
    const { result } = joinGeneral({ messages: [message("m1"), message("m2")], hasNewer: true });
    act(() => result.current.loadNewer());
    act(() => result.current.loadNewer());
    expect(socket().sentOfType("history.after")).toEqual([{ type: "history.after", after: "m2", limit: 40 }]);

    socket().receive({ type: "history.after", after: "m2", messages: [message("m3")], hasNewer: false });
    expect(result.current.state.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    act(() => result.current.loadNewer());
    expect(socket().sentOfType("history.after")).toHaveLength(1);
  });

  it("doesn't page either way while a page is coming to take the timeline's place", () => {
    const { result } = joinGeneral({ messages: [message("m1"), message("m2")], hasMore: true, hasNewer: true });
    act(() => result.current.jump(null));
    act(() => result.current.loadOlder());
    act(() => result.current.loadNewer());
    expect(socket().sentOfType("history.before")).toEqual([]);
    expect(socket().sentOfType("history.after")).toEqual([]);
  });
});

describe(feature("messages.permalink"), () => {
  it("opens the room around the message its permalink names, and connects again without it once in", () => {
    renderHook(() => useRoom("general", ada, () => {}, "m 5"));
    expect(socket().url).toBe("ws://localhost:3000/api/rooms/general/socket?visible=1&protocol=3&around=m%205");
    // Until the room lets the page in, connecting again still asks for it.
    socket().drop();
    wait(500);
    expect(socket().url).toBe("ws://localhost:3000/api/rooms/general/socket?visible=1&protocol=3&around=m%205");
    socket().open();
    socket().receive({ type: "welcome", you: ada, messages: [message("m 5")], present: [ada], hasMore: false, hasNewer: true, around: "m 5", seq: 4 });
    socket().drop();
    wait(500);
    expect(socket().url).toBe("ws://localhost:3000/api/rooms/general/socket?visible=1&protocol=3&since=4");
  });

  it("goes to a message it holds without asking the room, and asks for the page around one it doesn't", () => {
    const { result } = joinGeneral({ messages: [message("m1"), message("m2")] });
    act(() => result.current.jump("m1"));
    expect(result.current.state.focus).toEqual({ messageId: "m1" });
    expect(socket().sentOfType("history.around")).toEqual([]);

    act(() => result.current.jump("m0"));
    expect(socket().sentOfType("history.around")).toEqual([{ type: "history.around", messageId: "m0" }]);
    expect(result.current.state.loadingPage).toBe(true);
    socket().receive({ type: "history.around", messages: [message("m0"), message("m1")], hasMore: false, hasNewer: true, around: "m0" });
    expect(result.current.state).toMatchObject({ focus: { messageId: "m0" }, hasNewer: true, loadingPage: false });
  });

  it("goes to a message it holds while the room is away, and says it can't go to one it doesn't", () => {
    const { result } = joinGeneral({ messages: [message("m1")] });
    socket().drop();
    let went: boolean | undefined;
    act(() => void (went = result.current.jump("m1")));
    expect(went).toBe(true);
    expect(result.current.state.focus).toEqual({ messageId: "m1" });
    act(() => void (went = result.current.jump("m0")));
    expect(went).toBe(false);
    expect(result.current.state.loadingPage).toBe(false);
  });
});

describe(feature("ui.scroll"), () => {
  it("jumps to the newest message where it is when the timeline holds it, or else on the newest page the room sends", () => {
    const { result } = joinGeneral({ messages: [message("m1")], hasNewer: true });
    act(() => result.current.jump(null));
    expect(socket().sentOfType("history.around")).toEqual([{ type: "history.around" }]);
    socket().receive({ type: "history.around", messages: [message("m9")], hasMore: true, hasNewer: false, around: null });
    expect(result.current.state).toMatchObject({ focus: { messageId: null }, hasNewer: false });

    const focus = result.current.state.focus;
    act(() => result.current.jump(null));
    expect(socket().sentOfType("history.around")).toHaveLength(1);
    expect(result.current.state.focus).toEqual({ messageId: null });
    expect(result.current.state.focus).not.toBe(focus);
  });

  it("asks for the newest page before sending from older history, as before what it sends that was written away", () => {
    const { result } = joinGeneral({ messages: [message("m1")], hasNewer: true });
    const sentInOrder = () => socket().sent.filter((f) => f.type === "history.around" || f.type === "message.create").map((f) => f.type);
    act(() => result.current.postMessage("From older history"));
    expect(sentInOrder()).toEqual(["history.around", "message.create"]);

    socket().drop();
    act(() => result.current.postMessage("Written while away"));
    wait(500);
    socket().open();
    socket().receive({ type: "resumed", you: ada, messages: [], deletedIds: [], present: [ada], seq: 0 });
    expect(sentInOrder()).toEqual(["history.around", "message.create"]);
  });

  it("asks for the newest page before showing a file being sent from older history", () => {
    vi.mocked(uploadFile).mockReturnValue(new Promise(() => {}));
    const { result } = joinGeneral({ messages: [message("m1")], hasNewer: true });
    act(() => void result.current.postFiles([new File(["a"], "a.txt")]));
    expect(socket().sentOfType("history.around")).toEqual([{ type: "history.around" }]);
    expect(result.current.state.loadingPage).toBe(true);
  });

  it("asks for the newest page first for what was written while a permalink's older page was on its way", () => {
    const { result } = renderHook(() => useRoom("general", ada, () => {}, "m1"));
    act(() => result.current.postMessage("Written while connecting"));
    const written = result.current.state.messages[0]!;
    socket().open();
    socket().receive({ type: "welcome", you: ada, messages: [message("m1")], present: [ada], hasMore: false, hasNewer: true, around: "m1", seq: 0 });
    expect(socket().sent.map((f) => f.type)).toEqual(["history.around", "message.create"]);

    // So the room's copy comes to a timeline that holds the newest, rather than waiting beyond the older page.
    socket().receive({ type: "history.around", messages: [message("m2")], hasMore: true, hasNewer: false, around: null });
    socket().receive({ type: "message.created", message: message("m3", { clientMessageId: written.clientMessageId, body: "Written while connecting" }), seq: 1 });
    expect(result.current.state.messages.map((m) => m.body)).toEqual(["m2", "Written while connecting"]);
  });
});

describe(feature("messages.edit"), () => {
  it("sends edits to the room and shows them when the room confirms", () => {
    const { result } = joinGeneral({ messages: [message("m1")] });
    act(() => result.current.messageActions.edit("m1", "<p>Better</p>"));
    expect(socket().sentOfType("message.update")).toEqual([{ type: "message.update", messageId: "m1", body: "<p>Better</p>" }]);
    const edited = message("m1", { body: "<p>Better</p>", plainText: "Better", updatedAt: "2026-10-12T10:01:00.000Z", editedAt: "2026-10-12T10:01:00.000Z" });
    socket().receive({ type: "message.updated", message: edited, seq: 1 });
    expect(result.current.state.messages[0]).toEqual(edited);
  });

  it(`says an edit over ${MAX_MESSAGE_LENGTH} characters, or in more markup than a frame carries, is too long instead of sending it`, () => {
    const { result } = joinGeneral({ messages: [message("m1")] });
    let sent: boolean | undefined;
    act(() => {
      sent = result.current.messageActions.edit("m1", paragraphOf(MAX_MESSAGE_LENGTH + 1));
    });
    expect(sent).toBe(false);
    act(() => {
      sent = result.current.messageActions.edit("m1", overformatted);
    });
    expect(sent).toBe(false);
    expect(socket().sentOfType("message.update")).toEqual([]);
    expect(result.current.state.notice).toBe("Messages can be up to 10,000 characters.");
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
    socket().receive({ type: "message.deleted", messageId: "m1", seq: 1 });
    expect(result.current.state.messages.map((m) => m.id)).toEqual(["m2"]);
  });
});

describe(feature("boosts.add"), () => {
  it("sends reactions to the room and shows them when the room confirms", () => {
    const { result } = joinGeneral({ messages: [message("m1")] });
    let sent: boolean | undefined;
    act(() => {
      sent = result.current.messageActions.boost("m1", "🎉");
    });
    expect(sent).toBe(true);
    expect(socket().sentOfType("boost.create")).toEqual([{ type: "boost.create", messageId: "m1", content: "🎉" }]);
    const boost = { id: "b1", messageId: "m1", booster: ada, content: "🎉", createdAt: "" };
    socket().receive({ type: "boost.created", boost, seq: 1 });
    expect(result.current.state.messages[0]!.boosts).toEqual([boost]);
  });
});

describe(feature("boosts.remove"), () => {
  it("sends the removal to the room and drops the reaction when the room confirms", () => {
    const boost = { id: "b1", messageId: "m1", booster: ada, content: "🎉", createdAt: "" };
    const { result } = joinGeneral({ messages: [message("m1", { boosts: [boost] })] });
    let sent: boolean | undefined;
    act(() => {
      sent = result.current.messageActions.unboost("b1");
    });
    expect(sent).toBe(true);
    expect(socket().sentOfType("boost.delete")).toEqual([{ type: "boost.delete", boostId: "b1" }]);
    socket().receive({ type: "boost.deleted", boostId: "b1", messageId: "m1", seq: 1 });
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

  it("tells the room whether the tab is shown as it connects", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    joinGeneral({ connect: false });
    expect(socket().url).toBe("ws://localhost:3000/api/rooms/general/socket?visible=0&protocol=3");
  });

  it("tells the room once the tab has been hidden for 5 seconds, and once it has been shown for 5 again", () => {
    joinGeneral();
    visibility("hidden");
    wait(VISIBILITY_CHANGE_DELAY_MS - 1);
    expect(socket().sentOfType("presence.visible")).toEqual([]);
    wait(1);
    expect(socket().sentOfType("presence.visible")).toEqual([{ type: "presence.visible", visible: false }]);

    visibility("visible");
    // Showing the tab checks the connection, which the room answers.
    wait(200);
    socket().receive({ type: "pong" });
    wait(VISIBILITY_CHANGE_DELAY_MS - 200);
    expect(FakeSocket.all).toHaveLength(1);
    expect(socket().sentOfType("presence.visible")).toEqual([
      { type: "presence.visible", visible: false },
      { type: "presence.visible", visible: true },
    ]);
  });

  it("tells a room it was connecting to once the room lets the socket in, unless the socket's address said so", () => {
    joinGeneral();
    socket().drop();
    visibility("hidden");
    // The room is connected to again before the tab has been hidden long enough to count.
    wait(VISIBILITY_CHANGE_DELAY_MS);
    expect(socket().url).toMatch(/visible=1&/);
    socket().open();
    socket().receive(welcome());
    expect(socket().sentOfType("presence.visible")).toEqual([{ type: "presence.visible", visible: false }]);

    socket().drop();
    wait(500);
    expect(socket().url).toMatch(/visible=0&/);
    socket().open();
    socket().receive(welcome());
    expect(socket().sentOfType("presence.visible")).toEqual([]);
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
